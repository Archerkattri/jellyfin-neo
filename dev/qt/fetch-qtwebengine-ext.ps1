<#
.SYNOPSIS
    Fetch the Qt WebEngine extension for Qt 6.12 SDKs (Windows).

.DESCRIPTION
    Qt 6.12 moved WebEngine out of the base repository: it ships only as an
    online-installer extension (WebEngine 6.140.0, package version
    6.12.0-0-202609281005). The tree-pinned aqtinstall revision has no
    --extension flag, and its "-m qtwebengine" resolves to a stale snapshot,
    so 6.12 SDKs must be installed WITHOUT the qtwebengine module and
    completed with this script instead.

    Downloads the two pinned extension archives for the target architecture,
    verifies their SHA1 checksums fail-closed, and extracts them over the aqt
    SDK directory, mirroring the installer's Extract operations. SHA1 values
    were taken from the per-archive .sha1 sidecars in the online repository
    (fetched 2026-10-03).

    Companion to fetch-qtwebengine-ext.sh (Linux/macOS). Compatible with
    Windows PowerShell 5.1 (no pwsh-only syntax).

.PARAMETER QtRoot
    Qt 6.12 SDK architecture directory, e.g. dev\windows\deps\qt\6.12.0\msvc2022_64
    or $env:QT_ROOT_DIR from install-qt-action.

.PARAMETER QtVersion
    Qt version of the SDK (default: 6.12.0). Only 6.12.x is accepted.

.PARAMETER QtArch
    aqt architecture: win64_msvc2022_64 (default),
    win64_msvc2022_arm64 (native ARM64 host), or
    win64_msvc2022_arm64_cross_compiled (x64 host, ARM64 target).

.PARAMETER CheckOnly
    Only verify the extension marker files exist; download nothing.

.PARAMETER DownloadDir
    Keep/reuse downloaded archives in this directory (default: fresh temp dir).

.EXAMPLE
    dev\qt\fetch-qtwebengine-ext.ps1 -QtRoot $env:QT_ROOT_DIR -QtArch win64_msvc2022_64
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$QtRoot,

    [string]$QtVersion = "6.12.0",

    [ValidateSet("win64_msvc2022_64", "win64_msvc2022_arm64", "win64_msvc2022_arm64_cross_compiled")]
    [string]$QtArch = "win64_msvc2022_64",

    [switch]$CheckOnly,

    [string]$DownloadDir = ""
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

$ExtVersion = "6.12.0-0-202609281005"
$WebEngineVersion = "6.140.0"
$BaseUrl = "https://download.qt.io/online/qtsdkrepository"

if (-not $QtVersion.StartsWith("6.12")) {
    throw "Qt $QtVersion is not supported: the pinned extension ($ExtVersion) matches Qt 6.12 only"
}

# Per-architecture repository location, package, archives, pinned SHA1.
$ArchMap = @{
    "win64_msvc2022_64" = @{
        Host       = "windows_x86"
        SubDir     = "msvc2022_64"
        Package    = "extensions.qtwebengine.6120.61400.win64_msvc2022_64"
        Main       = "qtwebengine-Windows-Windows_11_24H2-MSVC2022-Windows-Windows_11_24H2-X86_64.7z"
        MainSha1   = "a8f682478f00cb9106f45315d401bee114ff3adb"
        PluginSha1 = "cd0def84734640e4d4262bdd7689a105abd8194e"
    }
    "win64_msvc2022_arm64" = @{
        Host       = "windows_arm64"
        SubDir     = "msvc2022_arm64"
        Package    = "extensions.qtwebengine.6120.61400.win64_msvc2022_arm64"
        Main       = "qtwebengine-Windows-Windows_11_24H2-MSVC2022-Windows-Windows_11_24H2-ARM64.7z"
        MainSha1   = "5cd8e4ff99516b97b5fc1cc32e3ac2d3180ec008"
        PluginSha1 = "87b3fa49c230e7f16028daf55a0bc4291873038d"
    }
    "win64_msvc2022_arm64_cross_compiled" = @{
        Host       = "windows_x86"
        SubDir     = "msvc2022_arm64"
        Package    = "extensions.qtwebengine.6120.61400.win64_msvc2022_arm64_cross_compiled"
        Main       = "qtwebengine-Windows-Windows_11_24H2-MSVC2022-Windows-Windows_11_24H2-ARM64.7z"
        MainSha1   = "c3d682d8a0c29e1d6d4645598dfab200c5aa6c48"
        PluginSha1 = "23231b906af723c48435bee1ce2360630faa6f1c"
    }
}
$Arch = $ArchMap[$QtArch]
$PluginName = "qtwebview_qtwebengine_plugin.7z"

$Markers = @(
    "bin\Qt6WebEngineCore.dll",
    "bin\QtWebEngineProcess.exe",
    "plugins\webview\qtwebview_webengine.dll"
)

if (-not (Test-Path -LiteralPath $QtRoot -PathType Container)) {
    throw "Qt SDK directory not found: $QtRoot"
}
if (-not (Test-Path -LiteralPath (Join-Path $QtRoot "lib\cmake\Qt6\Qt6Config.cmake"))) {
    throw "$QtRoot does not look like a Qt SDK (lib\cmake\Qt6\Qt6Config.cmake missing)"
}

function Test-Markers {
    foreach ($marker in $Markers) {
        if (Test-Path -LiteralPath (Join-Path $QtRoot $marker) -PathType Leaf) {
            Write-Host "fetch-qtwebengine-ext: found $marker"
        } else {
            Write-Host "fetch-qtwebengine-ext: missing $marker"
            return $false
        }
    }
    return $true
}

$installed = Test-Markers
if ($CheckOnly) {
    if ($installed) {
        Write-Host "fetch-qtwebengine-ext: Qt WebEngine $WebEngineVersion extension is installed"
        exit 0
    }
    Write-Host "fetch-qtwebengine-ext: Qt WebEngine $WebEngineVersion extension is NOT installed"
    exit 1
}
if ($installed) {
    Write-Host "fetch-qtwebengine-ext: Qt WebEngine $WebEngineVersion extension already installed; skipping download"
    exit 0
}

if ([string]::IsNullOrEmpty($DownloadDir)) {
    $workdir = Join-Path ([System.IO.Path]::GetTempPath()) ("qtwebengine-ext-" + [System.Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $workdir | Out-Null
    $cleanup = $true
} else {
    $workdir = $DownloadDir
    New-Item -ItemType Directory -Path $workdir -Force | Out-Null
    $cleanup = $false
}

function Get-Archive {
    param([string]$Name, [string]$Sha1)
    $file = $ExtVersion + $Name
    $url = "$BaseUrl/$($Arch.Host)/extensions/qtwebengine/6120/61400/$($Arch.SubDir)/$($Arch.Package)/$file"
    $dest = Join-Path $workdir $file
    if (Test-Path -LiteralPath $dest -PathType Leaf) {
        $cached = (Get-FileHash -LiteralPath $dest -Algorithm SHA1).Hash.ToLowerInvariant()
        if ($cached -eq $Sha1.ToLowerInvariant()) {
            Write-Host "fetch-qtwebengine-ext: reusing $file (SHA1 matches)"
            return $dest
        }
        Write-Host "fetch-qtwebengine-ext: cached $file has a wrong SHA1; re-downloading"
        Remove-Item -LiteralPath $dest -Force
    }
    Write-Host "fetch-qtwebengine-ext: downloading $url"
    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    if ($curl) {
        & curl.exe --fail --location --retry 3 --output $dest $url
        if ($LASTEXITCODE -ne 0) {
            throw "download failed for $file (curl exit $LASTEXITCODE)"
        }
    } else {
        # Fallback for machines without curl.exe (Windows 10+ ships it).
        Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
    }
    $actual = (Get-FileHash -LiteralPath $dest -Algorithm SHA1).Hash.ToLowerInvariant()
    if ($actual -ne $Sha1.ToLowerInvariant()) {
        Remove-Item -LiteralPath $dest -Force
        throw "SHA1 mismatch for $file (expected $Sha1); deleted the download"
    }
    Write-Host "fetch-qtwebengine-ext: verified $file (SHA1 $Sha1)"
    return $dest
}

function Find-SevenZip {
    $cmd = Get-Command 7z.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $fallback = "C:\Program Files\7-Zip\7z.exe"
    if (Test-Path -LiteralPath $fallback -PathType Leaf) { return $fallback }
    throw "7z.exe not found (install 7-Zip; CI runners and setup.bat provide it)"
}

try {
    $mainFile = Get-Archive -Name $Arch.Main -Sha1 $Arch.MainSha1
    $pluginFile = Get-Archive -Name $PluginName -Sha1 $Arch.PluginSha1

    $sevenZip = Find-SevenZip
    Write-Host "fetch-qtwebengine-ext: extracting $mainFile over $QtRoot"
    & $sevenZip x $mainFile "-o$QtRoot" -y | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "extraction failed for $mainFile (7z exit $LASTEXITCODE)"
    }
    Write-Host "fetch-qtwebengine-ext: extracting $pluginFile over $QtRoot"
    & $sevenZip x $pluginFile "-o$QtRoot" -y | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "extraction failed for $pluginFile (7z exit $LASTEXITCODE)"
    }

    if (-not (Test-Markers)) {
        throw "extraction finished but extension marker files are missing"
    }
    Write-Host "fetch-qtwebengine-ext: Qt WebEngine $WebEngineVersion extension installed into $QtRoot"
} finally {
    if ($cleanup -and (Test-Path -LiteralPath $workdir -PathType Container)) {
        Remove-Item -LiteralPath $workdir -Recurse -Force
    }
}
