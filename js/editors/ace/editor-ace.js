/* eslint-disable no-var, no-useless-escape, no-useless-call */
/* TODO: Fix the lint errors */
/* globals ace */
import classNames from "classnames";
import React, {Component} from "react";
import ReactDOM from "react-dom";
import {StyleSheet, css} from "aphrodite/no-important";

import SharedStyles from "../../ui/shared-styles.js";
import TooltipEngine from "../../ui/tooltip-engine.js";
import "../../ui/tooltips/color-picker.js";
import "../../ui/tooltips/number-scrubber.js";
import "../../ui/tooltips/image-picker.js";
import "../../ui/tooltips/image-modal.js";
import "../../ui/tooltips/sound-modal.js";
import "../../ui/tooltips/auto-suggest.js";

const tooltips = {
    // The earlier in the list a tooltip appears
    // the higher priority it gets.
    ace_pjs: [
        "imagePicker",
        "soundModal",
        "colorPicker",
        "autoSuggest",
        "numberScrubber",
    ],
    ace_webpage: ["imageModal", "colorPicker", "numberScrubber"],
    ace_sql: ["numberScrubber"],
};

export default class AceEditorWrapper extends Component {
    props: {
        code: string,
        config: Object,
        folds: Array, // Array of arrays of 2 numbers each, start and end
        record: Object,
        type: string,
        height: string,
        imagesDir: string,
        soundsDir: string,
        autoFocus: boolean,
        disablePaste: boolean,
        disablePasteMsg: string,
        readOnly: boolean,
        errors: Array,
        warnings: Array,
        highlightErrorReq: Object,
        // Parent callbacks
        onChange: Function,
        onCursorChange: Function,
        onClick: Function,
        onGutterErrorClick: Function,
        onScrubbingStart?: Function,
        onScrubbingEnd?: Function,
        onUserChange: Function,
    };

    static defaultProps = {
        errors: [],
        warnings: [],
        height: "400px",
    };

    constructor(props) {
        super(props);
        this.tooltipEl = document.createElement("div");
        this.state = {};
        this.editorRef = React.createRef();

        this.config = props.config;
        this.record = props.record;

        this.handleMouseDown = this.handleMouseDown.bind(this);
        this.handleClick = this.handleClick.bind(this);
    }

    componentDidMount() {
        // Append tooltip element to body (Its a portal)
        document.body.appendChild(this.tooltipEl);

        // Ace editor setup
        this.editor = ace.edit(this.editorRef.current);

        // Bind the recording logic first. Should always happen before
        // other events (such as the tooltip engine)
        this.bindRecord();

        const sensorFrame = document.createElement("iframe");
        sensorFrame.className = css(styles.sensorIframe);
        this.editorRef.current.append(sensorFrame);

        sensorFrame.contentWindow.window.addEventListener("resize", () => {
            // Force the editor to resize.
            this.editor.resize();

            // Set the font size. Scale the font size down when the
            // size of the editor is too small.
            const width = this.editorRef.current.getBoundingClientRect().width;
            this.editor.setFontSize(width < 400 ? "12px" : "14px");
        });

        // Stop overriding Cmd/Ctrl-L. It's used to by browser to go to the
        // location bar, but ace wants to use it for go-to-line.
        this.editor.commands.removeCommand("gotoline");

        // On Windows, the "fold all" hotkey conflicts with close curly brace
        // "}" on EU keyboards. Unbind this in case we're on an EU keyboard.
        this.editor.commands.bindKey("Alt-0", null);

        // Stop highlighting lines on cursor change
        this.editor.selection.addEventListener("changeCursor", () => {
            this.setErrorHighlight(false);
        });

        this.editor.on("change", () => {
            this.props.onChange(this.text());
            if (this.editor.curOp && this.editor.curOp.command.name) {
                this.props.onUserChange(this.text(), this.getAllFolds());
            }
        });

        this.editor.on("click", (e) => {
            // Check if the user clicked on a position that puts the cursor
            // at the end of the line.  If so, add a new line if one doesn't
            // already exist.  Some younger users try to click to go to the
            // next line.  Don't do this when recording nor playing.
            if (!(this.record.playing || this.record.recording)) {
                this.insertNewlineIfCursorAtEnd();
            }
            this.props.onClick();
        });

        this.editor.selection.on("changeCursor", (source) => {
            this.props.onCursorChange(this.getCursor());
            this.handleTooltipableEvent(source);
        });

        this.editor.selection.on("changeSelection", () => {
            this.props.onCursorChange(this.getCursor());
        });

        this.editor.session.getDocument().on("change", (e) => {
            this.handleTooltipableEvent(e);
        });

        this.editor.session.on("changeScrollTop", (scrollTop) => {
            this.setState({editorScrollTop: scrollTop});
        });
        this.config.on("versionSwitched", (version) => {
            this.config.runVersion(version, this.props.type + "_editor", this);
        });

        if (this.props.disablePaste) {
            this.blockPaste();
        }

        this.config.editor = this;

        this.reset();
        this.setFolds(this.props.folds);

        // eslint-disable-next-line react/no-did-mount-set-state
        this.setState({editor: this.editor});
    }

    componentDidUpdate(prevProps, prevState) {
        const errors = this.props.errors;
        if (JSON.stringify(errors) !== JSON.stringify(prevProps.errors)) {
            // Remove old gutter markers and decorations
            this.removeErrors(prevProps.errors);
            // Show new gutter errors
            this.showErrors(errors);
        }
        const warnings = this.props.warnings;
        if (JSON.stringify(warnings) !== JSON.stringify(prevProps.warnings)) {
            // Remove previously added markers
            this.removeWarnings(prevProps.warnings);
            // Show new warnings in the editor. For examples:
            //  Write `Program.assertEqual(2, 4);` in ProcessingJS editor
            //  Write "backgrund: grey" in  webpage editor
            this.showWarnings(warnings);
        }
        // Handle requests from the parent to highlight errors
        // Note that a user could request to highlight the same error
        // multiple times, like if they close Error Buddy and re-open him,
        // so we must track timestamps on error requests to differentiate.
        if (
            this.props.highlightErrorReq &&
            (!prevProps.highlightErrorReq ||
                this.props.highlightErrorReq.timestamp >
                    prevProps.highlightErrorReq.timestamp)
        ) {
            const error = this.props.highlightErrorReq.error;
            this.setCursor(error);
            if (
                error.row > this.editor.getLastVisibleRow() ||
                error.row < this.editor.getFirstVisibleRow()
            ) {
                this.editor.scrollToLine(error.row, true);
            }
            this.setErrorHighlight(true);
        }
    }

    componentWillUnmount() {
        document.body.removeChild(this.tooltipEl);
    }

    renderTooltipEngine() {
        if (!this.state.editor) {
            return null;
        }

        // Attach the picker tooltips to the editor
        const tooltipEngineProps = {
            tooltips: tooltips[this.props.type],
            imagesDir: this.props.imagesDir,
            soundsDir: this.props.soundsDir,
            aceEditor: this.state.editor,
            editorType: this.props.type,
            editorScrollTop: this.state.editorScrollTop,
            record: this.record,
            event: this.state.tooltipableEvent,
            onLoseFocus: () => {
                this.editor.focus();
            },
            onScrubbingStart: (name, setReadonly) => {
                if (setReadonly !== undefined) {
                    this.wasReadOnly = this.editor.getReadOnly();
                    //this.setReadOnly(true);
                }
                this.props.onScrubbingStart && this.props.onScrubbingStart();
            },
            onScrubbingEnd: (name, resetReadOnly) => {
                if (resetReadOnly !== undefined) {
                    //this.setReadOnly(!!this.props.readOnly);
                }
                this.props.onScrubbingEnd && this.props.onScrubbingEnd();
            },
            onTextInsertRequest: (aceLocation, newText) => {
                if (this.record && this.record.playing) {
                    return;
                }
                this.editor.session.insert(aceLocation, newText);
            },
            // Third parameter, if true, tells ACE not to remember this update in the undo chain. Useful in
            // number-scrubbing.
            // THIS IS A PROBLEMATIC HACK.
            //  - If the undo chain and the editor's text are left in an inconsistent state, then
            //     future undo's will change the wrong text. I (ChrisJPhoenix) think this just means you need to
            //     put the editor's text back the way it was before letting anything else happen.
            //     This causes problems if the user hits the keyboard in the middle of a number-scrub: undo
            //     won't put things back correctly. Thus, use editor.setReadOnly(true) while using this hack.
            //  - I use the session's $fromUndo variable to tell the editor not to save undo's. This
            //     is undocumented. There's currently (7/25/15) a test for it in tooltips_test.js.
            onTextUpdateRequest: (newText, newSelection, avoidUndo) => {
                if (this.record && this.record.playing) {
                    return;
                }
                newText = newText.toString();
                const Range = ace.require("ace/range").Range;
                const loc = this.state.tooltipLocation;
                const range = new Range(
                    loc.row,
                    loc.start,
                    loc.row,
                    loc.start + loc.length,
                );
                // We probably could just set it to false when we're done, but
                // someone else might be trying a similar hack, or... who knows?
                let undoState;
                if (avoidUndo) {
                    undoState = this.editor.session.$fromUndo;
                    this.editor.session.$fromUndo = true;
                }
                this.editor.session.replace(range, newText);
                if (avoidUndo) {
                    this.editor.session.$fromUndo = undoState;
                }
                range.end.column = range.start.column + newText.length;
                if (newSelection) {
                    range.start.column = loc.start + newSelection.offset;
                    range.end.column =
                        loc.start + newSelection.offset + newSelection.length;
                }
                this.setSelection(range);
                // Update location based on length of new text
                loc.length = newText.length;
                this.setState({tooltipLocation: loc});
            },
            onTooltipChange: (tooltipName, tooltipLocation) => {
                this.setState({tooltipName, tooltipLocation});
            },
        };
        return ReactDOM.createPortal(
            React.createElement(TooltipEngine, tooltipEngineProps, null),
            this.tooltipEl,
        );
    }

    handleMouseDown() {
        this.handleTooltipableEvent({action: "click"});
    }

    handleClick(e) {
        if (e.target.classList.contains("ace_error")) {
            const lineNum = parseInt(e.target.innerText, 10);
            let errorNum;
            this.props.errors.forEach((error, index) => {
                if (error.row === lineNum - 1) {
                    errorNum = index;
                }
            });
            this.props.onGutterErrorClick(errorNum);
        }
    }

    handleTooltipableEvent(source) {
        var selection = this.editor.selection;
        var pos = selection.getCursor();
        var params = {
            col: pos.column,
            row: pos.row,
            line: this.editor.session.getDocument().getLine(pos.row),
            selections: selection.getAllRanges(),
            source: source,
        };
        params.pre = params.line.slice(0, params.col);
        params.post = params.line.slice(params.col);
        this.setState({tooltipableEvent: params});
    }

    bindRecord() {
        var self = this;
        var editor = this.editor;
        var record = this.record;
        var doc = editor.session.doc;

        // For recording: track text change events
        doc.on(
            "change",
            function(eventInfo) {
                var start = eventInfo.start;
                var end = eventInfo.end;
                if (eventInfo.action.indexOf("insert") === 0) {
                    var insert = eventInfo.lines || eventInfo.text;
                    self.record.log(
                        eventInfo.action,
                        start.row,
                        start.column,
                        end.row,
                        end.column,
                        insert,
                    );
                } else {
                    self.record.log(
                        eventInfo.action,
                        start.row,
                        start.column,
                        end.row,
                        end.column,
                    );
                }
            },
            true,
        );

        editor.selection.addEventListener(
            "changeCursor",
            function() {
                if (editor.selection.isEmpty()) {
                    self.handleSelect();
                }
            },
            true,
        );

        editor.selection.addEventListener(
            "changeSelection",
            this.handleSelect.bind(this),
            true,
        );

        // For playback: Add in record command handlers
        var docOperations = [
            "insertText",
            "insertLines",
            "removeText",
            "removeLines",
        ];
        docOperations.forEach((op) => {
            record.handlers[op] = function(
                startRow,
                startCol,
                endRow,
                endCol,
                data,
            ) {
                const delta = {
                    action: op,
                    start: {
                        row: startRow,
                        column: startCol,
                    },
                    end: {
                        row: endRow,
                        column: endCol,
                    },
                };

                if (op === "insertText") {
                    delta.action = "insert";
                    delta.lines = [data];
                    if (data === "\n") {
                        delta.lines = ["", ""];
                    }
                } else if (op === "insertLines") {
                    delta.lines = data;
                    delta.action = "insert";
                }
                if (op === "removeText" || op === "removeLines") {
                    delta.action = "remove";
                }
                doc.applyDeltas([delta]);
            };
        });

        record.handlers.select = (startRow, startCol, endRow, endCol) => {
            if (endRow == null) {
                endRow = startRow;
            }

            if (endCol == null) {
                endCol = startCol;
            }

            this.setSelection({
                start: {
                    row: startRow,
                    column: startCol,
                },
                end: {
                    row: endRow,
                    column: endCol,
                },
            });
        };

        // Handle record seek caching
        record.seekCachers.editor = {
            getState: function() {
                return {
                    // Save current editor text
                    text: self.text(),

                    // Save current editor cursor position
                    cursor: self.getCursor(),
                };
            },

            restoreState: function(cacheData) {
                // Restore editor text
                self.text(cacheData.text);

                // Restore cursor position
                self.setCursor(cacheData.cursor);
            },
        };

        record.on("runSeek", () => {
            this.reset(record.initData.code);
        });
    }

    handleSelect() {
        if (!this.record.recording) {
            return;
        }

        var curRange = this.editor.selection.getRange();

        var start = curRange.start;
        var end = curRange.end;

        this.record.log("select", start.row, start.column, end.row, end.column);
    }

    reset(code, focus) {
        code = code || this.props.code;

        this.config.runCurVersion(this.props.type + "_editor", this);

        if (code) {
            this.text(code);
        }
        this.setCursor({row: 0, column: 0}, focus);
    }

    // Set the cursor position on the editor
    setErrorHighlight(shouldHighlight) {
        this.editor.setHighlightActiveLine(shouldHighlight);
        if (!shouldHighlight) {
            return;
        }
        // Delay adding a flash until the active line is shown
        setTimeout(() => {
            // Add the hilite flash
            const line = this.editorRef.current.querySelector(
                ".ace_gutter-active-line",
            );
            if (!line) {
                return;
            }
            line.classList.add(css(styles.hiliteErrorLine));

            // And quickly remove it again (to give a nice flash animation)
            setTimeout(() => {
                line.classList.remove(css(styles.hiliteErrorLine));
            }, 500);
        }, 1);
    }

    // Allow for toggling of the editor gutter
    toggleGutter(toggle) {
        this.editor.renderer.setShowGutter(toggle);
    }

    getAllFolds() {
        var session = this.editor.session;
        return session.getAllFolds().map((fold) => {
            return [fold.start.row, fold.end.row];
        });
    }

    setFolds(folds) {
        folds = folds || [];
        folds.forEach((fold) => {
            this.editor.session.foldAll(fold[0], fold[1], 0);
        });
    }

    blockPaste() {
        // Used throughout the function
        const aceEditor = this.editor;

        const notifyUser = () => {
            // eslint-disable-next-line no-alert
            window.alert(this.props.disablePasteMsg);
        };

        // First, we remember the original functions, but only once,
        // in case this function gets run again
        if (!aceEditor.originalCut) {
            aceEditor.originalCut = aceEditor.onCut;
            aceEditor.originalCopy = aceEditor.onCopy;
            aceEditor.originalPaste = aceEditor.onPaste;
        }

        aceEditor.onCut = function(clipboardText) {
            aceEditor.lastCopied = this.getSelectedText();
            aceEditor.originalCut.apply(aceEditor);
        };
        aceEditor.onCopy = function(clipboardText) {
            aceEditor.lastCopied = this.getSelectedText();
            aceEditor.originalCopy.apply(aceEditor);
        };
        aceEditor.onPaste = (clipboardText) => {
            // Allow them to paste either if it matches what they cut/copied,
            // or if its a small # of characters, most likely symbols
            // that dont exist on their keyboard, or if its a URL
            var isUrl = function(str) {
                return str.match(
                    /\s*https?:\/\/[-a-zA-Z0-9@:%._\+~#=]{2,256}\.[a-z]{2,6}\b([-a-zA-Z0-9@:%_\+.~#?&//=]*)\s*/,
                );
            };
            if (
                clipboardText === aceEditor.lastCopied ||
                clipboardText.length < 3 ||
                isUrl(clipboardText)
            ) {
                aceEditor.originalPaste.apply(aceEditor, [clipboardText]);
                return;
            } else {
                notifyUser();
            }
        };

        // Block dragging
        var isLocal = false;
        aceEditor.container.addEventListener("dragstart", function() {
            isLocal = true;
        });
        aceEditor.container.addEventListener("dragend", function() {
            isLocal = false;
        });
        aceEditor.container.addEventListener(
            "drop",
            function(e) {
                if (!isLocal) {
                    notifyUser();
                    e.stopPropagation();
                }
            },
            true,
        );
    }

    /*
     * Utility plugins for working with the editor
     */

    // Focus the editor
    focus() {
        if (this.props.autoFocus !== false) {
            this.editor.focus();
        }
    }

    getCursor() {
        return this.editor.getCursorPosition();
    }

    getSelectionIndices() {
        var rng = this.editor.getSelectionRange();
        var doc = this.editor.getSession().getDocument();

        return {
            start: doc.positionToIndex(rng.start),
            end: doc.positionToIndex(rng.end),
        };
    }

    // Set the cursor position on the editor
    setCursor(cursorPos, focus) {
        this.editor.moveCursorToPosition(cursorPos);
        this.editor.clearSelection();

        if (focus !== false && this.props.autoFocus !== false) {
            this.editor.focus();
        }
    }

    setSelection(selection) {
        this.editor.selection.setSelectionRange(selection);
    }

    setReadOnly(readOnly) {
        this.editor.setReadOnly(readOnly);
    }

    text(text) {
        if (text != null) {
            this.editor.getSession().setValue(text);
        } else {
            return this.editor
                .getSession()
                .getValue()
                .replace(/\r\n/g, "\n");
        }

        return this;
    }

    unfold() {
        return this.editor.getSession().unfold();
    }

    insertNewlineIfCursorAtEnd() {
        var maxRow = this.editor.getSession().getLength() - 1;
        var line = this.editor.getSession().getLine(maxRow);
        var maxColumn = line.length;
        var cursor = this.editor.getCursorPosition();
        if (cursor.row === maxRow && cursor.column === maxColumn) {
            var oldText = this.text();
            if (oldText.length && oldText[oldText.length - 1] !== "\n") {
                this.text(this.text() + "\n");
                this.setCursor({row: maxRow + 1, column: 0});
            }
        }
    }

    undo() {
        this.editor.undo();
    }

    addUnderlineMarker(row) {
        // Underline the problem line to make it more obvious
        //  if they don't notice the gutter icon
        const AceRange = ace.require("ace/range").Range;
        const line = this.editor.session.getDocument().getLine(row);
        this.editor.session.addMarker(
            new AceRange(row, 0, row, line.length),
            "ace_problem_line",
            "text",
            false,
        );
    }

    // Remove previously added markers and decorations
    // @param rowsMap If provided, underline row must match row in map
    removeUnderlines(rowsMap) {
        const markers = this.editor.session.getMarkers();
        Object.values(markers).forEach((marker) => {
            if (
                rowsMap &&
                marker.clazz === "ace_problem_line" &&
                rowsMap[marker.range.start.row]
            ) {
                this.editor.session.removeMarker(marker.id);
            } else if (!rowsMap) {
                this.editor.session.removeMarker(marker.id);
            }
        });
    }

    // Remove gutter icons and underlines
    removeErrors(errors) {
        const errorsMap = {};
        errors.forEach((error) => {
            this.editor.session.removeGutterDecoration(error.row, "ace_error");
            errorsMap[error.row] = true;
        });
        this.removeUnderlines(errorsMap);
    }

    // Add gutter icons (red X) and squiggly underlines
    showErrors(errors) {
        errors.forEach((error) => {
            this.editor.session.addGutterDecoration(error.row, "ace_error");
            this.addUnderlineMarker(error.row);
        });
    }

    // Remove warning-style gutter icons and decorations
    removeWarnings(warnings) {
        const warningsMap = {};
        warnings.forEach((warning) => {
            warningsMap[warning.row] = true;
        });
        this.editor.session.setAnnotations([]);
        this.removeUnderlines(warningsMap);
    }

    // Show gutter icons (yellow warning sign) and squiggly underlines
    showWarnings(warnings) {
        warnings.forEach((warnings) => {
            this.addUnderlineMarker(warnings.row);
        });
        this.editor.session.setAnnotations(warnings);
    }

    render() {
        return (
            <React.Fragment>
                <div
                    ref={this.editorRef}
                    onMouseDown={this.handleMouseDown}
                    onClick={this.handleClick}
                    className={classNames(
                        "scratchpad-editor",
                        "scratchpad-ace-editor",
                        css(styles.inputFrame, SharedStyles.noBorder),
                    )}
                    style={{height: this.props.height}}
                />
                {this.renderTooltipEngine()}
            </React.Fragment>
        );
    }
}

const styles = StyleSheet.create({
    inputFrame: {
        height: "100% !important",
        position: "relative",
    },
    sensorIframe: {
        width: "100%",
        height: 0,
        position: "absolute",
        visibility: "hidden",
    },
    hiliteErrorLine: {
        backgroundColor: "rgba(255, 100, 100, 1) !important",
    },
});
