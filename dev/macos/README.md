# Building Jellyfin Desktop on macOS

## Quick Start

### Setup and build
```bash
dev/macos/setup.sh   # First time: install dependencies
dev/macos/build.sh   # Build
```
### Run the application
```bash
dev/macos/run.sh
```
### Run the unit tests
```bash
dev/macos/test.sh
```

## Prerequisites

- **Xcode Command Line Tools**: `xcode-select --install`
- **Homebrew**: https://brew.sh

`setup.sh` installs everything else:
- Python 3.12, CMake, Ninja, create-dmg
- The pinned Qt installer, Qt 6.11.3 (the current v2.1.0 development baseline)
- mpv

Newer Qt versions can be selected by setting `QT_VERSION` when running the
setup/build scripts. Keep QtWebEngine memory usage in mind when testing newer
builds; the release pin changes only after that issue and app memory behavior
have been re-verified.

### Qt 6.12 (WebEngine extension)

Qt 6.12 moved WebEngine out of the base SDK: it ships only as an online-repo
extension (WebEngine 6.140.0) that the pinned aqtinstall revision cannot
fetch. `setup.sh` handles this automatically when run with `QT_VERSION=6.12.0`:
it installs the base SDK without the `qtwebengine` module and completes it
with [`../qt/fetch-qtwebengine-ext.sh`](../qt/fetch-qtwebengine-ext.sh), which
downloads the pinned extension archives, verifies their SHA1 checksums, and
extracts them over the SDK directory.

## Directory Structure

- `dev/macos/deps/` - Downloaded dependencies (Qt)
- `build/` - Build output (safe to delete)
- `build/src/Jellyfin Desktop.app` - Dev build (unbundled, for run.sh)
- `build/output/Jellyfin Desktop.app` - Release build (bundled, from bundle.sh)

## Scripts

- `setup.sh` - Install all dependencies
- `build.sh` - Configure and build
- `bundle.sh` - Create DMG for distribution
- `run.sh` - Run the built app (passes arguments through)
- `test.sh` - Run unit tests (sets up Qt/mpv in PATH)
- `common.sh` - Shared variables (sourced by other scripts)

## Clean Build

```bash
rm -rf build
dev/macos/build.sh
```

## Troubleshooting

### Black Screen / GPU Issues

Try software rendering:
```bash
dev/macos/run.sh --disable-gpu
```

### Log Files

```
~/Library/Logs/Jellyfin Desktop/profiles/<profile-id>/
```

## Notes

- Qt 6.11 builds require macOS 13+ on both Intel and Apple Silicon.
- The default Qt version matches the macOS release workflow; `QT_VERSION` can
  override it for compatibility testing.
