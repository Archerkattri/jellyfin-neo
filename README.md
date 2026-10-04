# Jellyfin Neo

Community fork of [Jellyfin Desktop](https://github.com/jellyfin/jellyfin-desktop):
desktop client built with Qt WebEngine and [libmpv](https://github.com/mpv-player/mpv).
Supports audio passthrough, hardware decoding, and playback of more formats
without transcoding.

[![test](https://github.com/Archerkattri/jellyfin-neo/actions/workflows/test.yml/badge.svg?branch=master)](https://github.com/Archerkattri/jellyfin-neo/actions/workflows/test.yml)
[![Windows](https://github.com/Archerkattri/jellyfin-neo/actions/workflows/build-windows.yml/badge.svg?branch=master)](https://github.com/Archerkattri/jellyfin-neo/actions/workflows/build-windows.yml)
[![macOS](https://github.com/Archerkattri/jellyfin-neo/actions/workflows/build-macos.yml/badge.svg?branch=master)](https://github.com/Archerkattri/jellyfin-neo/actions/workflows/build-macos.yml)
[![AppImage](https://github.com/Archerkattri/jellyfin-neo/actions/workflows/build-appimage.yml/badge.svg?branch=master)](https://github.com/Archerkattri/jellyfin-neo/actions/workflows/build-appimage.yml)

![Screenshot of Jellyfin Desktop](screenshots/video_player.png)

## What's new in 2.1.0

- Plugin system (Phase 1): loader, per-plugin settings toggles, sample theme plugin
- Subtitle fixes: auto-selected track workaround ([#643](https://github.com/jellyfin/jellyfin-desktop/issues/643)),
  secondary-subtitle wiring, per-series audio/subtitle language memory, subtitle offset
- Playback: TrueHD Atmos / DTS:X passthrough toggles, configurable buffer/cache,
  gapless music, resample A/V-sync default, segment auto-skip, bitrate cap,
  HDR preference plus HDR diagnostics (true HDR output remains blocked upstream)
- Everyday UX: picture-in-picture toggle, screenshot keybind (Ctrl+S), in-app
  profile switching, window size/position memory, volume boost to 300%,
  KDE Wayland refresh-rate switching
- Platform: Windows ARM64 binaries, Qt 6.11.3, macOS cursor/window fixes,
  CoreAudio hotplug fix verified in the bundled mpv

Still in progress: offline downloads (server-negotiation probes landed; download
queue and UI to come). Full list and sources: [UPGRADES.md](UPGRADES.md).

## Downloads

### Stable releases

v2.1.0 is in final validation and no stable release has been cut yet. When it
lands, installers will be on the
[releases page](https://github.com/Archerkattri/jellyfin-neo/releases/latest),
tagged (e.g. `v2.1.0`; `<version>` below is the tag without the leading `v`),
each with a `SHA256SUMS` file so you can verify your download.

- Windows (x64 and ARM64): `JellyfinDesktop-<version>-x64.exe` installer,
  or `JellyfinDesktop-<version>-x64.zip` for the portable build
  (use `-arm64` instead of `-x64` on ARM PCs).
- macOS (Apple Silicon and Intel): `JellyfinDesktop-<version>-arm64.dmg`
  or `JellyfinDesktop-<version>-x86_64.dmg`.
- Linux: per-distro `.deb` packages (`ubuntu-noble-*.deb`,
  `ubuntu-jammy-*.deb`, `debian-bookworm-*.deb`, `debian-trixie-*.deb`),
  the portable `JellyfinDesktop-x86_64.AppImage`, or
  [Flathub](https://flathub.org/apps/details/org.jellyfin.JellyfinDesktop).

### Nightly builds (unstable)

Currently the way to get builds. Built automatically from the latest commit on
`master`. Nightlies have the newest fixes but are untested and may break.
(No nightly `.deb` packages are published; `.deb` builds only run for releases.)

#### macOS
- [Apple Silicon](https://nightly.link/Archerkattri/jellyfin-neo/workflows/build-macos/master/macos-arm64.zip)
- [Intel](https://nightly.link/Archerkattri/jellyfin-neo/workflows/build-macos/master/macos-x86_64.zip)

#### Windows
- [x64 Installer](https://nightly.link/Archerkattri/jellyfin-neo/workflows/build-windows/master/windows-x64-installer.zip)
- [x64 Portable](https://nightly.link/Archerkattri/jellyfin-neo/workflows/build-windows/master/windows-x64-portable.zip)
- [ARM64 Installer](https://nightly.link/Archerkattri/jellyfin-neo/workflows/build-windows/master/windows-arm64-installer.zip)
- [ARM64 Portable](https://nightly.link/Archerkattri/jellyfin-neo/workflows/build-windows/master/windows-arm64-portable.zip)

#### Linux
- [AppImage (x86_64)](https://nightly.link/Archerkattri/jellyfin-neo/workflows/build-appimage/master/linux-appimage-x86_64.zip)

## Building

After cloning, initialize the submodules:

```bash
git submodule update --init --recursive
```

CI builds with Qt 6.11.3 (the AppImage uses distro Qt 6.11.2), CMake and Ninja.
Platform-specific instructions: [macOS](dev/macos/README.md),
[Windows](dev/windows/README.md), [Linux](dev/linux/README.md).
See [dev/](dev/) for debugger and logging tips.

## File Locations
Data is stored per-profile in a `profiles/<profile-id>/` subdirectory. The main configuration file is `jellyfin-desktop.conf`. You can also add an `mpv.conf` in mpv's standard config location to configure MPV directly.

**Windows:**
- Config: `%LOCALAPPDATA%\Jellyfin Desktop\profiles\<profile-id>\`
- Cache: `%LOCALAPPDATA%\Jellyfin Desktop\profiles\<profile-id>\`
- Logs: `%LOCALAPPDATA%\Jellyfin Desktop\profiles\<profile-id>\logs\`

**Linux:**
- Config: `~/.local/share/jellyfin-desktop/profiles/<profile-id>/`
- Cache: `~/.cache/jellyfin-desktop/profiles/<profile-id>/`
- Logs: `~/.local/share/jellyfin-desktop/profiles/<profile-id>/logs/`

**Linux (Flatpak):**
- Config: `~/.var/app/org.jellyfin.JellyfinDesktop/data/jellyfin-desktop/profiles/<profile-id>/`
- Cache: `~/.var/app/org.jellyfin.JellyfinDesktop/cache/jellyfin-desktop/profiles/<profile-id>/`
- Logs: `~/.var/app/org.jellyfin.JellyfinDesktop/data/jellyfin-desktop/profiles/<profile-id>/logs/`

**macOS:**
- Config: `~/Library/Application Support/Jellyfin Desktop/profiles/<profile-id>/`
- Cache: `~/Library/Caches/Jellyfin Desktop/profiles/<profile-id>/`
- Logs: `~/Library/Logs/Jellyfin Desktop/profiles/<profile-id>/`
