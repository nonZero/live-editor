/* eslint-disable max-lines, no-var, no-useless-escape, eqeqeq, prefer-spread,
   prefer-const, no-extra-bind, no-undef, one-var
*/
/* TODO: Fix the lint errors */
/* globals i18n */
import _ from "lodash";
import React, {Component} from "react";
import classNames from "classnames";
import {StyleSheet, css} from "aphrodite/no-important";
import Button from "@khanacademy/wonder-blocks-button";
import {icons} from "@khanacademy/wonder-blocks-icon";
import {CircularSpinner} from "@khanacademy/wonder-blocks-progress-spinner";
import IconButton from "@khanacademy/wonder-blocks-icon-button";

import Structured from "../external/structuredjs/structured.js";

import DrawCanvas from "./ui/draw-canvas.js";
import EditorSide from "./ui/editor-side.js";
import ErrorBuddy from "./ui/tipbar.js";
import ErrorBuddyMini from "./ui/errorbuddy-mini.js";
import OutputSide from "./ui/output-side.js";
import PlaybackBar from "./ui/playback-bar.js";
import RecordControls from "./ui/record-controls.js";
import RestartButton from "./ui/restart-button.js";
import ScratchpadConfig from "./shared/config.js";
import ScratchpadRecordModel from "./shared/record.js";
import UndoButton from "./ui/undo-button.js";
import * as utils from "./shared/utils.js";

import "../css/ui/flashblock.css";

const clean = function(str) {
    return String(str).replace(/</g, "&lt;");
};

const editors = {};

export default class LiveEditor extends Component {
    props: {
        // Basic configuration
        code: string,
        editorType: string,
        outputType: string,
        // File and folder paths
        outputExecFile: string,
        externalsDir: string,
        imagesDir: string,
        jshintFile: string,
        soundsDir: string,
        workersDir: string,
        redirectUrl: string,
        // Additional options
        outputWidth: string,
        outputHeight: string,
        editorAutoFocus: boolean,
        editorCursor: Object,
        editorDisablePaste: boolean,
        editorDisablePasteMsg: string,
        editorFolds: Array,
        editorHeight: string,
        version: string,
        outputSandboxProps: string,
        settings: Object,
        hideEditor: boolean,
        enableLoopProtect: boolean,
        restartLabel: string,
        showUndoButton: boolean,
        documentation: Array, // Array of strings
        playbarRightComponents: Array, // Array of components
        toolbarLeftComponents: Array, // Array of components
        toolbarRightComponents: Array,
        // For talkthroughs
        recordingInit: Object,
        recordingCommands: Array,
        recordingMP3: string,
        youtubeUrl: string,
        // For challenges
        validation: Array,
        // For recording
        enableRecording: boolean,
        transloaditAuthKey: string,
        transloaditTemplate: string,
        // Parent callbacks
        onOutputData: Function,
        onCodeChange: Function,
        onOutputSizeUpdate: Function,
        onCodeRun: Function,
        onEditorChange: Function,
        onCursorChange: Function,
        onPlayingChange: Function,
        onReadyToPlay?: Function,
    };

    static defaultProps = {
        outputWidth: "400px",
        outputHeight: "400px",
        playbarRightComponents: [],
        toolbarLeftComponents: [],
        toolbarRightComponents: [],
    };

    constructor(props) {
        super(props);
        this.state = {
            // This is the current error state of Oh Noes Guy.
            // His state can be one of:
            // - happy (no errors)
            // - thinking (the ambigous state where there may be an error in what the
            //             typer is currently typing)
            // - error (there is an error that we want to display prominently)
            errorState: "happy",
            errors: [],
            // Start off by showing any errors in popup error buddy
            showErrorPopup: true,
            // This is set to true once we have our first result back from
            //  the output window
            outputLoaded: false,
            // Enables the restart button
            enableRestart: true,
            // Shows the restart button at all
            showRestart: false,
            // Animates the restart dynamically (talkthrough-triggered)
            animateRestartNow: false,
            // Tracks whether audio has loaded enough to begin playing
            isAudioLoaded: false,
        };

        // This stops us from sending any updates until the current run has finished
        // Reset output state to clean as a part of the frame load handler
        this.outputState = "dirty";

        // Process all the URLs
        this.workersDir = utils.qualifyURL(props.workersDir);
        this.externalsDir = utils.qualifyURL(props.externalsDir);
        this.imagesDir = utils.qualifyURL(props.imagesDir);
        this.soundsDir = props.soundsDir;
        this.execFile = props.outputExecFile
            ? utils.qualifyURL(props.outputExecFile)
            : "";
        this.jshintFile = utils.qualifyURL(
            props.jshintFile || this.externalsDir + "jshint/jshint.js",
        );
        this.redirectUrl = props.redirectUrl;

        this.outputType = props.outputType || "";
        this.editorType = props.editorType || Object.keys(editors)[0];
        this.validation = props.validation;

        this.recordingInit = this.props.recordingInit || {
            code: this.props.code,
            version: this.props.version,
        };

        this.noLint = false;

        this.render();

        this.config = new ScratchpadConfig({
            version: this.props.version,
        });

        this.record = new ScratchpadRecordModel();
        // Load the recording playback commands as well, if applicable
        if (this.props.recordingCommands) {
            // Check the filename to see if a multiplier is specified,
            // of the form audio_x1.3.mp3, which means it's 1.3x as slow
            const url = this.props.recordingMP3;
            const matches = /_x(1.\d+).mp3/.exec(url);
            const multiplier = parseFloat(matches && matches[1]) || 1;
            this.record.loadRecording({
                init: this.props.recordingInit,
                commands: this.props.recordingCommands,
                multiplier: multiplier,
            });
        }

        if (props.enableLoopProtect != null) {
            this.enableLoopProtect = props.enableLoopProtect;
        } else {
            this.enableLoopProtect = true;
        }

        this.aceWrapperRef = React.createRef();
        this.iframeRef = React.createRef();
        this.wrapRef = React.createRef();

        this.handleRecordClick = this.handleRecordClick.bind(this);
        this.handleMessages = this.handleMessages.bind(this);
        this.handleMiniClick = this.handleMiniClick.bind(this);
        this.handleUndoClick = this.handleUndoClick.bind(this);
        this.handleRestartClick = this.handleRestartClick.bind(this);
        this.handleOverlayClick = this.handleOverlayClick.bind(this);
        this.handleRecordColorClick = this.handleRecordColorClick.bind(this);
        this.handleRecordClearClick = this.handleRecordClearClick.bind(this);
        this.handleChangeDebounced = _.debounce(this.handleChange, 300);
        this.handleDraggerMouseDown = this.handleDraggerMouseDown.bind(this);

        this.setupAudio();
    }

    componentDidMount() {
        window.addEventListener("message", this.handleMessages);

        // Track whether the audio has taken >= 15 seconds to load
        if (this.hasAudio()) {
            this.audioTimer = window.setTimeout(() => {
                if (!this.state.isAudioLoaded) {
                    this.setState({audioLoadSlow: true});
                }
            }, 15 * 1000);
        }

        this.config.on("versionSwitched", (e, version) => {
            // Re-run the code after a version switch
            this.markDirty();

            // Run the JSHint config
            this.config.runVersion(version, "jshint");
        });
        // Track this so we can ignore debounced callbacks that try to setState
        this._isMounted = true;
    }

    componentDidUpdate(prevProps) {
        if (this.props.documentation && !prevProps.documentation) {
            this.postFrame({documentation: this.props.documentation});
        }
    }

    componentWillUnmount() {
        window.removeEventListener("message", this.handleMessages);
        window.clearTimeout(this.audioTimer);
        this.player && this.player.destruct();
        this.record && this.record.stopPlayback();
        this._isMounted = false;
    }

    renderErrorBuddy() {
        const props = {
            errors: this.state.errors,
            errorNum: this.state.errorNum,
            imagesDir: this.props.imagesDir,
            isHidden: !this.state.showErrorPopup,
            onErrorShowRequested: (error) => {
                this.setState({
                    highlightErrorReq: {
                        error: error,
                        timestamp: Date.now(),
                    },
                });
            },
            onLoseFocus: () => {
                this.requestEditorFocus();
            },
            onDismissed: (error) => {
                this.setState({
                    errorState: "thinking",
                    showErrorPopup: false,
                });
            },
        };
        return <ErrorBuddy {...props} />;
    }

    renderDrawCanvas() {
        const props = {
            record: this.record,
            onColorSet: (color) => {
                this.setState({drawingColor: color});
            },
        };
        return <DrawCanvas {...props} />;
    }

    renderOutputSide() {
        const props = {
            execFile: this.execFile,
            iframeRef: this.iframeRef,
            sandboxProps: this.props.outputSandboxProps,
            imagesDir: this.imagesDir,
            colors: this.colors,
            canRecord: this.canRecord(),
            isResizable: this.isResizable(),
            hideEditor: this.props.hideEditor,
            disablePointerEvents: this.state.isDraggingHandle,
            height: this.state.outputHeight || this.props.outputHeight,
            width: this.state.outputWidth || this.props.outputWidth,
            // During playback, prevent user interaction with output side
            showDisableOverlay: this.state.isPlaying && !this.state.isRecording,
            outputLoaded: this.state.outputLoaded,
            drawCanvas: this.renderDrawCanvas(),
            errorBuddy: this.renderErrorBuddy(),
            onDisableClick: this.handleOverlayClick,
            onOutputFrameLoad: () => {
                this.outputState = "clean";
                this.markDirty();
            },
        };
        return <OutputSide {...props} />;
    }

    renderAceEditorWrapper() {
        const props = {
            ref: this.aceWrapperRef,
            code: this.props.code,
            folds: this.props.editorFolds,
            autoFocus: this.props.editorAutoFocus,
            disablePaste: this.props.editorDisablePaste,
            disablePasteMsg: this.props.editorDisablePasteMsg,
            errors: this.state.errors,
            warnings: this.state.warnings,
            highlightErrorReq: this.state.highlightErrorReq,
            cursor: this.props.editorCursor,
            config: this.config,
            record: this.record,
            imagesDir: this.props.imagesDir,
            soundsDir: this.props.soundsDir,
            externalsDir: this.props.externalsDir,
            workersDir: this.props.workersDir,
            type: this.editorType,
            onChange: () => {
                // Whenever the user changes code, execute the code
                this.markDirty();
                this.handleChangeDebounced();
                this.props.onEditorChange && this.props.onEditorChange();
            },
            onUserChange: (code, folds) => {
                if (
                    !this.record ||
                    (!this.record.recording && !this.record.playing)
                ) {
                    this.props.onCodeChange &&
                        this.props.onCodeChange(code, folds);
                }
            },
            onCursorChange: (cursor) => {
                this.setState({editorCursor: cursor});
                // This makes sure that we pop up the error
                // if the user changed the cursor to a new line
                this.maybeShowErrors();
                this.props.onCursorChange && this.props.onCursorChange(cursor);
            },
            onClick: () => {
                this.setState({editorClicked: true});
            },
            onGutterErrorClick: (errorNum) => {
                this.setErrorState(errorNum);
            },
        };

        // linting in the webpage environment generates slowparseResults which
        // is used in the runCode step so skipping linting won't work in that
        // environment without some more work
        if (this.editorType === "ace_pjs") {
            props.onScrubbingStart = () => {
                this.noLint = true;
            };
            props.onScrubbingEnd = () => {
                this.noLint = false;
            };
        }
        return React.createElement(editors[this.editorType], props);
    }

    renderEditorSide() {
        const errorBuddy = (
            <ErrorBuddyMini
                key="errorBuddyMini"
                imagesDir={this.imagesDir}
                errorState={this.state.errorState}
                isHidden={this.state.showErrorPopup}
                onClick={this.handleMiniClick}
            />
        );
        const undoButton = (
            <UndoButton
                key="undobutton"
                isHidden={!this.props.showUndoButton}
                onClick={this.handleUndoClick}
            />
        );
        const restartButton = (
            <RestartButton
                key="restartButton"
                labelText={this.props.restartLabel}
                isDisabled={this.state.isPlaying}
                isHidden={!this.state.showRestart}
                onClick={this.handleRestartClick}
                animateNow={this.animateRestartNow}
            />
        );
        const extraProps = {
            aceEditorWrapper: this.renderAceEditorWrapper(),
            leftComponents: this.props.toolbarLeftComponents.concat(
                undoButton,
                errorBuddy,
            ),
            rightComponents: [restartButton].concat(
                this.props.toolbarRightComponents,
            ),
            height: this.props.editorHeight || this.state.outputHeight,
            hasAudio: this.hasAudio(),
            showYoutubeLink:
                !this.state.isAudioLoaded && this.state.audioLoadSlow,
            showAudioPlayButton:
                this.state.isAudioLoaded &&
                !this.state.everPlayed &&
                !this.state.editorClicked,
            showAudioSpinner:
                !this.state.isAudioLoaded && !this.state.editorClicked,
            // During playback, prevent user interaction with editor
            showDisableOverlay: this.state.isPlaying && !this.state.isRecording,
            onBigPlayClick: () => {
                this.togglePlayingState();
            },
            onDisableClick: this.handleOverlayClick,
            onEditorCreated: (aceWrapperRef) => {
                this.aceWrapperRef = aceWrapperRef;
            },
        };
        const props = Object.assign({}, this.props, extraProps);
        return <EditorSide {...props} />;
    }

    handleDraggerMouseDown(e) {
        const minCanvas = 400;
        const minEditor = 410;
        const initialPX = e.pageX;
        const initialWidth = this.iframeRef.current.getBoundingClientRect()
            .width;
        const drag = _.throttle((e) => {
            let delta = e.pageX - initialPX;
            if (document.body.getAttribute("dir") === "rtl") {
                delta = -delta;
            }
            let width = initialWidth - delta;
            const totalWidth = this.wrapRef.current.getBoundingClientRect()
                .width;
            if (width < minCanvas) {
                width = minCanvas;
            } else if (totalWidth - width < minEditor) {
                width = totalWidth - minEditor;
            }
            this.updateOutputSize(width + "px");
            return false;
        }, 30);

        this.setState({isDraggingHandle: true});

        document.addEventListener("mousemove", drag);

        document.addEventListener("mouseup", () => {
            document.removeEventListener("mousemove", drag);
            this.setState({isDraggingHandle: false});
        });
    }

    renderDragHandle() {
        if (!this.isResizable()) {
            return null;
        }

        return (
            <div
                className={css(
                    styles.dragHandle,
                    this.state.isDraggingHandle && styles.dragHandleActive,
                    this.props.hideEditor && styles.editorHidden,
                )}
                onMouseDown={this.handleDraggerMouseDown}
            />
        );
    }

    renderRecordColorButtons() {
        if (!this.canRecord() || !this.state.isRecording) {
            return null;
        }
        const colors = [
            "black",
            "red",
            "orange",
            "green",
            "blue",
            "lightblue",
            "violet",
        ];
        const colorButtons = colors.map((color) => {
            const styles = [{backgroundColor: color}];
            if (color === this.state.drawingColor) {
                styles.push({border: "2px solid black"});
            }
            return (
                <Button
                    key={color}
                    style={styles}
                    onClick={() => this.handleRecordColorClick(color)}
                />
            );
        });
        return (
            <div>
                <IconButton
                    icon={icons.dismiss}
                    onClick={this.handleRecordClearClick}
                />
                {colorButtons}
            </div>
        );
    }

    renderRecordButton() {
        if (!this.canRecord()) {
            return null;
        }

        return (
            <Button
                id="record"
                disabled={this.state.isRecording}
                onClick={this.handleRecordClick}
            >
                {i18n._("Record a talkthrough")}
            </Button>
        );
    }

    renderRecordControls() {
        if (!this.canRecord() || !this.state.isRecording) {
            return null;
        }
        // NOTE(jeresig): Unfortunately we need to do this to make sure
        // that we load the web worker from the same domain as the rest
        // of the site (instead of the domain that the "exec" page is on).
        // This is a KA-specific bit of functionality that we
        // should change, somehow.
        const workersDir = this.workersDir.replace(/^https?:\/\/[^\/]*/, "");

        const props = {
            record: this.record,
            editor: this.editor,
            config: this.config,
            workersDir: workersDir,
            drawCanvas: this.drawCanvas,
        };
        return <RecordControls {...props} />;
    }

    renderPlaybackBar() {
        if (!this.hasAudio() || this.state.isRecording) {
            return null;
        }
        let playbackBar;
        if (this.state.isAudioLoaded) {
            const props = {
                currentTime: this.state.audioCurrentTime,
                onClickPlay: () => {
                    this.togglePlayingState();
                },
                onSeekStart: () => {
                    // Prevent slider manipulation while recording
                    if (this.record.recording) {
                        return;
                    }
                    this.record.seeking = true;
                    // Pause playback and remember if we were playing or were paused
                    this.wasPlaying = this.state.isPlaying;
                    this.record.pausePlayback();
                },
                onSeek: (time) => {
                    // Seek the player and update the time indicator
                    // Ignore values that match endTime - sometimes the
                    // slider jumps and we should ignore those jumps
                    // It's ok because endTime is still captured on 'change'
                    if (time !== this.record.endTime()) {
                        this.setState({audioCurrentTime: time});
                        this.seekTo(time);
                    }
                },
                onSeekEnd: () => {
                    this.record.seeking = false;

                    // If we were playing when we started sliding, resume playing
                    if (this.wasPlaying) {
                        // Set the timeout to give time for the events to catch up
                        // to the present -- if we start before the events have
                        // finished, the scratchpad editor code will be in a bad
                        // state. Wait roughly a second for events to settle down.
                        setTimeout(() => {
                            this.record.play();
                        }, 1000);
                    }
                },
                playing: this.state.isPlaying,
                readyToPlay: this.state.isAudioLoaded,
                totalTime: this.state.audioDurationEstimate,
                youtubeUrl: this.props.youtubeUrl,
            };
            playbackBar = <PlaybackBar {...props} />;
        } else {
            playbackBar = <CircularSpinner size="small" />;
        }
        return (
            <div className={css(styles.playbar)}>
                <div className={css(styles.playbackBar)}>{playbackBar}</div>
                <div className={css(styles.playbackSide)}>
                    {this.props.playbarRightComponents}
                </div>
            </div>
        );
    }

    /**
     * Returns a boolean determining if the user's code has some non-deterministic
     * code running (and thus should have the restart button shown).
     */
    shouldShowRestart() {
        if (!this.aceWrapperRef.current) {
            return null;
        }
        const currentCode = this.aceWrapperRef.current.text();

        if (this.props.outputType === "webpage") {
            if (
                currentCode.match(/<script>/) ||
                currentCode.match(/animation:/)
            ) {
                return true;
            }
        } else if (this.props.outputType === "pjs") {
            var checks = [
                "function(){var draw = function(){};}",
                "function(){draw = function(){};}",
                "function(){var mousePressed = function(){};}",
                "function(){var mouseReleased = function(){};}",
                "function(){var mouseMoved = function(){};}",
                "function(){var mouseClicked = function(){};}",
                "function(){var keyPressed = function(){};}",
                "function(){mousePressed = function(){};}",
                "function(){mouseReleased = function(){};}",
                "function(){mouseMoved = function(){};}",
                "function(){mouseClicked = function(){};}",
                "function(){keyPressed = function(){};}",
                "function(){random();}",
                "function(){var _ = new Random();}",
                "function(){var _ = random();}",
            ];

            try {
                // Don't worry, StructuredJS caches the parsing of the code and
                // the structure tests!
                for (var i = 0; i < checks.length; i++) {
                    if (Structured.match(currentCode, checks[i])) {
                        return true;
                    }
                }
                return false;
            } catch (e) {
                // Don't have to do anything on syntax error, just ignore it
                // and leave the restart button in its current state.
            }
        }

        return false;
    }

    // Only enable recording if there's an explicit boolean to turn it on,
    //  and if the transloadit information is supplied,
    //  and if the playback isn't currently playing.
    // Note that recording doesn't work right now.
    canRecord() {
        return (
            this.props.enableRecording &&
            this.props.transloaditAuthKey &&
            this.props.transloaditTemplate &&
            !this.state.isPlaying
        );
    }

    isResizable() {
        return (
            this.editorType === "ace_pjs" || this.editorType === "ace_webpage"
        );
    }

    hasAudio() {
        return !!this.props.recordingMP3;
    }

    setupAudio() {
        if (!this.hasAudio()) {
            return;
        }

        var self = this;
        var rebootTimer;

        soundManager.setup({
            url: this.externalsDir + "SoundManager2/swf/",
            debugMode: false,
            // Un-comment this to test Flash on FF:
            // debugFlash: true, preferFlash: true, useHTML5Audio: false,
            // See sm2-container in editor-wrapper.js and flashblock.css
            useFlashBlock: true,
            // Sometimes when Flash is blocked or the browser is slower,
            //  soundManager will fail to initialize at first,
            //  claiming no response from the Flash file.
            // To handle that, we attempt a reboot 3 seconds after each
            //  timeout, clearing the timer if we get an onready during
            //  that time (which happens if user un-blocks flash).
            onready: function() {
                window.clearTimeout(rebootTimer);
                self.audioInit();
            },
            ontimeout: function(error) {
                // The onready event comes pretty soon after the user
                //  clicks the flashblock, but not instantaneous, so 3
                //  seconds seems a good amount of time to give them the
                //  chance to click it before we remove it. It's possible
                //  they may have to click twice sometimes
                //  (but the second time time will work).
                window.clearTimeout(rebootTimer);
                rebootTimer = window.setTimeout(function() {
                    // Clear flashblocker divs
                    document.querySelector("#sm2-container div").remove();
                    soundManager.reboot();
                }, 3000);
            },
        });
        soundManager.beginDelayedInit();

        this.bindRecordHandlers();
    }

    audioInit() {
        if (!this.hasAudio()) {
            return;
        }

        const self = this;
        const record = this.record;

        // Reset the wasPlaying tracker
        this.wasPlaying = undefined;

        // Start the play head at 0
        record.time = 0;

        this.player = soundManager.createSound({
            // SoundManager errors if no ID is passed in,
            // even though we don't use it
            // The ID should be a string starting with a letter.
            id: "sound" + new Date().getTime(),

            url: this.props.recordingMP3,

            // Load the audio automatically
            autoLoad: true,

            // While the audio is playing update the position on the progress
            // bar and update the time indicator
            whileplaying: function() {
                self.setState({audioCurrentTime: record.currentTime()});
                record.trigger("playUpdate");
            },

            // Hook audio playback into Record command playback
            // Define callbacks rather than sending the function directly so
            // that the scope in the Record methods is correct.
            onplay: function() {
                record.play();
            },
            onresume: function() {
                record.play();
            },
            onpause: function() {
                record.pausePlayback();
            },
            onload: function() {
                record.durationEstimate = record.duration = this.duration;
                self.setState({audioDurationEstimate: this.duration});
                record.trigger("loaded");
            },
            whileloading: function() {
                record.duration = null;
                record.durationEstimate = this.durationEstimate;
                self.setState({audioDurationEstimate: this.durationEstimate});
                record.trigger("loading");
            },
            // When audio playback is complete, notify everyone listening
            // that playback is officially done
            onfinish: function() {
                record.stopPlayback();
                record.trigger("playEnded");
            },
            onsuspend: function() {
                // Suspend happens when the audio can't be loaded automatically
                // (such is the case on iOS devices). Thus we start playing
                // anyway and let the load happen when the
                // user clicks the play button later on.
                self.setState({isAudioLoaded: true});
                self.props.onReadyToPlay && self.props.onReadyToPlay();
            },
        });

        // Wait to start playback until we at least have some
        // bytes from the server (otherwise the player breaks)
        var checkStreaming = setInterval(() => {
            // We've loaded enough to start playing
            if (this.audioReadyToPlay()) {
                clearInterval(checkStreaming);
                this.setState({isAudioLoaded: true});
                this.props.onReadyToPlay && this.props.onReadyToPlay();
            }
        }, 16);

        this.bindPlayerHandlers();
    }

    audioReadyToPlay() {
        // NOTE(pamela): We can't just check bytesLoaded,
        //  because IE reports null for that
        // (it seems to not get the progress event)
        // So we've changed it to also check loaded.
        // If we need to, we can reach inside the HTML5 audio element
        //  and check the ranges of the buffered property
        return (
            this.player && (this.player.bytesLoaded > 0 || this.player.loaded)
        );
    }

    togglePlayingState = function() {
        if (this.record.playing) {
            this.record.pausePlayback();
        } else {
            this.record.play();
        }
    };

    bindPlayerHandlers() {
        var self = this;
        var record = this.record;

        // Bind events to the Record object, to track when playback events occur
        this.record.bind({
            loading: function() {
                self.updateDurationDisplay();
            },

            loaded: function() {
                // Add an empty command to force the Record playback to
                // keep playing until the audio track finishes playing
                var commands = record.commands;

                if (commands) {
                    commands.push([
                        Math.max(
                            record.endTime(),
                            commands[commands.length - 1][0],
                        ),
                        "seek",
                    ]);
                }
                self.updateDurationDisplay();
            },

            // When play has started
            playStarted: function() {
                // If the audio player is paused, resume playing
                if (self.player.paused) {
                    self.player.resume();

                    // Otherwise we can assume that we need to start playing from the top
                } else if (self.player.playState === 0) {
                    self.player.play();
                }
            },

            // Pause when recording playback pauses
            playPaused: function() {
                self.player.pause();
            },
        });
    }

    bindRecordHandlers() {
        var self = this;
        var record = this.record;

        /*
         * Bind events to Record (for recording and playback)
         * and to ScratchpadCanvas (for recording and playback)
         */

        record.bind({
            // Playback of a recording has begun
            playStarted: (e, resume) => {
                // Re-init if the recording version is different from
                // the scratchpad's normal version
                this.config.switchVersion(record.getVersion());

                // We're starting over so reset the editor and
                // canvas to its initial state
                if (!record.recording && !resume) {
                    // Reset the editor
                    this.aceWrapperRef.current.reset(
                        record.initData.code,
                        false,
                    );

                    // Clear and hide the drawing area
                    // TODO!!
                    //self.drawCanvas.clear(true);
                    //self.drawCanvas.endDraw();
                }
                this.aceWrapperRef.current.unfold();

                if (!record.recording) {
                    // Turn on playback-related styling
                    document.querySelector("html").classList.add("playing");
                }

                this.setState({isPlaying: true, everPlayed: true});
                this.props.onPlayingChange && this.props.onPlayingChange(true);
            },

            playEnded: () => {
                // Re-init if the recording version is different from
                // the scratchpad's normal version
                this.config.switchVersion(this.props.version);
                this.setState({isPlaying: false});
                this.props.onPlayingChange && this.props.onPlayingChange(false);
            },

            // Playback of a recording has been paused
            playPaused: () => {
                this.setState({isPlaying: false});

                // Turn off playback-related styling
                document.querySelector("html").classList.remove("playing");

                this.props.onPlayingChange && this.props.onPlayingChange(false);
            },

            // Recording has begun
            recordStarted: () => {
                // Let the output know that recording has begun
                this.postFrame({recording: true});

                // Allow the editor to be changed
                this.aceWrapperRef.current.setReadOnly(false);

                // Turn off playback-related styling
                // (hides hot numbers, for example)
                document.querySelector("html").classList.remove("playing");

                // Reset the canvas to its initial state only if this is the
                // very first chunk we are recording.
                if (record.hasNoChunks()) {
                    this.drawCanvas.clear(true);
                    this.drawCanvas.endDraw();
                }
            },

            // Recording has ended
            recordEnded: () => {
                // Let the output know that recording has ended
                this.postFrame({recording: false});

                if (record.recordingAudio) {
                    this.recordView.stopRecordingAudio();
                }

                // Stop any sort of user playback
                record.stopPlayback();

                // Turn on playback-related styling (hides hot numbers, for
                // example)
                document.querySelector("html").classList.add("playing");

                // Prevent the editor from being changed
                this.aceWrapperRef.current.setReadOnly(true);

                // Because we are recording in chunks, do not reset the canvas
                // to its initial state.
                this.drawCanvas.endDraw();
            },
        });

        // ScratchpadCanvas mouse events to track
        // Tracking: mousemove, mouseover, mouseout, mousedown, and mouseup
        const mouseCommands = ["move", "over", "out", "down", "up"];
        mouseCommands.forEach((name) => {
            // Handle the command during playback
            record.handlers[name] = (x, y) => {
                this.postFrame({
                    mouseAction: {
                        name: name,
                        x: x,
                        y: y,
                    },
                });
            };
        });

        // When a restart occurs during playback, restart the output
        record.handlers.restart = () => {
            this.setState({animateRestartNow: true});
            self.postFrame({restart: true});
        };

        // Force the recording to sync to the current time of the audio playback
        record.currentTime = function() {
            return self.player ? self.player.position : 0;
        };

        // Create a function for retreiving the track end time
        // Note that duration will be set to the duration estimate while
        // the track is still loading, and only set to actual duration
        // once its loaded.
        record.endTime = function() {
            return this.duration || this.durationEstimate;
        };
    }

    // This is debounced in the constructor,
    // so we use this for things we can wait a bit on
    handleChange() {
        if (!this._isMounted) {
            return;
        }
        this.setState({showRestart: this.shouldShowRestart()});
    }

    handleMiniClick() {
        this.setErrorState(0);
    }

    handleRestartClick() {
        this.restartCode();
        this.record && this.record.log("restart");
    }

    handleUndoClick() {
        this.aceWrapperRef.current.undo();
        this.requestEditorFocus();
    }

    handleOverlayClick() {
        // If the user clicks the disable overlay (which is laid over
        // the editor and canvas on playback) then pause playback.
        this.record.pausePlayback();
    }

    handleRecordClick(callback) {
        // If we're already recording, stop
        if (this.record.recording) {
            // Note: We should never hit this case when recording chunks.
            this.recordView.stopRecordingCommands();
            return;
        }

        var saveCode = this.aceWrapperRef.text();

        // You must have some code in the editor before you start recording
        // otherwise the student will be starting with a blank editor,
        // which is confusing
        if (!saveCode) {
            callback({error: "empty"});
        } else if (this.config.curVersion() !== this.config.latestVersion()) {
            callback({error: "outdated"});
        } else if (this.canRecord() && !this.hasAudio()) {
            this.startRecording();
            this.requestEditorFocus();
        } else {
            callback({error: "exists"});
        }
    }

    handleRecordColorClick(color) {
        this.setState({drawingColor: color});
        this.requestEditorFocus();
    }

    handleRecordClearClick() {
        this.setState({drawingColor: null});
        this.drawCanvas.clear();
        this.drawCanvas.endDraw();
        this.requestEditorFocus();
    }

    saveRecording(callback, steps) {
        // If no command or audio recording was made, just save the results
        if (!this.record.recorded || !this.record.recordingAudio) {
            return callback();
        }

        var transloadit = new TransloaditXhr({
            authKey: this.props.transloaditAuthKey,
            templateId: this.props.transloaditTemplate,
            steps: steps,
            successCb: function(results) {
                this.recordingMP3 = results.mp3[0].url.replace(
                    /^http:/,
                    "https:",
                );
                callback(null, this.recordingMP3);
            }.bind(this),
            errorCb: callback,
        });

        this.recordView.getFinalAudioRecording(function(combined) {
            transloadit.uploadFile(combined.wav);
        });
    }

    // We call this function multiple times, because the
    // endTime value may change as we load the file
    updateDurationDisplay() {
        // This gets called if we're loading while we're playing,
        // so we need to update with the current time
        this.setState({audioCurrentTime: this.record.currentTime()});
    }

    // Utility method for formatting time in minutes/seconds
    formatTime(time) {
        var seconds = time / 1000,
            min = Math.floor(seconds / 60),
            sec = Math.floor(seconds % 60);

        if (min < 0 || sec < 0) {
            min = 0;
            sec = 0;
        }

        return min + ":" + (sec < 10 ? "0" : "") + sec;
    }

    // Seek the player to a particular time
    seekTo(timeMS) {
        // Move the recording and player positions
        if (this.record.seekTo(timeMS) !== false) {
            this.player.setPosition(timeMS);
        }
    }

    handleMessages(event) {
        // DANGER!  The data coming in from the iframe could be anything,
        // because with some cleverness the author of the program can send an
        // arbitrary message up to us.  We need to be careful to sanitize it
        // before doing anything with it, to avoid XSS attacks.  For some
        // examples, see https://hackerone.com/reports/103989 or
        // https://app.asana.com/0/44063710579000/71736430394249.
        // TODO(benkraft): Right now that sanitization is spread over a number
        // of different places; some things get sanitized here, while others
        // get passed around and sanitized elsewhere.  Put all the sanitization
        // in one place so it's easier to reason about its correctness, since
        // any gap leaves us open to XSS attacks.
        // TODO(benkraft): Write some tests that send arbitrary messages up
        // from the iframe, and assert that they don't end up displaying
        // arbitrary HTML to the user outside the iframe.
        let data;

        try {
            data = JSON.parse(event.data);
        } catch (err) {
            // Malformed JSON, we don't care about it
        }

        if (!data) {
            return;
        }

        if (typeof data !== "object") {
            return;
        }

        if (data.type === "debugger") {
            // these messages are handled by ui/debugger.js:listenMessages
            return;
        }

        this.props.onOutputData && this.props.onOutputData(data);

        // Hide loading overlay if output is loaded
        // We previously just looked at data.loaded,
        // but that didn't work for some users (maybe message too early?)
        // so now we also hide if we see data.results

        if (data.loaded || data.results) {
            this.setState({outputLoaded: true});
        }

        // Set the code in the editor
        if (data.code !== undefined) {
            // TODO(benkraft): This is technically not unsafe, in that
            // this.aceWrapperRef.text() does not render its argument as HTML, but it
            // does mean that a user can write a program which modifies its own
            // code (perhaps on another user's computer).  Not directly a
            // security risk, but it would be nice if it weren't possible.
            this.aceWrapperRef.current.text(data.code);
            this.restartCode();
        }

        // Testing/validation code is being set
        if (data.validate !== undefined && data.validate !== null) {
            this.validation = data.validate;
        }

        if (data.results) {
            this.runDone();
        }

        if (data.results && Array.isArray(data.results.errors)) {
            this.handleErrors(this.cleanErrors(data.results.errors));
        }

        if (this.editorType.indexOf("ace_") === 0 && data.results) {
            let warnings = [];
            if (data.results.assertions || data.results.warnings) {
                // Results of assertion failures and lint warnings. For example:
                //  Write `Program.assertEqual(2, 4);` in ProcessingJS editor
                //  Write "backgrund: grey" in  webpage editor
                warnings = data.results.assertions
                    .concat(data.results.warnings)
                    .map((lineMsg) => {
                        return {
                            // Coerce to the expected type
                            row: +lineMsg.row,
                            column: +lineMsg.column,
                            // This is escaped by the gutter annotation display
                            // code, so we don't need to escape it here.
                            text: lineMsg.text.toString(),
                            type: "warning",
                        };
                    });
            }
            this.setState({warnings});
        }

        // Set the line visibility in the editor
        if (data.lines !== undefined) {
            // Coerce to the expected type
            this.aceWrapperRef.current.toggleGutter(data.lines.map((x) => +x));
        }

        // Restart the execution
        if (data.restart) {
            this.restartCode();
        }

        // Log the recorded action
        if (data.log) {
            // TODO(benkraft): I think passing unsanitized data to any of our
            // record handlers is currently safe, but it would be nice to not
            // depend on that always being true.  Do something to sanitize
            // this, or at least make it more clear that the data coming in may
            // be unsanitized.
            this.record.log.apply(this.record, data.log);
        }
    }

    handleErrors(errors) {
        /* Our current less-aggressive way of handling errors:
         * When a user makes an error, we immediately:
         *   - show an icon in the gutter
         *   - underline the current line
         *   - display a thinking error buddy
         * We only pop up the error buddy if:
         *   - they just loaded the editor, and the error was already there
         *   - they have made an error on the line that they're not currently on
         *   - a minute has passed since they last typed
         */

        // Always clear the timeout
        window.clearTimeout(this.errorTimeout);

        if (errors.length) {
            // This state set triggers the Ace editor to display gutter errors
            this.setState({errors});
            this.maybeShowErrors();
        } else {
            // This state set triggers the Ace editor to remove gutter errors
            this.setState({errors: []});
            this.setHappyState();
        }
    }

    maybeShowErrors() {
        if (!this.state.errors.length || !this.state.editorCursor) {
            return;
        }

        const currentRow = this.state.editorCursor.row;
        // Determine if there are errors on lines besides the current row
        let onlyErrorsOnThisLine = true;
        this.state.errors.forEach((error) => {
            if (error.row !== currentRow) {
                onlyErrorsOnThisLine = false;
                return;
            }
        });
        // If we were already planning to show the error, or if there are
        // errors on more than the current line, or we have errors and the
        // program was just loaded, then we show the error popup now.
        // Otherwise we'll delay showing the error message
        // to give them time to type.

        if (this.state.showErrorPopup || !onlyErrorsOnThisLine) {
            // We've already timed out or moved to another line, so show
            // the error.
            this.setErrorState();
        } else if (onlyErrorsOnThisLine) {
            // There are new errors caused by typing on this line, so let's
            // give the typer time to finish what they were writing. We'll
            // show the tipbar if 1 minute has gone by without typing.
            this.setThinkingState();
            // Make doubly sure that we clear the timeout
            window.clearTimeout(this.errorTimeout);
            this.errorTimeout = setTimeout(() => {
                if (this.state.errors.length) {
                    this.setErrorState();
                }
            }, 60000);
        }
    }

    setErrorState(errorNum) {
        this.setState({
            errorState: "error",
            errorNum: errorNum || 0,
            showErrorPopup: true,
        });
    }

    setThinkingState() {
        this.setState({
            errorState: "thinking",
            showErrorPopup: false,
        });
    }

    setHappyState() {
        this.setState({
            errorState: "happy",
            showErrorPopup: false,
        });
    }

    // Extract the origin from the embedded frame location
    postFrameOrigin() {
        var match = /^.*:\/\/[^\/]*/.exec(
            this.iframeRef.current.getAttribute("data-src"),
        );

        return match
            ? match[0]
            : window.location.protocol + "//" + window.location.host;
    }

    postFrame(data) {
        // Send the data to the frame using postMessage
        this.iframeRef.current.contentWindow.postMessage(
            JSON.stringify(data),
            this.postFrameOrigin(),
        );
    }

    hasFrame() {
        return !!this.execFile;
    }

    /*
     * Restart the code in the output frame.
     */
    restartCode() {
        this.postFrame({restart: true});
    }

    /*
     * Execute some code in the output frame.
     *
     * A note about the throttling:
     * This limits updates to 50FPS. No point in updating faster than that.
     *
     * DO NOT CALL THIS DIRECTLY
     * Instead call markDirty because it will handle
     * throttling requests properly.
     */
    runCode(code) {
        return _.throttle((code) => {
            var options = {
                code:
                    arguments.length === 0
                        ? this.aceWrapperRef.current.text()
                        : code,
                cursor: this.aceWrapperRef.current.getSelectionIndices
                    ? this.aceWrapperRef.current.getSelectionIndices()
                    : -1,
                validate: this.validation || "",
                noLint: this.noLint,
                version: this.config.curVersion(),
                settings: this.props.settings || {},
                workersDir: this.workersDir,
                externalsDir: this.externalsDir,
                imagesDir: this.imagesDir,
                soundsDir: this.soundsDir,
                redirectUrl: this.redirectUrl,
                jshintFile: this.jshintFile,
                outputType: this.outputType,
                enableLoopProtect: this.enableLoopProtect,
            };
            this.props.onCodeRun && this.props.onCodeRun(options);

            this.postFrame(options);
        }, 20)(code);
    }

    markDirty() {
        // makeDirty is called when you type something in the editor. When this
        // happens, we want to run the code, but also want to throttle how often
        // we re-run so we can wait for the results of running it to come back.
        // We keep track of the state using clean/running/dirty markers.

        // The state of the output starts out "clean": the editor and the output
        // are in sync.
        // When you type, markDirty gets called, which will mark the state as
        // "running" and starts of runCode in the background. Since runCode is
        // async, if you type again while it's running then the output state
        // will get set to "dirty".
        // When runCode finishes it will call runDone, which will either set the
        // state back to clean (if it was running before), or will run again if
        // the state was dirty.
        // If runCode takes more than 500ms then runDone will be called and we
        // set the state back to "clean".
        if (this.outputState === "clean") {
            // We will run at the end of this code block
            // This stops replace from trying to execute code
            // between deleting the old code and adding the new code
            setTimeout(this.runCode.bind(this), 0);
            this.outputState = "running";

            // 500ms is an arbitrary timeout. Hopefully long enough for
            // reasonable programs to execute, but short enough for editor to
            // not freeze.
            this.runTimeout = setTimeout(() => {
                this.runDone();
            }, 500);
        } else {
            this.outputState = "dirty";
        }
    }

    // This will either be called when we receive the results
    // Or it will timeout.
    runDone() {
        clearTimeout(this.runTimeout);
        var lastOutputState = this.outputState;
        this.outputState = "clean";
        if (lastOutputState === "dirty") {
            this.markDirty();
        }
    }

    updateOutputSize(outputWidth, outputHeight) {
        outputWidth = outputWidth || this.props.outputWidth;
        outputHeight = outputHeight || this.props.outputHeight;
        this.setState({outputWidth, outputHeight});

        this.props.onOutputSizeUpdate &&
            this.props.onOutputSizeUpdate({
                width: outputWidth,
                height: outputHeight,
            });
    }

    getScreenshot(callback) {
        // If we don't have an output frame then we need to render our
        // own screenshot (so we just use the text in the editor)
        if (!this.hasFrame()) {
            var canvas = document.createElement("canvas");
            canvas.width = 200;
            canvas.height = 200;
            var ctx = canvas.getContext("2d");

            // Default sizing, we also use a 5px margin
            var lineHeight = 24;
            var maxWidth = 190;

            // We go through all of this so that the text will wrap nicely
            var text = this.aceWrapperRef.current.text();

            // Remove all HTML markup and un-escape entities
            text = text.replace(/<[^>]+>/g, "");
            text = text.replace(/&nbsp;|&#160;/g, " ");
            text = text.replace(/&lt;|&#60;/g, "<");
            text = text.replace(/&gt;|&#62;/g, ">");
            text = text.replace(/&amp;|&#38;/g, "&");
            text = text.replace(/&quot;|&#34;/g, '"');
            text = text.replace(/&apos;|&#39;/g, "'");

            var words = text.split(/\s+/);
            var lines = 0;
            var currentLine = words[0];

            ctx.font = lineHeight + "px serif";

            for (var i = 1; i < words.length; i++) {
                var word = words[i];
                var width = ctx.measureText(currentLine + " " + word).width;
                if (width < maxWidth) {
                    currentLine += " " + word;
                } else {
                    lines += 1;
                    ctx.fillText(currentLine, 5, (lineHeight + 5) * lines);
                    currentLine = word;
                }
            }
            lines += 1;
            ctx.fillText(currentLine, 5, (lineHeight + 5) * lines + 5);

            // Render it to an image and we're done!
            callback(canvas.toDataURL("image/png"));
            return;
        }

        const handleScreenshotMessage = function(e) {
            // Only call if the data is actually an image!
            if (/^data:/.test(e.data)) {
                callback(e.data);
            }
        };

        // Unbind event listeners set for previous screenshots
        window.removeEventListener("message", handleScreenshotMessage);
        // We're only expecting one screenshot back
        window.addEventListener("message", handleScreenshotMessage);

        // Ask the frame for a screenshot
        this.postFrame({screenshot: true});
    }

    // TODO(pamela): Send these requests as timestamped props in future
    requestEditorCodeChange(code) {
        this.aceWrapperRef.current.text(code);
    }

    requestEditorFocus() {
        this.aceWrapperRef.current.focus();
    }

    cleanErrors(errors) {
        var loopProtectMessages = {
            WhileStatement: i18n._("<code>while</code> loop"),
            DoWhileStatement: i18n._("<code>do-while</code> loop"),
            ForStatement: i18n._("<code>for</code> loop"),
            FunctionDeclaration: i18n._("<code>function</code>"),
            FunctionExpression: i18n._("<code>function</code>"),
        };

        errors = errors.map(
            function(error) {
                // These errors come from the user, so we can't trust them.  They
                // get decoded from JSON, so they will just be plain objects, not
                // arbitrary classes, but they're still potentially full of HTML
                // that we need to escape.  So any HTML we want to put in needs to
                // get put in here, rather than somewhere inside the iframe.
                delete error.html;
                // TODO(benkraft): This is a kind of ugly place to put this
                // processing.  Refactor so that we don't have to do something
                // quite so ad-hoc here, while still keeping any user input
                // appropriately sanitized.
                var loopNodeType = error.infiniteLoopNodeType;
                if (loopNodeType) {
                    error.html = i18n._(
                        "A %(type)s is taking too long to run. " +
                            "Perhaps you have a mistake in your code?",
                        {
                            type: loopProtectMessages[loopNodeType],
                        },
                    );
                }

                const newError = {};

                // error.html was cleared above, so if it exists it's because we
                // reset it, and it's safe.
                if (typeof error === "string") {
                    newError.text = clean(error);
                } else if (error.html) {
                    newError.text = error.html;
                } else {
                    newError.text = clean(error.text || error.message || "");
                }

                // Coerce anything from the user to the expected types before
                // copying over
                if (error.lint !== undefined) {
                    newError.lint = {};

                    // TODO(benkraft): Coerce this in a less ad-hoc way, or at
                    // least only pass through the things we'll actually use.
                    // Also, get a stronger guarantee that none of these
                    // strings ever get used unescaped.
                    const numberProps = ["character", "line"];
                    const stringProps = [
                        "code",
                        "evidence",
                        "id",
                        "raw",
                        "reason",
                        "scope",
                        "type",
                    ];
                    const objectProps = ["openTag"];

                    numberProps.forEach((prop) => {
                        if (error.lint[prop] != undefined) {
                            newError.lint[prop] = +error.lint[prop];
                        }
                    });

                    stringProps.forEach((prop) => {
                        if (error.lint[prop] != undefined) {
                            newError.lint[prop] = error.lint[prop].toString();
                        }
                    });

                    objectProps.forEach((prop) => {
                        if (error.lint[prop] != undefined) {
                            newError.lint[prop] = error.lint[prop];
                        }
                    });
                }

                if (error.row != undefined) {
                    newError.row = +error.row;
                }

                if (error.column != undefined) {
                    newError.column = +error.column;
                }

                if (error.type != undefined) {
                    newError.type = error.type.toString();
                }

                if (error.source != undefined) {
                    newError.source = error.source.toString();
                }

                if (error.priority != undefined) {
                    newError.priority = +error.priority;
                }

                return newError;
            }.bind(this),
        );

        errors = errors.sort(function(a, b) {
            var diff = a.row - b.row;
            return diff === 0 ? (a.priority || 99) - (b.priority || 99) : diff;
        });

        return errors;
    }

    render() {
        return (
            <div
                className={classNames(
                    "scratchpad-wrap",
                    this.hasFrame() ? "" : "no-output",
                    css(
                        styles.wrap,
                        this.props.hideEditor &&
                            isResizable &&
                            styles.wrapNoEditorResizable,
                    ),
                )}
                ref={this.wrapRef}
            >
                <div
                    className={css(
                        styles.wrapOuter,
                        !this.props.hideEditor && styles.wrapBorder,
                    )}
                >
                    <div className={css(styles.wrapInner)}>
                        {this.renderEditorSide()}
                        {this.renderDragHandle()}
                        {this.renderOutputSide()}
                    </div>
                    {this.renderPlaybackBar()}
                    {this.renderRecordColorButtons()}
                    {this.renderRecordButton()}
                    {this.renderRecordControls()}
                </div>
            </div>
        );
    }
}

LiveEditor.registerEditor = function(name, editor) {
    editors[name] = editor;
};

const defaultDim = 400;
const defaultBorder = `2px solid #D6D8DA`;
const defaultBorderRadius = 5;

const styles = StyleSheet.create({
    dragHandle: {
        background: "#D6D8DA",
        cursor: "ew-resize",
        display: "table-cell",
        flexShrink: 0,
        width: 2,
    },
    dragHandleActive: {
        boxShadow: "0 0 4px 1px #444",
        width: "3px",
    },
    editorWrap: {
        borderRight: defaultBorder,
        display: "flex",
        flexDirection: "column",
        marginRight: "auto",
        minHeight: defaultDim,
        flexGrow: 1,
        flexShrink: 1,
    },
    editorHidden: {
        display: "none",
    },
    editorContainer: {
        display: "flex",
        flexDirection: "column",
        flexGrow: 1,
        flexShrink: 1,
        position: "relative",
    },
    // This is ambiguously named -- refers to the contents of a tab, *NOT*
    // the tab button or buttons at the top of the challenge content editor.
    editorTab: {
        position: "absolute",
        padding: 0,
        height: "100%",
        width: "100%",
    },
    editorTabDocument: {
        position: "static",
    },
    inputFrame: {
        height: "100%",
        position: "relative",
    },
    playbar: {
        borderTop: defaultBorder,
        display: "flex",
        padding: 5,
    },
    playbackBar: {
        flex: "1 0 0",
    },
    playbackSide: {
        paddingLeft: "10px",
    },
    toolbarWrap: {
        borderTop: defaultBorder,
        padding: 10,
    },
    wrap: {
        // These two make .wrapInner hide border-radius overflow *shrug*
        position: "relative",
        zIndex: 0,
        flexGrow: 1,
        display: "flex",
        flexDirection: "row",
        minWidth: defaultDim,
    },
    wrapNoEditorResizable: {
        minWidth: "100%",
    },
    wrapOuter: {
        flexGrow: 1,
    },
    wrapBorder: {
        borderRadius: defaultBorderRadius,
        border: defaultBorder,
        overflow: "auto",
        // Also required to make the border-radius overflow work
        transform: "scale(1)",
    },
    wrapInner: {
        display: "flex",
    },
});
