@echo off
REM Jellyfin Desktop - Run built executable
REM Run build.bat first

setlocal
call "%~dp0common.bat"
call "%~dp0common.bat" :setup_runtime || exit /b 1

REM === An ARM64 executable cannot run on an x64 host ===
if /i "%WINARCH%"=="arm64" if /i not "%HOST_ARCH%"=="ARM64" (
    echo ERROR: Cannot run the ARM64 build on an x64 host.
    echo Run it on ARM64 Windows instead.
    exit /b 1
)

REM === Run ===
"%BUILD_DIR%\src\%EXE_NAME%" %*
set EXIT_CODE=%ERRORLEVEL%

endlocal & exit /b %EXIT_CODE%
