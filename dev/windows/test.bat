@echo off
REM Jellyfin Desktop - Run unit tests
REM Run build.bat first

setlocal
call "%~dp0common.bat"
call "%~dp0common.bat" :setup_runtime || exit /b 1

REM === ARM64 test binaries cannot execute on an x64 host ===
if /i "%WINARCH%"=="arm64" if /i not "%HOST_ARCH%"=="ARM64" (
    echo ERROR: Cannot run ARM64 tests on an x64 host.
    echo Run the tests on ARM64 Windows or use the windows-arm64 CI job.
    exit /b 1
)

REM === Run tests ===
cd /d "%BUILD_DIR%"
ctest --output-on-failure %*
set EXIT_CODE=%ERRORLEVEL%

endlocal & exit /b %EXIT_CODE%
