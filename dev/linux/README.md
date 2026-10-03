# Building Jellyfin Desktop on Linux

## Quick Start

### Setup and build

```bash
dev/linux/setup.sh   # First time: install native dependencies and Qt 6.11.3
dev/linux/build.sh   # Configure/build with the pinned Qt SDK; optionally install
dev/linux/run.sh     # Launch using that SDK's runtime libraries and plugins
```

## Prerequisites

- **Debian/Ubuntu** (or derivative) with `apt-get`

`setup.sh` installs the native dependencies and Qt SDK:

- Build tooling: `devscripts`, `equivs`, `ninja-build`, `python3-venv`, and `git`
- Native packages from [`../../debian/control`](../../debian/control), including `libmpv-dev`, `libcec-dev`, and the rest of the system toolchain. The setup filters distro Qt packages out of `Build-Depends` so they cannot silently become the selected build Qt.
- Qt **6.11.3** from the repository-pinned aqtinstall revision `8c3695d4a4e1ceabf6a74dc6c79681656dc6b74b`, installed at `dev/linux/deps/qt/6.11.3/gcc_64` with WebEngine, WebChannel, Positioning, and SerialPort modules. The SDK includes the Qt QML modules and runtime plugins used by the app.

The official Qt Linux documentation lists glibc 2.34 as the minimum for Qt 6.10 and newer. Qt 6.11.3 SDK binaries are built on Ubuntu 24.04, but that build-host version is not itself the minimum runtime requirement: the Core and WebEngine libraries in the tested SDK require no newer than `GLIBC_2.34`. This clears the glibc floor for Ubuntu 22.04 and Debian 12, but does not by itself verify every Qt WebEngine/native dependency or prove `.deb` compatibility. Run the final package tests on each target distribution. Native build dependencies remain installed from the host distribution.

### Qt 6.12 (WebEngine extension)

Qt 6.12 moved WebEngine out of the base SDK: it ships only as an online-repo
extension (WebEngine 6.140.0) that the pinned aqtinstall revision cannot
fetch. `setup.sh` handles this automatically when run with `QT_VERSION=6.12.0`:
it installs the base SDK without the `qtwebengine` module and completes it
with [`../qt/fetch-qtwebengine-ext.sh`](../qt/fetch-qtwebengine-ext.sh), which
downloads the pinned extension archives, verifies their SHA1 checksums, and
extracts them over the SDK directory. Do not add `-m qtwebengine` back for
6.12: the pinned aqt would install a stale snapshot instead of 6.140.0.

## Install

`build.sh` asks for confirmation separately before each `sudo` step:

1. **Install Binary** @ `/usr/local/bin/jellyfin-desktop`
2. **Desktop integration** (`.desktop` file, icon, appdata metadata) @ `/usr/local/share/{applications,icons,metainfo}/`

Answer `n` to either prompt to skip it. The built binary at `build/src/jellyfin-desktop` still runs without installing; use `dev/linux/run.sh` so the Qt 6.11.3 shared libraries, QML imports, and platform plugins are selected explicitly.

## Directory Structure

- `build/` - Build output (safe to delete)
- `build/src/jellyfin-desktop` - Built executable
- `dev/linux/deps/qt/6.11.3/gcc_64` - aqt Qt SDK (created by setup.sh; not tracked)

## Scripts

- `setup.sh` - Install build and runtime dependencies
- `build.sh` - Initialize submodules, configure, build, and optionally install
- `run.sh` - Launch the local build with the matching Qt runtime environment

## Clean Build

```bash
rm -rf build
dev/linux/build.sh
```

## Troubleshooting

### Qt 6.11.3 SDK missing

```
error: Qt 6.11.3 SDK not found ... Run setup.sh first
```

Run `dev/linux/setup.sh` from Debian/Ubuntu with glibc 2.34 or newer; use the package matrix for final compatibility checks.

## Notes

- **This is the developer build path.** The release `.deb` packaging has its
  own build and runtime dependency strategy; this setup change does not alter
  that packaging or claim the `.deb` artifacts bundle Qt 6.11.3.
- Data/config/cache/log file locations are documented in the [main README](../../README.md#file-locations)
