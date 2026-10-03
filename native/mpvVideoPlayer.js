/* eslint-disable indent */
(function() {
    function clampVolume(value, maxVolume) {
        const volume = Number(value);
        if (!Number.isFinite(volume)) return null;

        const configuredMax = Number(maxVolume);
        const ceiling = Number.isFinite(configuredMax) ? Math.min(200, Math.max(100, configuredMax)) : 100;
        return Math.min(Math.max(Math.round(volume), 0), ceiling);
    }

    function getMediaStreamAudioTracks(mediaSource) {
        return mediaSource.MediaStreams.filter(function (s) {
            return s.Type === 'Audio';
        });
    }

    function seriesTrackStoreKey(kind, seriesId) {
        return `mpv-series-${kind}-${seriesId}`;
    }

    function normalizeTrackLanguage(value) {
        return typeof value === 'string' ? value.trim().toLowerCase() : '';
    }

    function findStreamIndexByLanguage(streams, type, language) {
        const want = normalizeTrackLanguage(language);
        if (!want) return null;
        for (const stream of streams) {
            if (stream.Type !== type || normalizeTrackLanguage(stream.Language) !== want) continue;
            return stream.Index;
        }
        return null;
    }

    function pickSegmentSkip(segments, timeMs, durationMs, options, skipped) {
        for (const segment of segments) {
            if (skipped.has(segment.id)) continue;

            const isIntro = segment.type === 'Intro';
            if (isIntro ? !options.skipIntro : !options.skipOutro) continue;

            const start = segment.start + (isIntro ? 0 : options.outroDelayMs);
            if (timeMs < start || timeMs >= segment.end - 1000) continue;

            // Leave enough time for mpv to reach EOF and Jellyfin Web to advance the queue.
            const target = Number.isFinite(durationMs) && durationMs > 500
                ? Math.min(segment.end, durationMs - 500)
                : segment.end;
            return { id: segment.id, target };
        }

        return null;
    }

    class mpvVideoPlayer {
        constructor({ events, loading, appRouter, globalize, appHost, appSettings, confirm, dashboard }) {
            this.events = events;
            this.loading = loading;
            this.appRouter = appRouter;
            this.globalize = globalize;
            this.appHost = appHost;
            this.appSettings = appSettings;

            this.setTransparency = dashboard.default.setBackdropTransparency.bind(dashboard);

            /**
             * @type {string}
             */
            this.name = 'MPV Video Player';
            /**
             * @type {string}
             */
            this.type = 'mediaplayer';
            /**
             * @type {string}
             */
            this.id = 'mpvvideoplayer';
            this.syncPlayWrapAs = 'htmlvideoplayer';
            this.priority = -1;
            this.useFullSubtitleUrls = true;
            /**
             * @type {boolean}
             */
            this.isLocalPlayer = true;
            /**
             * @type {boolean}
             */
            this.isFetching = false;

            /**
             * @type {HTMLDivElement | null | undefined}
             */
            this._videoDialog = undefined;
            /**
             * @type {number | undefined}
             */
            this._subtitleTrackIndexToSetOnPlaying = undefined;
            /**
             * @type {number | undefined}
             */
            this._secondarySubtitleTrackIndexToSetOnPlaying = undefined;
            /**
             * @type {number | null}
             */
            this._audioTrackIndexToSetOnPlaying = undefined;
            /**
             * @type {boolean | undefined}
             */
            this._showTrackOffset = undefined;
            /**
             * @type {number | undefined}
             */
            this._currentTrackOffset = undefined;
            /**
             * @type {string[] | undefined}
             */
            this._supportedFeatures = undefined;
            /**
             * @type {string | undefined}
             */
            this._currentSrc = undefined;
            /**
             * @type {boolean | undefined}
             */
            this._started = undefined;
            /**
             * @type {boolean | undefined}
             */
            this._timeUpdated = undefined;
            /**
             * @type {number | null | undefined}
             */
            this._currentTime = undefined;
            /**
             * @private (used in other files)
             * @type {any | undefined}
             */
            this._currentPlayOptions = undefined;
            /**
             * @type {any | undefined}
             */
            this._lastProfile = undefined;
            /**
             * @type {number | undefined}
             */
            this._duration = undefined;
            /**
             * Intro/outro segments for the current item, in milliseconds.
             * @type {Array<{id: string, type: string, start: number, end: number}>}
             */
            this._segments = [];
            /** @type {Set<string>} */
            this._skippedSegments = new Set();
            /**
             * @type {boolean}
             */
            this._paused = false;
            /**
             * Picture-in-picture (always-on-top window) state for the current item.
             * @type {boolean}
             */
            this._pictureInPicture = false;
            /**
             * @type {int}
             */
            this._volume = 100;
            /**
             * mpv video-zoom level (log2 scale: 0 = 1x). Clamped to [-1, 2].
             * @type {number}
             */
            this._videoZoom = 0;
            /**
             * @type {boolean}
             */
            this._muted = false;
            /**
             * @type {float}
             */
            this._playRate;
            /**
             * @type {boolean}
             */
            this._hasConnection = false;
            this._debugSignalHandlers = [];
            /**
             * @type {Array<{start: number, end: number}>}
             */
            this._bufferedRanges = [];

            /**
             * @private
             */
            this.onBufferedRangesUpdated = (ranges) => {
                this._bufferedRanges = ranges;
            };

            /**
             * @private
             */
            this.onEnded = () => {
                this.onEndedInternal();
            };

            /**
             * @private
             */
            this.onWheel = (e) => {
                if (!this._videoDialog) return;
                // Ctrl+wheel zooms the video (pinch gestures arrive the same way
                // on trackpads); a plain wheel keeps adjusting the volume.
                if (e.ctrlKey && this.isVideoZoomAllowed()) {
                    e.preventDefault();
                    this.adjustVideoZoom(e.deltaY < 0 ? 0.25 : -0.25);
                    return;
                }
                e.preventDefault();
                if (e.deltaY < 0) {
                    this.volumeUp();
                } else {
                    this.volumeDown();
                }
                this.showVolumeIndicator();
            };

            /**
             * @private
             */
            this.onTimeUpdate = (time) => {
                this._sub643MaybeResync('timeupdate');
                if (time && !this._timeUpdated) {
                    this._timeUpdated = true;
                }

                this._currentTime = Number.isFinite(time) ? Math.round(time) : time;
                this.checkSegmentSkip(this._currentTime);
                this.events.trigger(this, 'timeupdate');
            };

            /**
             * @private
             */
            this.onPlaying = () => {
                if (!this._started) {
                    this._started = true;

                    this.loading.hide();

                    const volume = Math.round(this.getSavedVolume() * 100);
                    this.setVolume(volume, false);

                    this.setPlaybackRate(this.getPlaybackRate());

                    // Hide backdrop when playback starts
                    const dlg = this._videoDialog;
                    if (dlg) {
                        dlg.style.backgroundImage = '';
                    }

                    // Navigate to OSD view to show playback screen
                    if (this._currentPlayOptions.fullscreen) {
                        this.appRouter.showVideoOsd();
                        // Lower video dialog z-index so OSD can receive input
                        if (dlg) {
                            dlg.style.zIndex = 'unset';
                        }
                    }

                    // Keep video fullscreen - native OSD is above it
                    window.api.player.setVideoRectangle(0, 0, 0, 0);
                }

                if (this._paused) {
                    this._paused = false;
                    this.events.trigger(this, 'unpause');
                }

                this.events.trigger(this, 'playing');
            };

            /**
             * @private
             */
            this.onPause = () => {
                this._paused = true;
                // For Syncplay ready notification
                this.events.trigger(this, 'pause');
            };

            this.onWaiting = () => {
                this.events.trigger(this, 'waiting');
            };

            /**
             * @private
             * @param e {Event} The event received from the `<video>` element
             */
            this.onError = async (error) => {
                this.removeMediaDialog();
                console.error(`media error: ${error}`);

                const errorData = {
                    type: 'mediadecodeerror'
                };

                try {
                    await confirm({
                        title: "Playback Failed",
                        text: `Playback failed with error "${error}". Retry with transcode? (Note this may hang the player.)`,
                        cancelText: "Cancel",
                        confirmText: "Retry"
                    });
                } catch (ex) {
                    // User declined retry
                    errorData.streamInfo = {
                        // Prevent jellyfin-web retrying with transcode
                        // which crashes the player
                        mediaSource: {
                            SupportsTranscoding: false
                        }
                    };
                }

                this.events.trigger(this, 'error', [errorData]);
            };

            this.onDuration = (duration) => {
                this._duration = duration;
            };
        }

        currentSrc() {
            return this._currentSrc;
        }

        async play(options) {
            this.setPictureInPictureEnabled(false);
            this._started = false;
            this._timeUpdated = false;
            this._currentTime = null;
            this._duration = undefined;
            this._bufferedRanges = [];
            this._segments = [];
            this._skippedSegments = new Set();
            this._sub643Cancel();
            this._sub643Done = false;
            this._sub643UserTouched = false;
            this._sub643JellyIndex = undefined;
            this._sub643Param = undefined;
            // Remember the host window state so leaving the player UI can
            // restore it: the web client never resets native fullscreen
            // itself. Only the first play() of a session records it, so
            // back-to-back items keep a fullscreen binge uninterrupted.
            if (this._fullscreenBeforePlayback === undefined) {
                this._fullscreenBeforePlayback = this.isFullscreen();
            }

            this.resetSubtitleOffset();
            if (options.fullscreen) {
                this.loading.show();
            }
            const elem = await this.createMediaElement(options);
            return await this.setCurrentSrc(elem, options);
        }

        getSavedVolume() {
            const savedVolume = this.appSettings.get('volume');
            if (savedVolume == null || savedVolume === '') return 1;
            const volume = Number(savedVolume);
            return Number.isFinite(volume) ? Math.max(0, volume) : 1;
        }


        tryGetFramerate(options) {
            if (options.mediaSource && options.mediaSource.MediaStreams) {
                for (let stream of options.mediaSource.MediaStreams) {
                    if (stream.Type == "Video") {
                        return stream.RealFrameRate || stream.AverageFrameRate || null;
                    }
                }
            }
        }

        /**
         * @private
         */
        getStreamByIndex(mediaStreams, jellyIndex) {
            for (const stream of mediaStreams) {
                if (stream.Index == jellyIndex) {
                    return stream;
                }
            }
            return null;
        }

        /**
         * @private
         */
        getRelativeIndexByType(mediaStreams, jellyIndex, streamType) {
            let relIndex = 1;
            for (const source of mediaStreams) {
                if (source.Type != streamType || source.IsExternal) {
                    continue;
                }
                if (source.Index == jellyIndex) {
                    return relIndex;
                }
                relIndex += 1;
            }
            return null;
        }

        getSeriesId(playOptions) {
            const seriesId = playOptions?.item?.SeriesId;
            return typeof seriesId === 'string' && seriesId ? seriesId : null;
        }

        readSeriesTrackLanguage(kind, seriesId) {
            if (!seriesId || !this.appSettings || typeof this.appSettings.get !== 'function') return null;
            const value = this.appSettings.get(seriesTrackStoreKey(kind, seriesId));
            return typeof value === 'string' && value ? value : null;
        }

        rememberSeriesTrack(kind, jellyIndex) {
            // Only manual picks made while an episode is playing are remembered;
            // anything applied before the first frame is a programmatic default.
            if (this._started !== true) return;
            const playOptions = this._currentPlayOptions;
            const seriesId = this.getSeriesId(playOptions);
            if (!seriesId || !this.appSettings || typeof this.appSettings.set !== 'function') return;
            if (jellyIndex == null || jellyIndex < 0) {
                // "Subtitles off" is a real preference; an unset audio track just
                // falls back to the server default next episode.
                this.appSettings.set(seriesTrackStoreKey(kind, seriesId), kind === 'subtitle' ? 'off' : '');
                return;
            }
            const streams = playOptions?.mediaSource?.MediaStreams || [];
            const stream = this.getStreamByIndex(streams, jellyIndex);
            const language = stream && typeof stream.Language === 'string' ? stream.Language : '';
            this.appSettings.set(seriesTrackStoreKey(kind, seriesId), language);
        }

        applySeriesTrackMemory(options) {
            const seriesId = this.getSeriesId(options);
            if (!seriesId) return;
            const streams = options?.mediaSource?.MediaStreams || [];
            const audioLanguage = this.readSeriesTrackLanguage('audio', seriesId);
            if (audioLanguage) {
                const match = findStreamIndexByLanguage(streams, 'Audio', audioLanguage);
                if (match != null) {
                    this._audioTrackIndexToSetOnPlaying = match;
                }
            }
            const subtitleLanguage = this.readSeriesTrackLanguage('subtitle', seriesId);
            if (subtitleLanguage === 'off') {
                this._subtitleTrackIndexToSetOnPlaying = -1;
            } else if (subtitleLanguage) {
                const match = findStreamIndexByLanguage(streams, 'Subtitle', subtitleLanguage);
                if (match != null) {
                    this._subtitleTrackIndexToSetOnPlaying = match;
                }
            }
        }

        getAudioTrackIndex(playOptions, jellyIndex) {
            const isTranscode = playOptions?.playMethod === 'Transcode' ||
                Boolean(playOptions?.mediaSource?.TranscodingUrl);
            if (isTranscode || jellyIndex == null || jellyIndex < 0) {
                return 1;
            }

            const streams = playOptions?.mediaSource?.MediaStreams || [];
            return this.getRelativeIndexByType(streams, jellyIndex, 'Audio') ?? 1;
        }

        /**
         * @private
         */
        setCurrentSrc(elem, options) {
            return new Promise((resolve) => {
                const val = options.url;
                this._currentSrc = val;
                console.debug(`playing url: ${val}`);

                // Convert to seconds
                const ms = (options.playerStartPositionTicks || 0) / 10000;
                this._currentPlayOptions = options;
                // External player handoff: open the stream URL in the system's
                // default media player instead of loading it into mpv. A missing
                // system bridge falls through to normal in-app playback.
                if (window.jmpInfo && window.jmpInfo.settings && window.jmpInfo.settings.video
                        && window.jmpInfo.settings.video.external_player
                        && window.api && window.api.system && window.api.system.openExternalUrl) {
                    console.debug(`opening externally: ${val}`);
                    window.api.system.openExternalUrl(val);
                    resolve();
                    return;
                }
                this.loadMediaSegments(options);
                this._subtitleTrackIndexToSetOnPlaying = options.mediaSource.DefaultSubtitleStreamIndex == null ? -1 : options.mediaSource.DefaultSubtitleStreamIndex;
                this._audioTrackIndexToSetOnPlaying = options.mediaSource.DefaultAudioStreamIndex;
                this._secondarySubtitleTrackIndexToSetOnPlaying = -1;
                this.applySeriesTrackMemory(options);

                console.log('[MPV] Audio track index:', this._audioTrackIndexToSetOnPlaying);
                console.log('[MPV] Subtitle track index:', this._subtitleTrackIndexToSetOnPlaying);

                const streamdata = {type: 'video', headers: {'User-Agent': jmpInfo.userAgent}, metadata: options.item, media: {}};
                const fps = this.tryGetFramerate(options);
                if (fps) {
                    streamdata.frameRate = fps;
                }

                const player = window.api.player;

                // Handle audio
                const audioRelIndex = this.getAudioTrackIndex(options, this._audioTrackIndexToSetOnPlaying);

                const streams = options.mediaSource?.MediaStreams || [];

                // Handle subtitle - check for external first
                let subtitleParam;
                if (this._subtitleTrackIndexToSetOnPlaying >= 0) {
                    const subStream = this.getStreamByIndex(streams, this._subtitleTrackIndexToSetOnPlaying);
                    if (subStream && subStream.DeliveryMethod === 'External' && subStream.DeliveryUrl) {
                        subtitleParam = '#,' + subStream.DeliveryUrl;
                        console.log('[MPV] External subtitle URL:', subStream.DeliveryUrl);
                    } else {
                        const relIndex = this.getRelativeIndexByType(streams, this._subtitleTrackIndexToSetOnPlaying, 'Subtitle');
                        subtitleParam = relIndex != null ? relIndex : -1;
                        console.log('[MPV] Mapped subtitle index:', this._subtitleTrackIndexToSetOnPlaying, '->', subtitleParam);
                    }
                } else {
                    subtitleParam = -1;
                }

                console.log('[MPV] Mapped audio index:', this._audioTrackIndexToSetOnPlaying, '->', audioRelIndex);

                // Dual subtitles start disabled; jellyfin-web enables the
                // secondary track per item via setSecondarySubtitleStreamIndex.
                const secondaryParam = -1;

                // sub643: arm the one-shot subtitle resync when playback starts
                // with an auto-selected subtitle track (no-op when none is active).
                const sub643Active = subtitleParam != null && subtitleParam !== -1 && subtitleParam !== 'no';
                this._sub643Armed = sub643Active && this._sub643ResyncEnabled() && !this._sub643UserTouched;
                this._sub643Done = false;
                this._sub643JellyIndex = this._subtitleTrackIndexToSetOnPlaying;
                this._sub643Param = this._sub643Armed ? subtitleParam : undefined;
                if (this._sub643Armed) {
                    // Fallback only: the primary trigger is the first position
                    // update (see onTimeUpdate). Capped at 1500ms by design.
                    this._sub643FallbackTimer = setTimeout(() => this._sub643MaybeResync('fallback'), 1500);
                }

                player.load(val,
                    { startMilliseconds: ms, autoplay: true },
                    streamdata,
                    audioRelIndex,
                    subtitleParam,
                    secondaryParam,
                    resolve);
            });
        }

        setSubtitleStreamIndex(index) {
            console.log('[MPV] setSubtitleStreamIndex called with index:', index);
            // sub643: a divergent subtitle action means the user (or web UI)
            // took over track selection - disarm the auto resync so it can
            // never override their choice. Re-applying the identical auto
            // default is state-neutral and leaves the resync armed.
            if (index !== this._sub643JellyIndex) {
                this._sub643UserTouched = true;
                this._sub643Cancel();
            }
            this._subtitleTrackIndexToSetOnPlaying = index;
            this.rememberSeriesTrack('subtitle', index);

            if (index < 0) {
                window.api.player.setSubtitleStream(-1);
                return;
            }

            const streams = this._currentPlayOptions?.mediaSource?.MediaStreams || [];
            const stream = this.getStreamByIndex(streams, index);

            // Handle external subtitle URL
            if (stream && stream.DeliveryMethod === 'External' && stream.DeliveryUrl) {
                console.log('[MPV] Loading external subtitle:', stream.DeliveryUrl);
                window.api.player.setSubtitleStream('#,' + stream.DeliveryUrl);
                return;
            }

            // Handle embedded subtitle via relative index
            const relIndex = this.getRelativeIndexByType(streams, index, 'Subtitle');
            console.log('[MPV] Mapped subtitle index:', index, '->', relIndex);
            window.api.player.setSubtitleStream(relIndex != null ? relIndex : -1);
        }

        setSecondarySubtitleStreamIndex(index) {
            console.log('[MPV] setSecondarySubtitleStreamIndex called with index:', index);
            this._secondarySubtitleTrackIndexToSetOnPlaying = index;

            if (index < 0) {
                window.api.player.setSecondarySubtitleStream(-1);
                return;
            }

            const streams = this._currentPlayOptions?.mediaSource?.MediaStreams || [];
            const stream = this.getStreamByIndex(streams, index);

            // Handle external subtitle URL
            if (stream && stream.DeliveryMethod === 'External' && stream.DeliveryUrl) {
                console.log('[MPV] Loading external secondary subtitle:', stream.DeliveryUrl);
                window.api.player.setSecondarySubtitleStream('#,' + stream.DeliveryUrl);
                return;
            }

            // Handle embedded subtitle via relative index
            const relIndex = this.getRelativeIndexByType(streams, index, 'Subtitle');
            console.log('[MPV] Mapped secondary subtitle index:', index, '->', relIndex);
            window.api.player.setSecondarySubtitleStream(relIndex != null ? relIndex : -1);
        }

        /**
         * Whether the one-shot subtitle resync workaround (sub643) is enabled.
         * Defaults ON when the setting is absent (old configs predate the key).
         * @private
         */
        _sub643ResyncEnabled() {
            return window.jmpInfo?.settings?.subtitles?.resync_on_start !== false;
        }

        /**
         * One-shot resync: re-select the auto-loaded subtitle track (mpv sid
         * no -> N), forcing the subtitle renderer to re-init and apply ASS
         * PlayResX (mpv#17846). Both commands are issued synchronously so no
         * frame renders with subtitles hidden. Fires at most once per
         * playback; returns true when the cycle was issued.
         * @private
         */
        _sub643MaybeResync(reason) {
            if (!this._sub643Armed || this._sub643Done || this._sub643Param === undefined) return false;
            if (this._sub643UserTouched || !this._sub643ResyncEnabled()) {
                this._sub643Cancel();
                return false;
            }
            this._sub643Done = true;
            this._sub643Cancel();
            window.api.player.setSubtitleStream(-1);
            window.api.player.setSubtitleStream(this._sub643Param);
            console.debug(`[MPV] sub643 subtitle resync fired (${reason})`);
            return true;
        }

        /**
         * Disarm the one-shot resync (user took over / playback ended).
         * @private
         */
        _sub643Cancel() {
            this._sub643Armed = false;
            if (this._sub643FallbackTimer != null) {
                clearTimeout(this._sub643FallbackTimer);
                this._sub643FallbackTimer = null;
            }
        }

        resetSubtitleOffset() {
            this._currentTrackOffset = 0;
            this._showTrackOffset = false;
            window.api.player.setSubtitleDelay(0);
        }

        enableShowingSubtitleOffset() {
            this._showTrackOffset = true;
        }

        disableShowingSubtitleOffset() {
            this._showTrackOffset = false;
        }

        isShowingSubtitleOffsetEnabled() {
            return this._showTrackOffset;
        }

        setSubtitleOffset(offset) {
            const offsetValue = parseFloat(offset);
            this._currentTrackOffset = offsetValue;
            window.api.player.setSubtitleDelay(Math.round(offsetValue * 1000));
        }

        getSubtitleOffset() {
            return this._currentTrackOffset;
        }

        /**
         * @private
         */
        isAudioStreamSupported() {
            return true;
        }

        /**
         * @private
         */
        getSupportedAudioStreams() {
            const profile = this._lastProfile;

            return getMediaStreamAudioTracks(this._currentPlayOptions.mediaSource).filter((stream) => {
                return this.isAudioStreamSupported(stream, profile);
            });
        }

        setAudioStreamIndex(index) {
            console.log('[MPV] setAudioStreamIndex called with index:', index);
            this._audioTrackIndexToSetOnPlaying = index;
            this.rememberSeriesTrack('audio', index);

            const relIndex = index < 0 ? -1 : this.getAudioTrackIndex(this._currentPlayOptions, index);
            console.log('[MPV] Mapped audio index:', index, '->', relIndex);
            window.api.player.setAudioStream(relIndex != null ? relIndex : -1);
        }

        /**
         * Load chapter/intro segments when supported by the server or an installed plugin.
         * This is deliberately non-blocking so playback startup is unaffected.
         * @private
         */
        async loadMediaSegments(options) {
            const settings = window.jmpInfo.settings.video || {};
            if (!settings.skip_intro && !settings.skip_outro) return;

            const itemId = options.item?.Id;
            const apiClient = window.ApiClient || window.ServerConnections?.currentApiClient?.();
            if (!itemId || !apiClient) return;

            try {
                const result = await apiClient.getJSON(apiClient.getUrl(`MediaSegments/${encodeURIComponent(itemId)}`));

                // Ignore an earlier request that completes after playback moved to another item.
                if (this._currentPlayOptions?.item?.Id !== itemId) return;

                this._segments = (Array.isArray(result?.Items) ? result.Items : [])
                    .map((segment) => {
                        const start = Number(segment?.StartTicks) / 10000;
                        const end = Number(segment?.EndTicks) / 10000;
                        if (!segment?.Id || !['Intro', 'Outro'].includes(segment.Type) ||
                            !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
                            return null;
                        }

                        return { id: String(segment.Id), type: segment.Type, start, end };
                    })
                    .filter(Boolean)
                    .sort((a, b) => a.start - b.start);
            } catch (error) {
                // A server without segment support (or a missing optional provider) is normal.
                if (this._currentPlayOptions?.item?.Id === itemId) {
                    this._segments = [];
                    console.debug(`[MPV] no media segments for ${itemId}: ${error}`);
                }
            }
        }

        /** @private */
        checkSegmentSkip(timeMs) {
            const settings = window.jmpInfo.settings.video || {};
            const time = Number(timeMs);
            if (!Number.isFinite(time)) return;

            const configuredDelay = Number(settings.skip_outro_delay);
            const delayMs = Number.isFinite(configuredDelay) ? Math.max(0, configuredDelay) * 1000 : 0;
            const hit = pickSegmentSkip(this._segments, time, this._duration, {
                skipIntro: settings.skip_intro === true,
                skipOutro: settings.skip_outro === true,
                outroDelayMs: delayMs
            }, this._skippedSegments);

            if (hit) {
                // Mark first because more position updates can arrive before mpv applies the seek.
                this._skippedSegments.add(hit.id);
                window.api.player.seekTo(hit.target);
            }
        }

        onEndedInternal() {
            this.setPictureInPictureEnabled(false);
            this._sub643Cancel();
            this.resetVideoZoom();
            const stopInfo = {
                src: this._currentSrc
            };

            this.events.trigger(this, 'stopped', [stopInfo]);

            this._currentTime = null;
            this._currentSrc = null;
            this._currentPlayOptions = null;
            this._segments = [];
            this._skippedSegments = new Set();
        }

        stop(destroyPlayer) {
            window.api.player.stop();

            this.onEndedInternal();

            if (destroyPlayer) {
                this.destroy();
            }
            return Promise.resolve();
        }

        removeMediaDialog() {
            this.setPictureInPictureEnabled(false);
            this._sub643Cancel();
            window.api.player.stop();

            window.api.player.setVideoRectangle(-1, 0, 0, 0);

            document.body.classList.remove('hide-scroll');

            document.removeEventListener('wheel', this.onWheel);
            this.resetVideoZoom();
            clearTimeout(this._volumeIndicatorTimer);
            if (this._volumeIndicator) {
                this._volumeIndicator.remove();
                this._volumeIndicator = null;
            }

            const dlg = this._videoDialog;
            if (dlg) {
                this.setTransparency(0); // TRANSPARENCY_LEVEL.None
                this._videoDialog = null;
                dlg.parentNode.removeChild(dlg);
            }

            // Only supporting QtWebEngine here
            if (document.webkitIsFullScreen && document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            }

            // Restore the host window state captured when playback began.
            // The web client only exits its own HTML fullscreen above, so
            // without this the native window stays fullscreen after the
            // back button or episode end (#1085, #1187).
            if (this._fullscreenBeforePlayback !== undefined) {
                const wasFullscreen = this._fullscreenBeforePlayback;
                this._fullscreenBeforePlayback = undefined;
                if (!wasFullscreen && this.isFullscreen() && window.api && window.api.window) {
                    window.api.window.setFullScreen(false);
                }
            }
        }

        destroy() {
            this.removeMediaDialog();

            const player = window.api.player;
            this._hasConnection = false;
            this._bufferedRanges = [];
            this._segments = [];
            this._skippedSegments = new Set();
            player.playing.disconnect(this.onPlaying);
            player.positionUpdate.disconnect(this.onTimeUpdate);
            player.finished.disconnect(this.onEnded);
            this._duration = undefined;
            player.updateDuration.disconnect(this.onDuration);
            player.error.disconnect(this.onError);
            player.paused.disconnect(this.onPause);
            player.bufferedRangesUpdated.disconnect(this.onBufferedRangesUpdated);
            for (const [signal, handler] of this._debugSignalHandlers) {
                signal.disconnect(handler);
            }
            this._debugSignalHandlers = [];
        }

        /**
         * @private
         */
        createMediaElement(options) {
            const dlg = document.querySelector('.videoPlayerContainer');

            if (!dlg) {
                const dlg = document.createElement('div');

                dlg.classList.add('videoPlayerContainer');
                dlg.style.position = 'fixed';
                dlg.style.top = 0;
                dlg.style.bottom = 0;
                dlg.style.left = 0;
                dlg.style.right = 0;
                dlg.style.display = 'flex';
                dlg.style.alignItems = 'center';

                if (options.fullscreen) {
                    dlg.style.zIndex = 1000;
                }

                const html = '';

                dlg.innerHTML = html;

                // Set backdrop if available
                if (options.backdropUrl) {
                    dlg.style.backgroundImage = `url('${options.backdropUrl}')`;
                    dlg.style.backgroundSize = 'cover';
                    dlg.style.backgroundPosition = 'center';
                }

                document.body.insertBefore(dlg, document.body.firstChild);
                this.setTransparency(2); // TRANSPARENCY_LEVEL.Full
                this._videoDialog = dlg;
                document.addEventListener('wheel', this.onWheel, { passive: false });
                const player = window.api.player;
                if (!this._hasConnection) {
                    this._hasConnection = true;
                    player.playing.connect(this.onPlaying);
                    player.positionUpdate.connect(this.onTimeUpdate);
                    player.finished.connect(this.onEnded);
                    player.updateDuration.connect(this.onDuration);
                    player.error.connect(this.onError);
                    player.paused.connect(this.onPause);
                    player.bufferedRangesUpdated.connect(this.onBufferedRangesUpdated);
                }

                if (options.fullscreen) {
                    // At this point, we must hide the scrollbar placeholder, so it's not being displayed while the item is being loaded
                    document.body.classList.add('hide-scroll');
                }
                return Promise.resolve();
            } else {
                // we need to hide scrollbar when starting playback from page with animated background
                if (options.fullscreen) {
                    document.body.classList.add('hide-scroll');
                }

                return Promise.resolve();
            }
        }

    /**
     * @private
     */
    canPlayMediaType(mediaType) {
        return (mediaType || '').toLowerCase() === 'video';
    }

    canPlayItem(item, playOptions) {
        // Delegate to canPlayMediaType - MPV can play any video the media type check passes
        return this.canPlayMediaType(item.MediaType);
    }

    /**
     * @private
     */
    supportsPlayMethod() {
        return true;
    }

    /**
     * @private
     */
    getDeviceProfile(item, options) {
        if (this.appHost.getDeviceProfile) {
            return this.appHost.getDeviceProfile(item, options);
        }

        return Promise.resolve({});
    }

    /**
     * @private
     */
    static getSupportedFeatures() {
        return ['PlaybackRate', 'SetAspectRatio', 'PictureInPicture'];
    }

    supports(feature) {
        if (!this._supportedFeatures) {
            this._supportedFeatures = mpvVideoPlayer.getSupportedFeatures();
        }

        return this._supportedFeatures.includes(feature);
    }

    isFullscreen() {
        // Check native window fullscreen state
        if (window.jmpInfo && window.jmpInfo.settings && window.jmpInfo.settings.main) {
            return window.jmpInfo.settings.main.fullscreen === true;
        }
        return false;
    }

    toggleFullscreen() {
        if (window.api && window.api.input) {
            window.api.input.executeActions(['host:fullscreen']);
        }
    }

    // Save this for when playback stops, because querying the time at that point might return 0
    currentTime(val) {
        if (val != null) {
            window.api.player.seekTo(val);
            return;
        }

        return this._currentTime;
    }

    currentTimeAsync() {
        return new Promise((resolve) => {
            window.api.player.getPosition(resolve);
        });
    }

    duration() {
        if (this._duration) {
            return this._duration;
        }

        return null;
    }

    canSetAudioStreamIndex() {
        return true;
    }

    static onPictureInPictureError(err) {
        console.error(`Picture in picture error: ${err}`);
    }

    setPictureInPictureEnabled(isEnabled) {
        const want = Boolean(isEnabled);
        // Refuse to pin the window on top when nothing is playing.
        if (want && !this._currentSrc) return;
        if (want === this.isPictureInPictureEnabled()) return;

        this._pictureInPicture = want;
        const bridge = window.api?.window;
        if (bridge && typeof bridge.setAlwaysOnTop === 'function') {
            bridge.setAlwaysOnTop(want);
        }
    }

    isPictureInPictureEnabled() {
        return this._pictureInPicture === true;
    }

    isAirPlayEnabled() {
        return false;
    }

    setAirPlayEnabled() {}

    setBrightness() {}

    getBrightness() {
        return 100;
    }

    seekable() {
        return Boolean(this._duration);
    }

    pause() {
        window.api.player.pause();
    }

    // This is a retry after error
    resume() {
        this._paused = false;
        window.api.player.play();
    }

    unpause() {
        window.api.player.play();
    }

    paused() {
        return this._paused;
    }

    setPlaybackRate(value) {
        let playSpeed = +value; //this comes as a string from player force int for now
        this._playRate = playSpeed;
        window.api.player.setPlaybackRate(playSpeed * 1000);

        if (window.api && window.api.player) {
            window.api.player.notifyRateChange(playSpeed);
        }
    }

    getPlaybackRate() {
        if(!this._playRate) //On startup grab default
        {
            let playRate = window.jmpInfo.settings.video.default_playback_speed;

            if(!playRate) //fallback if default missing
                playRate = 1;

            this._playRate = playRate;
        }
        return this._playRate;
    }

    getSupportedPlaybackRates() {
        return [{
            name: '0.5x',
            id: 0.5
        }, {
            name: '0.75x',
            id: 0.75
        }, {
            name: '1x',
            id: 1.0
        }, {
            name: '1.25x',
            id: 1.25
        }, {
            name: '1.5x',
            id: 1.5
        }, {
            name: '1.75x',
            id: 1.75
        }, {
            name: '2x',
            id: 2.0
        }, {
            name: '2.5x',
            id: 2.5
        }, {
            name: '3x',
            id: 3.0
        }, {
            name: '3.5x',
            id: 3.5
        }, {
            name: '4.0x',
            id: 4.0
        }];
    }

    saveVolume(value) {
        if (Number.isFinite(value) && value >= 0) {
            this.appSettings.set('volume', value);
        }
    }

    setVolume(val, save = true) {
        val = clampVolume(val, window.jmpInfo?.settings?.audio?.max_volume);
        if (val !== null) {
            this._volume = val;
            if (save) {
                this.saveVolume(val / 100);
                this.events.trigger(this, 'volumechange');
            }
            window.api.player.setVolume(val);
        }
    }

    getVolume() {
        // Jellyfin Web expects a 0-100 integer even if mpv is boosted internally.
        const volume = Number(this._volume ?? 100);
        return Number.isFinite(volume) ? Math.min(100, Math.max(0, Math.round(volume))) : 100;
    }

    volumeUp() {
        this.setVolume((this._volume ?? 100) + 2);
    }

    volumeDown() {
        this.setVolume((this._volume ?? 100) - 2);
    }

    showVolumeIndicator() {
        let el = this._volumeIndicator;
        if (!el) {
            el = document.createElement('div');
            el.className = 'mpvVolumeIndicator';
            Object.assign(el.style, {
                position: 'fixed', top: '1.5em', right: '1.5em', zIndex: 9999,
                padding: '0.4em 0.9em', borderRadius: '0.3em',
                background: 'rgba(0,0,0,0.7)', color: '#fff',
                fontSize: '1.5em', pointerEvents: 'none',
                transition: 'opacity 0.3s'
            });
            document.body.appendChild(el);
            this._volumeIndicator = el;
        }

        el.textContent = `${Math.round(this._volume)}%`;
        el.style.opacity = '1';
        clearTimeout(this._volumeIndicatorTimer);
        this._volumeIndicatorTimer = setTimeout(() => { el.style.opacity = '0'; }, 1000);
    }

    isVideoZoomAllowed() {
        const video = window.jmpInfo?.settings?.video;
        return !video || video.allow_zoom !== false;
    }

    adjustVideoZoom(delta) {
        this.setVideoZoom((this._videoZoom || 0) + delta);
    }

    setVideoZoom(zoom) {
        const level = Number.isFinite(zoom) ? Math.min(2, Math.max(-1, zoom)) : 0;
        // Snap to quarters so repeated wheel ticks land on exact levels.
        this._videoZoom = Math.round(level * 4) / 4;
        if (window.api?.player && typeof window.api.player.setVideoZoom === 'function') {
            window.api.player.setVideoZoom(this._videoZoom);
        }
    }

    resetVideoZoom() {
        // Skip the bridge round-trip when already at the default level.
        if (this._videoZoom) {
            this.setVideoZoom(0);
        }
    }

    setMute(mute, triggerEvent = true) {
        this._muted = mute;
        window.api.player.setMuted(mute);
        if (triggerEvent) {
            this.events.trigger(this, 'volumechange');
        }
    }

    isMuted() {
        return this._muted;
    }

    togglePictureInPicture() {
        return this.setPictureInPictureEnabled(!this.isPictureInPictureEnabled());
    }

    toggleAirPlay() {
    }

    getBufferedRanges() {
        return this._bufferedRanges;
    }

    getStats() {
        const playOptions = this._currentPlayOptions || [];
        const categories = [];

        if (!this._currentPlayOptions) {
            return Promise.resolve({
                categories: categories
            });
        }

        const mediaCategory = {
            stats: [],
            type: 'media'
        };
        categories.push(mediaCategory);

        if (playOptions.url) {
            //  create an anchor element (note: no need to append this element to the document)
            let link = document.createElement('a');
            //  set href to any path
            link.setAttribute('href', playOptions.url);
            const protocol = (link.protocol || '').replace(':', '');

            if (protocol) {
                mediaCategory.stats.push({
                    label: this.globalize.translate('LabelProtocol'),
                    value: protocol
                });
            }

            link = null;
        }

        mediaCategory.stats.push({
            label: this.globalize.translate('LabelStreamType'),
            value: 'Video'
        });

        const videoCategory = {
            stats: [],
            type: 'video'
        };
        categories.push(videoCategory);

        const audioCategory = {
            stats: [],
            type: 'audio'
        };
        categories.push(audioCategory);

        return Promise.resolve({
            categories: categories
        });
    }

    getSupportedAspectRatios() {
        const options = window.jmpInfo.settingsDescriptions.video.find(x => x.key == 'aspect').options;
        const current = window.jmpInfo.settings.video.aspect;

        const getOptionName = (option) => {
            const canTranslate = {
                'normal': 'Auto',
                'zoom': 'AspectRatioCover',
                'stretch': 'AspectRatioFill',
            }
            const name = option.replace('video.aspect.', '');
            return canTranslate[name]
                ? this.globalize.translate(canTranslate[name])
                : name;
        }

        return options.map(x => ({
            id: x.value,
            name: getOptionName(x.title),
            selected: x.value == current
        }));
    }

    getAspectRatio() {
        return window.jmpInfo.settings.video.aspect;
    }

    setAspectRatio(value) {
        window.jmpInfo.settings.video.aspect = value;
    }
}
/* eslint-enable indent */

window._mpvVideoPlayer = mpvVideoPlayer;
})();
