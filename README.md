# Jellyfin Desktop

Jellyfin desktop client built with Qt WebEngine and [libmpv](https://github.com/mpv-player/mpv). Supports audio passthrough, hardware decoding, and playback of more formats without transcoding.

![Screenshot of Jellyfin Desktop](screenshots/video_player.png)

## Downloads

### Stable Releases (recommended)

Get the latest tested installers from this fork's
[releases page](https://github.com/Archerkattri/jellyfin-neo/releases/latest).
Each release is tagged (e.g. `v2.1.0`); `<version>` below is the tag without
the leading `v`. Every release also ships a `SHA256SUMS` file so you can
verify your download.

- Windows (x64 and ARM64): `JellyfinDesktop-<version>-x64.exe` installer,
  or `JellyfinDesktop-<version>-x64.zip` for the portable build
  (use `-arm64` instead of `-x64` on ARM PCs).
- macOS (Apple Silicon and Intel): `JellyfinDesktop-<version>-arm64.dmg`
  or `JellyfinDesktop-<version>-x86_64.dmg`.
- Linux: per-distro `.deb` packages (`ubuntu-noble-*.deb`,
  `ubuntu-jammy-*.deb`, `debian-bookworm-*.deb`, `debian-trixie-*.deb`),
  the portable `JellyfinDesktop-x86_64.AppImage`, or
  [Flathub](https://flathub.org/apps/details/org.jellyfin.JellyfinDesktop).

### Nightly Builds (unstable)

Built automatically from the latest commit on `master`. Nightlies have the
newest fixes but are untested and may break — prefer a
[stable release](#stable-releases-recommended) unless you need a fresh fix.
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
See [dev/](dev/) for platform-specific build instructions.

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
