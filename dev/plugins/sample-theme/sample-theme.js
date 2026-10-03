// Sample Tier-1 web plugin (Phase 1): proves the documented host surface
// end to end. Uses window.JellyfinDesktop ONLY -- no direct bridge access, no
// Phase-2 APIs (no WebChannel export, no host commands, no local sockets).
// Defensive: no-ops cleanly when the host object is absent (older builds).
(function () {
    'use strict';

    var BADGE_ID = 'jellyfin-sample-theme-badge';

    function getHost() {
        try {
            if (typeof window === 'undefined' || !window || typeof window !== 'object') {
                return null;
            }
            var host = window.JellyfinDesktop;
            if (!host || typeof host !== 'object') {
                return null;
            }
            return host;
        } catch (ignored) {
            return null;
        }
    }

    function log(host, message) {
        try {
            if (host.host && typeof host.host.log === 'function') {
                host.host.log('[sample-theme] ' + message);
            }
        } catch (ignored) {
            // Logging is best-effort; never break the page.
        }
    }

    function pluginId(host) {
        try {
            if (host.plugin && typeof host.plugin.id === 'string') {
                return host.plugin.id;
            }
        } catch (ignored) {
            // Fall through to the manifest default below.
        }
        return 'org.jellyfin.sample-theme';
    }

    // The one visible change: a small badge pinned to the corner of the
    // page. Re-running (e.g. after a profile switch) updates it in place.
    function ensureBadge(id) {
        if (typeof document === 'undefined' || !document
                || typeof document.createElement !== 'function') {
            return null;
        }
        var badge = null;
        try {
            if (typeof document.getElementById === 'function') {
                badge = document.getElementById(BADGE_ID);
            }
            if (!badge) {
                badge = document.createElement('div');
                badge.id = BADGE_ID;
                badge.setAttribute('data-plugin', id);
                badge.style.position = 'fixed';
                badge.style.right = '8px';
                badge.style.bottom = '8px';
                badge.style.zIndex = '9999';
                badge.style.padding = '4px 8px';
                badge.style.fontSize = '12px';
                badge.style.borderRadius = '4px';
                badge.style.background = '#5b2d8e';
                badge.style.color = '#ffffff';
                var parent = document.body || document.documentElement;
                if (!parent || typeof parent.appendChild !== 'function') {
                    return null;
                }
                parent.appendChild(badge);
            }
            badge.textContent = 'Sample Theme (' + id + ')';
        } catch (ignored) {
            return null;
        }
        return badge;
    }

    function subscribe(host, badge) {
        try {
            if (host.events && typeof host.events.on === 'function') {
                host.events.on('player', 'playbackStateChanged', function (state) {
                    try {
                        if (badge) {
                            badge.setAttribute('data-playback-state', String(state));
                        }
                    } catch (ignored) {
                        // Never let a UI update break event delivery.
                    }
                });
            }
        } catch (ignored) {
            // Events are optional; the badge alone proves the surface.
        }
    }

    var host = getHost();
    if (!host) {
        return;
    }
    var id = pluginId(host);
    log(host, 'loaded for ' + id);
    var badge = ensureBadge(id);
    subscribe(host, badge);
})();
