@echo off
REM Jellyfin Desktop - Windows dependency installer
REM Run once to install all build dependencies

setlocal EnableDelayedExpansion
call "%~dp0common.bat"

set "SEVENZIP=C:\Program Files\7-Zip\7z.exe"
if not exist "!SEVENZIP!" (
    for /f "delims=" %%i in ('where 7z.exe 2^>nul') do (
        set "SEVENZIP=%%i"
        goto :found7zip
    )
)
:found7zip

if not exist "!DEPS_DIR!" mkdir "!DEPS_DIR!"

echo [1/14] Installing CMake...
winget install --id Kitware.CMake --accept-package-agreements --accept-source-agreements --silent
if errorlevel 1 echo Warning: CMake may already be installed

echo [2/14] Installing Ninja...
winget install --id Ninja-build.Ninja --accept-package-agreements --accept-source-agreements --silent
if errorlevel 1 echo Warning: Ninja may already be installed

echo [3/14] Installing 7-Zip...
winget install --id 7zip.7zip --accept-package-agreements --accept-source-agreements --silent
if errorlevel 1 echo Warning: 7-Zip may already be installed

echo [4/14] Installing Python for the Qt installer...
winget install --id Python.Python.3.12 --accept-package-agreements --accept-source-agreements --silent
if errorlevel 1 echo Warning: Python may already be installed
set "PYTHON_EXE="
if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" set "PYTHON_EXE=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
if not defined PYTHON_EXE if exist "%ProgramFiles%\Python312\python.exe" set "PYTHON_EXE=%ProgramFiles%\Python312\python.exe"
if not defined PYTHON_EXE (
    for /f "delims=" %%P in ('where python.exe 2^>nul') do (
        if not defined PYTHON_EXE if exist "%%~fP" (
            echo %%~fP | findstr /I /C:"WindowsApps" >nul
            if errorlevel 1 set "PYTHON_EXE=%%~fP"
        )
    )
)
if not defined PYTHON_EXE (
    echo ERROR: Python 3.12 was not found. Install it from python.org and re-run setup.
    exit /b 1
)
where git >nul 2>&1
if errorlevel 1 (
    echo ERROR: Git for Windows is required to install the pinned Qt installer.
    exit /b 1
)
if not exist "!DEPS_DIR!\aqt-venv\Scripts\python.exe" "!PYTHON_EXE!" -m venv "!DEPS_DIR!\aqt-venv"
"!DEPS_DIR!\aqt-venv\Scripts\python.exe" -m pip install --disable-pip-version-check --upgrade "git+https://github.com/miurahr/aqtinstall.git@8c3695d4a4e1ceabf6a74dc6c79681656dc6b74b"
if errorlevel 1 (
    echo ERROR: Could not install the Qt installer.
    exit /b 1
)

echo [5/14] Installing Visual Studio 2022 Build Tools...
winget install --id Microsoft.VisualStudio.2022.BuildTools ^
  --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended" ^
  --accept-package-agreements --accept-source-agreements --silent
if errorlevel 1 echo Warning: VS Build Tools may already be installed

echo [6/14] Installing MinGW (for gendef)...
winget install --id mingw.mingw-w64-ucrt --accept-package-agreements --accept-source-agreements --silent
if errorlevel 1 (
    echo Warning: mingw.mingw-w64-ucrt not available, trying msys2.msys2...
    winget install --id MSYS2.MSYS2 --accept-package-agreements --accept-source-agreements --silent
    if errorlevel 1 echo Warning: MinGW/MSYS2 install skipped. gendef fallback may run during build.
)

echo [7/14] Installing Inno Setup...
winget install --id JRSoftware.InnoSetup --accept-package-agreements --accept-source-agreements --silent
if errorlevel 1 echo Warning: Inno Setup may already be installed

echo [8/14] Installing Qt !QT_VERSION!...
if not exist "!SEVENZIP!" (
    echo ERROR: 7-Zip was not found. Install 7-Zip and re-run setup.
    exit /b 1
)
REM Qt 6.12 ships WebEngine only as an online-repo extension that the pinned
REM aqt cannot fetch, so 6.12 installs skip qtwebengine here and complete the
REM SDK with dev\qt\fetch-qtwebengine-ext.ps1 below.
set "QT_MODULES=qtwebengine qtwebchannel qtpositioning qtserialport"
if "!QT_VERSION:~0,4!"=="6.12" set "QT_MODULES=qtwebchannel qtpositioning qtserialport"
if not exist "!DEPS_DIR!\qt\!QT_VERSION!\!QT_DIR!\bin\Qt6Core.dll" (
    pushd "!DEPS_DIR!"
    "!DEPS_DIR!\aqt-venv\Scripts\python.exe" -m aqt install-qt windows desktop !QT_VERSION! !QT_ARCH! -m !QT_MODULES! -E "!SEVENZIP!" -O "qt"
    if errorlevel 1 (
        popd
        echo ERROR: Failed to install Qt !QT_VERSION!.
        exit /b 1
    )
    popd
) else (
    echo Qt already installed, skipping
)
if "!QT_VERSION:~0,4!"=="6.12" (
    echo Installing Qt WebEngine 6.140 extension...
    powershell -NoProfile -ExecutionPolicy Bypass -File "!PROJECT_ROOT!\dev\qt\fetch-qtwebengine-ext.ps1" -QtRoot "!DEPS_DIR!\qt\!QT_VERSION!\!QT_DIR!" -QtVersion "!QT_VERSION!" -QtArch "!QT_ARCH!"
    if errorlevel 1 (
        echo ERROR: Failed to install the Qt WebEngine extension.
        exit /b 1
    )
)
if not exist "!DEPS_DIR!\qt\!QT_VERSION!\!QT_DIR!\bin\Qt6WebEngineCore.dll" (
    echo ERROR: Qt !QT_VERSION! installation is incomplete. Remove the incomplete Qt folder and re-run setup.
    exit /b 1
)
if not exist "!DEPS_DIR!\qt\!QT_VERSION!\!QT_DIR!\bin\Qt6WebChannel.dll" (
    echo ERROR: Qt !QT_VERSION! WebChannel module is missing. Remove the incomplete Qt folder and re-run setup.
    exit /b 1
)
if not exist "!DEPS_DIR!\qt\!QT_VERSION!\!QT_DIR!\bin\Qt6Positioning.dll" (
    echo ERROR: Qt !QT_VERSION! Positioning module is missing. Remove the incomplete Qt folder and re-run setup.
    exit /b 1
)

if defined QT_HOST_ARCH (
    if not exist "!DEPS_DIR!\qt\!QT_VERSION!\!QT_HOST_DIR!\bin\qmake.exe" (
        echo Installing host Qt !QT_VERSION! for ARM64 cross-compilation...
        pushd "!DEPS_DIR!"
        "!DEPS_DIR!\aqt-venv\Scripts\python.exe" -m aqt install-qt windows desktop !QT_VERSION! !QT_HOST_ARCH! -E "!SEVENZIP!" -O "qt"
        if errorlevel 1 (
            popd
            echo ERROR: Failed to install host Qt !QT_VERSION!.
            exit /b 1
        )
        popd
    ) else (
        echo Host Qt already installed, skipping
    )
)

echo [9/14] Downloading libmpv [!MPV_ARCH!]...
if not exist "!DEPS_DIR!\mpv\libmpv-2.dll" (
    echo Downloading libmpv...
    if exist "!DEPS_DIR!\mpv" rmdir /s /q "!DEPS_DIR!\mpv"
    if exist "!DEPS_DIR!\mpv_tmp" rmdir /s /q "!DEPS_DIR!\mpv_tmp"
    curl --fail --location --retry 3 "https://github.com/shinchiro/mpv-winbuild-cmake/releases/download/!MPV_RELEASE!/mpv-dev-!MPV_ARCH!-!MPV_VERSION!.7z" -o "!DEPS_DIR!\mpv.7z"
    if errorlevel 1 (
        echo ERROR: Failed to download libmpv
        exit /b 1
    ) else (
        if not exist "!SEVENZIP!" (
            echo ERROR: 7-Zip not found. Please install 7-Zip and re-run setup.
        ) else (
        "!SEVENZIP!" x "!DEPS_DIR!\mpv.7z" -o"!DEPS_DIR!\mpv_tmp" -y
        if errorlevel 1 (
            echo ERROR: Failed to extract libmpv archive
        ) else (
        set "MPV_SRC=!DEPS_DIR!\mpv_tmp"
        if not exist "!MPV_SRC!\libmpv-2.dll" (
            for /d %%D in ("!DEPS_DIR!\mpv_tmp\*") do (
                if exist "%%~fD\libmpv-2.dll" set "MPV_SRC=%%~fD"
            )
        )
        if exist "!MPV_SRC!\libmpv-2.dll" (
        mkdir "!DEPS_DIR!\mpv"
        if exist "!MPV_SRC!\include" xcopy /e /i /y "!MPV_SRC!\include" "!DEPS_DIR!\mpv\include\" >nul
        move /y "!MPV_SRC!\libmpv-2.dll" "!DEPS_DIR!\mpv\" >nul
        if exist "!MPV_SRC!\libmpv.dll.a" move /y "!MPV_SRC!\libmpv.dll.a" "!DEPS_DIR!\mpv\" >nul
        if exist "!MPV_SRC!\libmpv-2.dll.lib" move /y "!MPV_SRC!\libmpv-2.dll.lib" "!DEPS_DIR!\mpv\" >nul
        ) else (
            echo ERROR: libmpv-2.dll not found in extracted archive
        )
        rmdir /s /q "!DEPS_DIR!\mpv_tmp"
        del "!DEPS_DIR!\mpv.7z"
        echo libmpv extracted to !DEPS_DIR!\mpv
        )
        )
    )
) else (
    echo libmpv already installed, skipping
)

echo [10/14] Downloading libmpv fallback (non-AVX2)...
if not defined MPV_FALLBACK_ARCH (
    echo No libmpv fallback needed for !WINARCH!, skipping
) else if not exist "!DEPS_DIR!\mpv-fallback\libmpv-2.dll" (
    if exist "!DEPS_DIR!\mpv-fallback-tmp" rmdir /s /q "!DEPS_DIR!\mpv-fallback-tmp"
    curl --fail --location --retry 3 "https://github.com/shinchiro/mpv-winbuild-cmake/releases/download/!MPV_RELEASE!/mpv-dev-!MPV_FALLBACK_ARCH!-!MPV_VERSION!.7z" -o "!DEPS_DIR!\mpv-fallback.7z"
    if errorlevel 1 (
        echo ERROR: Failed to download libmpv fallback
        exit /b 1
    ) else (
        if not exist "!SEVENZIP!" (
            echo ERROR: 7-Zip not found. Please install 7-Zip and re-run setup.
        ) else (
        "!SEVENZIP!" x "!DEPS_DIR!\mpv-fallback.7z" -o"!DEPS_DIR!\mpv-fallback-tmp" -y
        if errorlevel 1 (
            echo ERROR: Failed to extract libmpv fallback archive
        ) else (
        set "MPV_FALLBACK_SRC=!DEPS_DIR!\mpv-fallback-tmp"
        if not exist "!MPV_FALLBACK_SRC!\libmpv-2.dll" (
            for /d %%D in ("!DEPS_DIR!\mpv-fallback-tmp\*") do (
                if exist "%%~fD\libmpv-2.dll" set "MPV_FALLBACK_SRC=%%~fD"
            )
        )
        mkdir "!DEPS_DIR!\mpv-fallback"
        if exist "!MPV_FALLBACK_SRC!\libmpv-2.dll" (
            move /y "!MPV_FALLBACK_SRC!\libmpv-2.dll" "!DEPS_DIR!\mpv-fallback\" >nul
            if exist "!MPV_FALLBACK_SRC!\libmpv.dll.a" move /y "!MPV_FALLBACK_SRC!\libmpv.dll.a" "!DEPS_DIR!\mpv-fallback\" >nul
        ) else (
            echo ERROR: libmpv-2.dll not found in fallback archive
        )
        rmdir /s /q "!DEPS_DIR!\mpv-fallback-tmp"
        del "!DEPS_DIR!\mpv-fallback.7z"
        echo libmpv fallback extracted to !DEPS_DIR!\mpv-fallback
        )
        )
    )
) else (
    echo libmpv fallback already installed, skipping
)

echo [11/14] Downloading VCRedist and WiX tools...
if not exist "!DEPS_DIR!\!VCREDIST_NAME!" (
    echo Downloading !VCREDIST_NAME!...
    curl --fail --location --retry 3 -o "!DEPS_DIR!\!VCREDIST_NAME!" https://aka.ms/vs/17/release/!VCREDIST_NAME!
    if errorlevel 1 (
        echo ERROR: Failed to download the Visual C++ redistributable.
        exit /b 1
    )
)
if not exist "!DEPS_DIR!\wix\dark.exe" (
    echo Downloading WiX tools...
    curl -L -o "!DEPS_DIR!\wix.zip" https://github.com/wixtoolset/wix3/releases/download/wix3111rtm/wix311-binaries.zip
    if errorlevel 1 (
        echo ERROR: Failed to download WiX tools.
        exit /b 1
    )
    if not exist "!DEPS_DIR!\wix" mkdir "!DEPS_DIR!\wix"
    "!SEVENZIP!" x -y "!DEPS_DIR!\wix.zip" -o"!DEPS_DIR!\wix"
    if errorlevel 1 (
        echo ERROR: Failed to extract WiX tools.
        exit /b 1
    )
    if not exist "!DEPS_DIR!\wix\dark.exe" (
        echo ERROR: WiX extraction did not produce dark.exe.
        exit /b 1
    )
    del "!DEPS_DIR!\wix.zip"
)

echo [12/14] Extracting VC runtime DLLs...
if not exist "!DEPS_DIR!\vcruntime\vcruntime140.dll" (
    echo Extracting VCRedist with dark.exe...
    if not exist "!DEPS_DIR!\vcruntime" mkdir "!DEPS_DIR!\vcruntime"
    "!DEPS_DIR!\wix\dark.exe" -nologo "!DEPS_DIR!\!VCREDIST_NAME!" -x "!DEPS_DIR!\vcredist_tmp"
    if errorlevel 1 (
        echo ERROR: Failed to extract Visual C++ redistributable packages.
        exit /b 1
    )
    echo Extracting runtime CABs...
    expand.exe -F:* "!DEPS_DIR!\vcredist_tmp\AttachedContainer\packages\vcRuntimeMinimum_!VC_CAB_ARCH!\cab1.cab" "!DEPS_DIR!\vcruntime"
    if errorlevel 1 (
        echo ERROR: Failed to extract minimum VC runtime CAB.
        exit /b 1
    )
    expand.exe -F:* "!DEPS_DIR!\vcredist_tmp\AttachedContainer\packages\vcRuntimeAdditional_!VC_CAB_ARCH!\cab1.cab" "!DEPS_DIR!\vcruntime"
    if errorlevel 1 (
        echo ERROR: Failed to extract additional VC runtime CAB.
        exit /b 1
    )
    REM Rename files from *_<arch> to *.dll
    for %%f in ("!DEPS_DIR!\vcruntime\*_!VC_FILE_ARCH!") do (
        set "name=%%~nf"
        if /i "!WINARCH!"=="arm64" (
            ren "%%f" "!name:_arm64=!.dll"
        ) else (
            ren "%%f" "!name:_amd64=!.dll"
        )
    )
    rd /s /q "!DEPS_DIR!\vcredist_tmp"
    if not exist "!DEPS_DIR!\vcruntime\vcruntime140.dll" (
        echo ERROR: VC runtime extraction completed without vcruntime140.dll.
        exit /b 1
    )
    if not exist "!DEPS_DIR!\vcruntime\msvcp140.dll" (
        echo ERROR: VC runtime extraction completed without msvcp140.dll.
        exit /b 1
    )
    echo VC runtime DLLs extracted to !DEPS_DIR!\vcruntime
)

echo [13/14] Generating mpv import library...
if exist "!DEPS_DIR!\mpv\libmpv-2.dll" (
    if not exist "!DEPS_DIR!\mpv\libmpv-2.dll.lib" (
        REM common.bat already resolved Visual Studio, including Program Files (x86) installs.
        if defined VCVARS (
            echo Using Visual Studio: !VCVARS!
            call "!VCVARS!" >nul 2>&1
            echo Generating import library...
            echo LIBRARY libmpv-2.dll > "!DEPS_DIR!\mpv\mpv.def"
            echo EXPORTS >> "!DEPS_DIR!\mpv\mpv.def"
            for /f "skip=19 tokens=4" %%a in ('dumpbin /exports "!DEPS_DIR!\mpv\libmpv-2.dll"') do (
                if not "%%a"=="" echo %%a >> "!DEPS_DIR!\mpv\mpv.def"
            )
            lib /def:"!DEPS_DIR!\mpv\mpv.def" /out:"!DEPS_DIR!\mpv\libmpv-2.dll.lib" /MACHINE:!MACHINE!
            echo Import library created: !DEPS_DIR!\mpv\libmpv-2.dll.lib
        ) else (
            echo WARNING: Visual Studio not found. Import library will be generated during build.
        )
    ) else (
        echo mpv import library already exists, skipping
    )
)

echo [14/14] Generating CMakePresets.json...
powershell -Command "(Get-Content '!SCRIPT_DIR!..\CMakePresets.json.in' -Raw) -replace '@QT_VERSION@','!QT_VERSION!' -replace '@BREW_PREFIX@','' | Set-Content '!PROJECT_ROOT!\CMakePresets.json' -NoNewline"

echo.
echo Setup complete. Restart terminal to refresh PATH, then run build.bat
endlocal
