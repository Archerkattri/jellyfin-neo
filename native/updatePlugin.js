(function() {
const latestReleaseApi = 'https://api.github.com/repos/Archerkattri/jellyfin-neo/releases/latest';
const releasePagePrefix = 'https://github.com/Archerkattri/jellyfin-neo/releases/tag/';

function parseStableVersion(value) {
    if (typeof value !== 'string') return null;

    const normalized = value.replace(/^v/, '');
    if (!/^\d+(?:\.\d+)*$/.test(normalized)) return null;

    const parts = normalized.split('.').map(Number);
    return parts.every(Number.isSafeInteger) ? parts : null;
}

function isNewerVersion(available, current) {
    const availableParts = parseStableVersion(available);
    const currentParts = parseStableVersion(current);
    if (!availableParts || !currentParts) return false;

    const count = Math.max(availableParts.length, currentParts.length);
    for (let i = 0; i < count; i++) {
        const availablePart = availableParts[i] || 0;
        const currentPart = currentParts[i] || 0;
        if (availablePart !== currentPart) return availablePart > currentPart;
    }

    return false;
}

function detectUpdatePlatform(system, userAgent) {
    if (system && typeof system.isWindows === 'boolean' &&
        typeof system.isMacos === 'boolean' && typeof system.isLinux === 'boolean') {
        const matches = [system.isWindows && 'windows',
                         system.isMacos && 'macos',
                         system.isLinux && 'linux'].filter(Boolean);
        if (matches.length === 1) return matches[0];
    }

    if (typeof userAgent === 'string') {
        if (userAgent.includes('(Windows;')) return 'windows';
        if (userAgent.includes('(Darwin;')) return 'macos';
        if (userAgent.includes('(Linux;')) return 'linux';
    }

    return null;
}

function selectUpdateAsset(assets, platform) {
    let pattern = null;
    if (platform === 'windows') {
        // CI installers are JellyfinDesktop-<version>-<x64|arm64>.exe; the
        // portable .zip shares the stem and must never match here.
        pattern = /^JellyfinDesktop-.+-(x64|arm64)\.exe$/;
    } else if (platform === 'macos') {
        // dev/macos/bundle.sh names DMGs JellyfinDesktop-<version>-<arch>.dmg.
        pattern = /^JellyfinDesktop-.+\.dmg$/;
    } else {
        // Linux install types (.deb vs AppImage vs store) cannot be told apart
        // here, so fall back to the release page and let the user pick.
        return null;
    }

    if (!Array.isArray(assets)) return null;
    const matches = assets.filter((asset) => asset &&
        typeof asset.name === 'string' && pattern.test(asset.name) &&
        typeof asset.browser_download_url === 'string' &&
        asset.browser_download_url.startsWith('https://'));
    return matches.length === 1 ? matches[0].browser_download_url : null;
}
class updatePlugin {
    constructor({ confirm }) {
        this.name = 'Update Plugin';
        this.type = 'input';
        this.id = 'updatePlugin';

        (async () => {
            const api = await window.apiPromise;

            const onUpdateNotify = async (url) => {
                const currentVersion = jmpInfo.version;
                if (!parseStableVersion(currentVersion)) return;

                let version;
                let directDownloadUrl = null;
                try {
                    if (url === 'SSL_UNAVAILABLE') {
                        // The releases page does not grant CORS to server-hosted
                        // Jellyfin Web pages. GitHub's REST API supports CORS.
                        const response = await fetch(latestReleaseApi, { credentials: 'omit' });
                        if (!response.ok) throw new Error(`GitHub API returned HTTP ${response.status}`);

                        const release = await response.json();
                        if (release.draft || release.prerelease ||
                            typeof release.html_url !== 'string' ||
                            !release.html_url.startsWith(releasePagePrefix)) {
                            return;
                        }

                        url = release.html_url;
                        version = release.tag_name;
                        directDownloadUrl = selectUpdateAsset(
                            release.assets,
                            detectUpdatePlatform(api.system, jmpInfo.userAgent));
                    } else {
                        if (typeof url !== 'string' || !url.startsWith(releasePagePrefix)) return;
                        const tag = url.slice(releasePagePrefix.length).split(/[?#]/, 1)[0];
                        version = tag.replace(/^v/, '');
                    }
                } catch (e) {
                    console.warn('Update check failed:', e);
                    return;
                }

                if (!isNewerVersion(version, currentVersion)) return;

                try {
                    // wait 3 seconds before showing the dialog to prevent race conditions
                    await new Promise(resolve => setTimeout(resolve, 3000));

                    await confirm({
                        title: "Update Available",
                        text: `Jellyfin Desktop version ${version} is available.`,
                        cancelText: "Ignore",
                        confirmText: "Download"
                    });

                    api.system.openExternalUrl(directDownloadUrl || url);
                } catch (e) {
                    // User cancelled update
                }
            }

            api.system.updateInfoEmitted.connect(onUpdateNotify);
            api.system.checkForUpdates();
        })();
    }
}

window._updatePlugin = updatePlugin;
})();
