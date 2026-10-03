@echo off
REM Jellyfin Desktop - Common variables
REM Sourced by other scripts

REM Match release CI until Qt ships the WebEngine memory fix for newer versions.
if not defined QT_VERSION set QT_VERSION=6.11.3
if not defined MPV_RELEASE set MPV_RELEASE=20260921
if not defined MPV_VERSION set MPV_VERSION=20260921-git-e76a35ec95

REM === Target architecture: x64 (default) or arm64 ===
REM Set WINARCH=arm64 in the environment before setup/build for ARM64 binaries.
if not defined WINARCH set "WINARCH=x64"
if /i "%WINARCH%"=="aarch64" set "WINARCH=arm64"
if /i not "%WINARCH%"=="x64" if /i not "%WINARCH%"=="arm64" (
    echo ERROR: WINARCH must be x64 or arm64, got "%WINARCH%"
    exit /b 1
)
if /i "%WINARCH%"=="arm64" (
    set "QT_ARCH=win64_msvc2022_arm64_cross_compiled"
    set "QT_DIR=msvc2022_arm64"
    set "QT_HOST_ARCH=win64_msvc2022_64"
    set "QT_HOST_DIR=msvc2022_64"
    set "MPV_ARCH=aarch64"
    set "MPV_FALLBACK_ARCH="
    set "VCREDIST_NAME=vc_redist.arm64.exe"
    set "VC_CAB_ARCH=arm64"
    set "VC_FILE_ARCH=arm64"
    set "MACHINE=ARM64"
    set "VCVARS_NAME=vcvarsamd64_arm64.bat"
) else (
    set "QT_ARCH=win64_msvc2022_64"
    set "QT_DIR=msvc2022_64"
    set "QT_HOST_ARCH="
    set "QT_HOST_DIR="
    set "MPV_ARCH=x86_64-v3"
    set "MPV_FALLBACK_ARCH=x86_64"
    set "VCREDIST_NAME=vc_redist.x64.exe"
    set "VC_CAB_ARCH=amd64"
    set "VC_FILE_ARCH=amd64"
    set "MACHINE=X64"
    set "VCVARS_NAME=vcvars64.bat"
)

REM === Host architecture (selects the Visual Studio vcvars file) ===
set "HOST_ARCH=%PROCESSOR_ARCHITECTURE%"
if "%HOST_ARCH%"=="x86" if defined PROCESSOR_ARCHITEW6432 set "HOST_ARCH=%PROCESSOR_ARCHITEW6432%"
if /i "%HOST_ARCH%"=="ARM64" (
    if /i "%WINARCH%"=="arm64" (
        set "VCVARS_NAME=vcvarsarm64.bat"
    ) else (
        set "VCVARS_NAME=vcvarsarm64_amd64.bat"
    )
)
set SCRIPT_DIR=%~dp0
for %%i in ("%SCRIPT_DIR%\..\..") do set "PROJECT_ROOT=%%~fi"
set DEPS_DIR=%SCRIPT_DIR%deps
set BUILD_DIR=%PROJECT_ROOT%\build
set EXE_NAME=Jellyfin Desktop.exe

REM === Find Visual Studio ===
set VCVARS=
set "VS_BT=C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\%VCVARS_NAME%"
set "VS_CM=C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\%VCVARS_NAME%"
set "VS_PR=C:\Program Files\Microsoft Visual Studio\2022\Professional\VC\Auxiliary\Build\%VCVARS_NAME%"
set "VS_EN=C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Auxiliary\Build\%VCVARS_NAME%"
set "VS_BT86=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\%VCVARS_NAME%"

if exist "%VS_BT%" set "VCVARS=%VS_BT%"
if not defined VCVARS if exist "%VS_CM%" set "VCVARS=%VS_CM%"
if not defined VCVARS if exist "%VS_PR%" set "VCVARS=%VS_PR%"
if not defined VCVARS if exist "%VS_EN%" set "VCVARS=%VS_EN%"
if not defined VCVARS if exist "%VS_BT86%" set "VCVARS=%VS_BT86%"

if "%~1"=="" goto :eof
goto %~1

REM === Setup runtime PATH for DLLs ===
REM Call with: call "%~dp0common.bat" :setup_runtime
:setup_runtime
if not exist "%BUILD_DIR%" (
    echo ERROR: Build not found. Run build.bat first
    exit /b 1
)
set "PATH=%DEPS_DIR%\mpv;%PATH%"
set "PATH=%DEPS_DIR%\qt\%QT_VERSION%\%QT_DIR%\bin;%PATH%"
goto :eof
