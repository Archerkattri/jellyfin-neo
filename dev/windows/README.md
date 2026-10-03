# Building Jellyfin Desktop on Windows

## Quick Start

### Setup and build
```cmd
dev\windows\setup.bat   # First time: download dependencies
dev\windows\build.bat   # Build
```
### Run the application
```cmd
dev\windows\run.bat
```
### Run the unit tests
```cmd
dev\windows\test.bat
```

## Prerequisites

- **winget** (Windows Package Manager) and Git for Windows

`setup.bat` installs everything else:
- Visual Studio 2022 Build Tools (v143 toolset)
- CMake, Ninja, 7-Zip, Inno Setup
- Python 3.12, the pinned Qt installer, Qt 6.11.3 (the current v2.1.0 development baseline)
- libmpv development build (AVX2 + fallback), VC++ redistributable

The libmpv build is pinned in `common.bat` and updated with the Windows CI
workflow. Newer Qt versions can be selected with `QT_VERSION`; validate
QtWebEngine memory use before changing the release baseline.
- MinGW (for gendef), WiX (for VC-runtime extraction)

### Qt 6.12 (WebEngine extension)

Qt 6.12 moved WebEngine out of the base SDK: it ships only as an online-repo
extension (WebEngine 6.140.0) that the pinned aqtinstall revision cannot
fetch. `setup.bat` handles this automatically when run with `QT_VERSION=6.12.0`:
it installs the base SDK without the `qtwebengine` module and completes it
with `dev\qt\fetch-qtwebengine-ext.ps1`, which downloads the pinned extension
archives, verifies their SHA1 checksums, and extracts them over the SDK
directory (both `x64` and `arm64` targets).

## Directory Structure

- `dev/windows/deps/` - Downloaded dependencies (Qt, mpv, etc.)
- `build/` - Build output (safe to delete)
- `build/src/Jellyfin Desktop.exe` - Built executable

## Scripts

- `setup.bat` - Download all dependencies
- `build.bat` - Configure and build
- `bundle.bat` - Create installer and portable ZIP
- `run.bat` - Run executable (sets up Qt/mpv in PATH)
- `test.bat` - Run unit tests (sets up Qt/mpv in PATH)
- `common.bat` - Shared variables (sourced by other scripts)

## Clean Build

```cmd
rmdir /s /q build
dev\windows\build.bat
```

## ARM64 (cross-compiled)

Windows ARM64 binaries are cross-compiled from the
`win64_msvc2022_arm64_cross_compiled` Qt package plus an x64 host Qt. CI builds
both architectures: the `windows-arm64` job runs on a `windows-11-arm` runner
with full unit tests, because the Qt deployment tool (`windeployqt.exe`) is
itself an ARM64 binary and cannot run on x64 Windows.

For a local ARM64 build, set `WINARCH` before running the scripts:

```cmd
set WINARCH=arm64
dev\windows\setup.bat
dev\windows\build.bat
dev\windows\bundle.bat
```

`setup.bat` then downloads the ARM64 Qt target, an x64 host Qt, the `aarch64`
libmpv build (ARM64 has no AVX2 fallback), and `vc_redist.arm64.exe`. Unset
`WINARCH` (or set it to `x64`) for a regular build.

On x64 Windows only `setup.bat` and `build.bat` work for ARM64; `bundle.bat`,
`run.bat`, and `test.bat` refuse with an error because ARM64 binaries cannot
execute there. The generated `CMakePresets.json` `windows-dev` entry still
points at the x64 Qt; IDE users targeting ARM64 must adjust `QTROOT` manually.

## Troubleshooting

### Black Screen / GPU Issues

Try software rendering:
```cmd
dev\windows\run.bat --disable-gpu
```

Common causes:
- Outdated GPU drivers
- Missing DirectX components
- Hardware acceleration incompatibility

### Log Files

```
%LOCALAPPDATA%\Jellyfin Desktop\profiles\<profile-id>\logs\jellyfin-desktop.log
```

## Notes

- Qt's MSVC package requires the matching VS 2022 toolset (v143)
- Version info centralized in `common.bat`
- `run.bat` adds Qt/mpv to PATH; `bundle.bat` creates standalone packages
