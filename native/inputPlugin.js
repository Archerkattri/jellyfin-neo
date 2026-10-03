(function() {
const remap = {
    "play_pause": "playpause",
    "seek_forward": "fastforward",
    "seek_backward": "rewind",
    "host:fullscreen": "togglefullscreen",
    "cycle_audio": "changeaudiotrack",
    "cycle_subtitles": "changesubtitletrack",
    "increase_volume": "volumeup",
    "decrease_volume": "volumedown",
    "step_backward": "previouschapter",
    "step_forward": "nextchapter",
    "enter": "select",
}

class inputPlugin {
    constructor({ inputManager, playbackManager }) {
        this.name = 'Input Plugin';
        this.type = 'input';
        this.id = 'inputPlugin';

        this.durationCheckInterval = null;
        this.positionUpdateInterval = null;
        this.attachedPlayer = null;
        this.playbackManager = playbackManager;
        this._apiSignalHandlers = [];
        this._playbackManagerHandlers = [];
        this._attachedPlayerHandlers = [];
        this._settingsUpdateHandler = null;
        this._destroyed = false;

        // Handle desktop navigation after page handlers have had the chance
        // to consume the key; editable controls and dialogs keep native input.
        this.desktopNavigationKey = (event) => {
            if (window.jmpInfo.settings.main.webMode !== 'desktop' ||
                event.defaultPrevented || event.repeat || event.isComposing ||
                event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
                (event.key !== 'Escape' && event.key !== 'Backspace')) {
                return;
            }

            if (event.composedPath().some(element => element instanceof HTMLElement &&
                (element.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName)))) {
                return;
            }

            if (document.querySelector('dialog[open], .dialog.opened, [role="dialog"][aria-modal="true"]') ||
                (event.key === 'Escape' &&
                 (document.fullscreenElement || window.jmpInfo.settings.main.fullscreen))) {
                return;
            }

            event.preventDefault();
            inputManager.handleCommand('back', {});
        };
        window.addEventListener('keydown', this.desktopNavigationKey);

        (async () => {
            const api = await window.apiPromise;
            if (this._destroyed) return;

            this._connectSignal(api.input.hostInput, (actions) => {
                actions.forEach(action => {
                    if (action === 'shuffle') {
                        playbackManager.setQueueShuffleMode('Shuffle');
                    } else if (action === 'sorted') {
                        playbackManager.setQueueShuffleMode('Sorted');
                    } else if (action === 'previous') {
                        const currentPlayer = playbackManager._currentPlayer;
                        if (currentPlayer && playbackManager.isPlayingAudio(currentPlayer)) {
                            const currentTime = playbackManager.currentTime(currentPlayer);
                            const currentIndex = playbackManager.getCurrentPlaylistIndex(currentPlayer);

                            if (currentTime >= 5 * 1000 || currentIndex <= 0) {
                                playbackManager.seekPercent(0, currentPlayer);
                            } else {
                                playbackManager.previousTrack(currentPlayer);
                            }
                        } else if (currentPlayer) {
                            playbackManager.previousTrack(currentPlayer);
                        }
                    } else {
                        if (remap.hasOwnProperty(action)) {
                            action = remap[action];
                        }

                        if (action.startsWith('host:')) {
                            api.input.executeActions([action]);
                        } else {
                            inputManager.handleCommand(action, {});
                        }
                    }
                });
            });

            const updateQueueState = function() {
                try {
                    if (!api || !api.player) {
                        return;
                    }

                    const playlist = playbackManager._playQueueManager?.getPlaylist();
                    if (!playlist || !Array.isArray(playlist)) {
                        return;
                    }

                    const currentIndex = playbackManager._playQueueManager?.getCurrentPlaylistIndex();
                    if (currentIndex === undefined || currentIndex === null || currentIndex < 0) {
                        return;
                    }

                    const canNext = currentIndex < playlist.length - 1;

                    const state = playbackManager.getPlayerState();
                    const isMusic = state?.NowPlayingItem?.MediaType === 'Audio';
                    const canPrevious = isMusic ? true : currentIndex > 0;

                    api.player.notifyQueueChange(canNext, canPrevious);
                } catch (e) {
                    console.error('PlayerMedia: Error in updateQueueState:', e);
                }
            };

                let lastReportedPosition = 0;

                let lastFullscreenState = window.jmpInfo.settings.main.fullscreen;
                this._settingsUpdateHandler = (section) => {
                    if (section === 'main') {
                        const currentFullscreenState = window.jmpInfo.settings.main.fullscreen;
                        if (currentFullscreenState !== lastFullscreenState) {
                            lastFullscreenState = currentFullscreenState;
                            const currentPlayer = playbackManager._currentPlayer;
                            if (currentPlayer) {
                                window.Events.trigger(currentPlayer, 'fullscreenchange');
                            }
                        }
                    }
                };
                window.jmpInfo.settingsUpdate.push(this._settingsUpdateHandler);

                if (window.api && window.api.player) {
                    this._connectSignal(window.api.player.playbackRateChanged, (rate) => {
                        const currentPlayer = playbackManager._currentPlayer;

                        if (currentPlayer && currentPlayer._playRate !== undefined) {
                            currentPlayer._playRate = rate;
                        }

                        if (window.Events && currentPlayer) {
                            window.Events.trigger(currentPlayer, 'ratechange');
                        }
                    });
                } else {
                    console.log('SystemMedia: Cannot attach playbackRateChanged listener - api:', !!window.api, 'player:', !!window.api?.player);
                }

                if (window.api && window.api.input) {
                    this._connectSignal(window.api.input.volumeChanged, (volume) => {
                        const currentPlayer = playbackManager._currentPlayer;
                        if (currentPlayer && typeof currentPlayer.setVolume === 'function') {
                            currentPlayer.setVolume(volume);
                        }
                    });

                    this._connectSignal(window.api.input.rateChanged, (rate) => {
                        const currentPlayer = playbackManager._currentPlayer;
                        if (currentPlayer && typeof currentPlayer.setPlaybackRate === 'function') {
                            currentPlayer.setPlaybackRate(rate);
                        }
                    });

                    // WORKAROUND: MPRIS spec has no "Buffering" playback state
                    // During seek buffering, we set Rate to 0.0 to stop MPRIS clients from
                    // auto-incrementing position. Once buffering completes, we restore Rate to 1.0.

                    this._connectSignal(window.api.input.positionSeek, (positionMs) => {
                        const currentPlayer = playbackManager._currentPlayer;
                        if (currentPlayer) {
                            const duration = playbackManager.duration();
                            if (duration) {
                                const percent = (positionMs * 10000) / duration * 100;
                                playbackManager.seekPercent(percent, currentPlayer);
                            }
                        }

                        api.player.notifyPosition(Math.floor(positionMs));
                        lastReportedPosition = positionMs;

                        api.player.notifyRateChange(0.0);
                    });
                }

                this._listenTo(playbackManager, 'playlistitemremove', updateQueueState, this._playbackManagerHandlers);
                this._listenTo(playbackManager, 'playlistitemadd', updateQueueState, this._playbackManagerHandlers);
                this._listenTo(playbackManager, 'playlistitemchange', updateQueueState, this._playbackManagerHandlers);

                this._listenTo(playbackManager, 'playbackstop', function(e, playbackStopInfo) {
                    updateQueueState();

                    const isNavigating = !!(playbackStopInfo && playbackStopInfo.nextMediaType);
                    api.player.notifyPlaybackStop(isNavigating);
                }, this._playbackManagerHandlers);

            this._listenTo(playbackManager, 'playbackstart', (e, player) => {
                if (!player) return;

                const state = playbackManager.getPlayerState();
                if (state && state.NowPlayingItem) {
                    api.player.notifyMetadata(state.NowPlayingItem);

                    const initialPos = playbackManager.currentTime();
                    if (initialPos !== undefined && initialPos !== null) {
                        api.player.notifyPosition(Math.floor(initialPos));
                        lastReportedPosition = initialPos;
                    }

                    if (player && typeof player.getVolume === 'function') {
                        const volume = player.getVolume();
                        api.player.notifyVolumeChange(volume / 100.0);
                    }
                }

                let lastDuration = 0;
                const checkDuration = function() {
                    const duration = playbackManager.duration();
                    if (duration && duration !== lastDuration) {
                        lastDuration = duration;
                        const durationMs = Math.floor(duration / 10000);
                        api.player.notifyDurationChange(durationMs);
                    }
                };

                if (player !== this.attachedPlayer) {
                    this._disconnectEvents(this._attachedPlayerHandlers);

                    this.attachedPlayer = player;

                    this._listenTo(player, 'shufflequeuemodechange', () => {
                    const mode = playbackManager.getQueueShuffleMode();
                    const enabled = (mode === 'Shuffle');
                    api.player.notifyShuffleChange(enabled);
                }, this._attachedPlayerHandlers);

                this._listenTo(player, 'repeatmodechange', () => {
                    const mode = playbackManager.getRepeatMode();
                    api.player.notifyRepeatChange(mode);
                }, this._attachedPlayerHandlers);

                this._listenTo(player, 'playing', () => {
                    api.player.notifyPlaybackState('Playing');

                    updateQueueState();

                    api.player.notifyRateChange(1.0);

                    if (this.durationCheckInterval) {
                        clearInterval(this.durationCheckInterval);
                    }
                    checkDuration();
                    this.durationCheckInterval = setInterval(checkDuration, 1000);

                    const initialPos = playbackManager.currentTime();
                    if (initialPos !== undefined && initialPos !== null) {
                        api.player.notifyPosition(Math.floor(initialPos));
                    }

                    if (this.positionUpdateInterval) {
                        clearInterval(this.positionUpdateInterval);
                    }
                    this.positionUpdateInterval = setInterval(() => {
                        const positionMs = playbackManager.currentTime();
                        if (positionMs !== undefined && positionMs !== null) {
                            const positionDiff = Math.abs(positionMs - lastReportedPosition);
                            if (lastReportedPosition > 0 && positionDiff > 2000) {
                                api.player.notifyRateChange(0.0);
                                api.player.notifySeek(Math.floor(positionMs));
                            } else {
                                api.player.notifyPosition(Math.floor(positionMs));
                            }
                            lastReportedPosition = positionMs;
                        }
                    }, 500);
                }, this._attachedPlayerHandlers);

                this._listenTo(player, 'pause', () => {
                    api.player.notifyPlaybackState('Paused');
                    api.player.notifyRateChange(0.0);

                    if (this.durationCheckInterval) {
                        clearInterval(this.durationCheckInterval);
                        this.durationCheckInterval = null;
                    }

                    const currentPos = playbackManager.currentTime();
                    if (currentPos !== undefined && currentPos !== null) {
                        lastReportedPosition = currentPos;
                    }
                }, this._attachedPlayerHandlers);

                this._listenTo(player, 'playbackstop', () => {
                    if (this.durationCheckInterval) {
                        clearInterval(this.durationCheckInterval);
                        this.durationCheckInterval = null;
                    }

                    if (this.positionUpdateInterval) {
                        clearInterval(this.positionUpdateInterval);
                        this.positionUpdateInterval = null;
                    }

                    lastDuration = 0;
                    lastReportedPosition = 0;
                }, this._attachedPlayerHandlers);

                    this._listenTo(player, 'volumechange', () => {
                        if (player && typeof player.getVolume === 'function') {
                            const volume = player.getVolume();
                            api.player.notifyVolumeChange(volume / 100.0);
                        }
                    }, this._attachedPlayerHandlers);

                    this._listenTo(player, 'ratechange', () => {
                        if (player && typeof player.getPlaybackRate === 'function') {
                            const rate = player.getPlaybackRate();
                            api.player.notifyRateChange(rate);
                        }
                    }, this._attachedPlayerHandlers);

                    this._listenTo(player, 'timeupdate', () => {
                        const positionMs = playbackManager.currentTime();
                        if (positionMs !== undefined && positionMs !== null) {
                            const positionDiff = Math.abs(positionMs - lastReportedPosition);
                            if (lastReportedPosition > 0 && positionDiff > 2000) {
                                // Player-initiated seek - set rate to 0 during buffering
                                api.player.notifyRateChange(0.0);
                                api.player.notifySeek(Math.floor(positionMs));
                            } else if (positionDiff > 100) {
                                api.player.notifyPosition(Math.floor(positionMs));
                            }
                            lastReportedPosition = positionMs;
                        }
                    }, this._attachedPlayerHandlers);
                }
            }, this._playbackManagerHandlers);

            api.system.hello("jmpInputPlugin");
        })();
    }

    _connectSignal(signal, handler) {
        signal.connect(handler);
        this._apiSignalHandlers.push([signal, handler]);
    }

    _listenTo(target, eventName, handler, handlerCollection) {
        window.Events.on(target, eventName, handler);
        handlerCollection.push([target, eventName, handler]);
    }

    _disconnectEvents(handlerCollection) {
        for (const [target, eventName, handler] of handlerCollection) {
            window.Events.off(target, eventName, handler);
        }
        handlerCollection.length = 0;
    }

    destroy() {
        this._destroyed = true;
        window.removeEventListener('keydown', this.desktopNavigationKey);
        if (this.durationCheckInterval) {
            clearInterval(this.durationCheckInterval);
            this.durationCheckInterval = null;
        }

        if (this.positionUpdateInterval) {
            clearInterval(this.positionUpdateInterval);
            this.positionUpdateInterval = null;
        }

        for (const [signal, handler] of this._apiSignalHandlers) {
            signal.disconnect(handler);
        }
        this._apiSignalHandlers = [];

        if (this._settingsUpdateHandler) {
            const updateHandlers = window.jmpInfo.settingsUpdate;
            const index = updateHandlers.indexOf(this._settingsUpdateHandler);
            if (index !== -1) updateHandlers.splice(index, 1);
            this._settingsUpdateHandler = null;
        }

        this._disconnectEvents(this._attachedPlayerHandlers);
        this._disconnectEvents(this._playbackManagerHandlers);
        this.attachedPlayer = null;
        this.playbackManager = null;

        console.log('SystemMedia: inputPlugin destroyed and cleaned up');
    }
}

window._inputPlugin = inputPlugin;
})();
