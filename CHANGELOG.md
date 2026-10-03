# Jellyfin Desktop Changelog

## v2.1.0

Qt 6.11.3 baseline with playback, reliability, accessibility, and desktop UI improvements.

### Highlights

- Refresh the first-run server connection screen with clearer connection status, cancellation, keyboard handling, and accessible labels.
- Replace the WebEngine load-error HTML with a native retry/details panel and a direct log-file action.
- Open links from user-requested WebEngine windows using the actual requested URL instead of stale hover state.
- Load the precompiled startup view through its dedicated QML module, package its runtime metadata, and keep the native player type visible on first launch.
- Hide the mouse cursor after three seconds of inactivity during fullscreen video, and restore it on activity.
- Clean up native playback, WebChannel, and settings listeners during teardown to prevent callbacks accumulating across sessions.
- Improve volume normalization and transcoded audio-track selection; make desktop Escape/Backspace navigation respect web controls and dialogs.
- Add optional automatic intro and credits skipping when the server or a compatible plugin provides media segments.
- Harden update checks, settings fallbacks, log rotation, and Windows/mpv dependency setup.
- Expand native and JavaScript regression coverage and run it in platform CI.
- Build Windows, macOS, Debian/Ubuntu, and AppImage release assets from a version tag; include SHA-256 checksums.

### Install

- **Windows:** run `JellyfinDesktop-*-x64.exe`, or extract the portable `JellyfinDesktop-*-x64.zip` and launch `Jellyfin Desktop.exe`.
- **macOS:** open the `.dmg` for your Mac (`arm64` for Apple silicon, `x86_64` for Intel) and drag the app to Applications.
- **Ubuntu/Debian:** select the `.deb` prefixed for your distro (`ubuntu-jammy`, `ubuntu-noble`, `debian-bookworm`, or `debian-trixie`), then run `sudo apt install ./<package>.deb`.
- **Other Linux distributions:** make the x86_64 `.AppImage` executable and launch it (`chmod +x <file>.AppImage`).

Release assets are built by CI. Windows installers are not code-signed by this fork. macOS disk images are ad-hoc signed without notarization when no Apple signing secrets are configured, and Developer ID signed and notarized when all of them are; configuring only some of the signing secrets fails the macOS job. Unsigned artifacts show the operating systems' standard first-run security warnings. The macOS jobs produce both architectures, but this release process does not include a local macOS runtime test.

### Compatibility note

Qt 6.11.3 is the v2.1.0 baseline. The 6.11.3 QtWebEngine binaries contain the fix for the WebEngine V8-GC memory issue tracked as [QTBUG-141377](https://bugreports.qt.io/browse/QTBUG-141377) (verified via the embedded Chromium patch string `153.0.8010.52`, which postdates the fix uptake). Exception: the AppImage stays on Qt 6.11.2 because Arch Linux never shipped 6.11.3 and its stable branch is still all-6.11.2 (6.12.0 is testing-only); see UPGRADES.md.
