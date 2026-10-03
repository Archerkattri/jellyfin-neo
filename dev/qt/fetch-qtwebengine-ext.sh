#!/usr/bin/env bash
# Fetch the Qt WebEngine extension for Qt 6.12 SDKs (Linux/macOS).
#
# Qt 6.12 moved WebEngine out of the base repository: it ships only as an
# online-installer extension (WebEngine 6.140.0, package version
# 6.12.0-0-202609281005). The tree-pinned aqtinstall revision has no
# --extension flag, and its "-m qtwebengine" resolves to the stale July 2026
# snapshot (6.12.0-0-202607081027), so 6.12 SDKs must be installed WITHOUT
# the qtwebengine module and completed with this script instead.
#
# The script downloads the two pinned extension archives for the target
# architecture, verifies their SHA1 checksums fail-closed, and extracts them
# over the aqt SDK directory, mirroring the installer's Extract operations.
# SHA1 values were taken from the per-archive .sha1 sidecars in the online
# repository (fetched 2026-10-03).
#
# Usage:
#   fetch-qtwebengine-ext.sh --qt-root DIR [--qt-version 6.12.0] [--arch NAME]
#       [--check-only] [--download-dir DIR] [--keep] [--python PYTHON]
#
# Windows users: use fetch-qtwebengine-ext.ps1 instead.
set -euo pipefail

EXT_VERSION="6.12.0-0-202609281005"
WEBENGINE_VERSION="6.140.0"
BASE_URL="https://download.qt.io/online/qtsdkrepository"

QT_ROOT=""
QT_VERSION="6.12.0"
QT_ARCH=""
CHECK_ONLY=0
DOWNLOAD_DIR=""
KEEP=0
PYTHON="python3"

usage() {
	cat <<'EOF'
Usage: fetch-qtwebengine-ext.sh --qt-root DIR [options]

  --qt-root DIR       Qt 6.12 SDK architecture directory (required), e.g.
                      dev/linux/deps/qt/6.12.0/gcc_64 or $QT_ROOT_DIR
  --qt-version VER    Qt version of the SDK (default: 6.12.0). Only 6.12.x
                      is accepted: the pinned extension matches Qt 6.12 only.
  --arch NAME         aqt architecture (default: linux_gcc_64 on Linux,
                      clang_64 on macOS). Windows arches are handled by the
                      companion fetch-qtwebengine-ext.ps1 script.
  --check-only        Only verify the extension marker files exist; download
                      nothing. Exits 0 when installed, 1 otherwise.
  --download-dir DIR  Keep/reuse downloaded archives in DIR (default: a fresh
                      temporary directory). Archives already present with a
                      matching SHA1 are reused.
  --keep              Keep downloaded archives (implies a persistent temp dir).
  --python PYTHON     Python with py7zr for extraction fallback (default:
                      python3). Point at the aqt venv python if needed.
  -h, --help          Show this help.
EOF
}

log() { echo "fetch-qtwebengine-ext: $*"; }
die() { echo "fetch-qtwebengine-ext: error: $*" >&2; exit 1; }

# Resolve the per-architecture repository location, package, archives, and
# pinned SHA1 checksums. Sets: REPO_HOST REPO_SUBDIR PKG MAIN_ARCH MAIN_SHA1
# PLUGIN_SHA1 MARKER_CORE MARKER_PROCESS MARKER_PLUGIN.
resolve_arch() {
	case "${QT_ARCH}" in
	linux_gcc_64|gcc_64)
		REPO_HOST="linux_x64"
		REPO_SUBDIR="x86_64"
		PKG="extensions.qtwebengine.6120.61400.linux_gcc_64"
		MAIN_ARCH="qtwebengine-Linux-RHEL_9_6-GCC-Linux-RHEL_9_6-X86_64.7z"
		MAIN_SHA1="df1668503cc0981087b2b003fea4a1df1ad15ae3"
		PLUGIN_SHA1="7f64447d8d9d9f4ca95cacabb0e7287be56395de"
		MARKER_CORE="lib/libQt6WebEngineCore.so.${WEBENGINE_VERSION}"
		MARKER_PROCESS="libexec/QtWebEngineProcess"
		MARKER_PLUGIN="plugins/webview/libqtwebview_webengine.so"
		;;
	clang_64|macos)
		REPO_HOST="mac_x64"
		REPO_SUBDIR="clang_64"
		PKG="extensions.qtwebengine.6120.61400.clang_64"
		MAIN_ARCH="qtwebengine-MacOS-MacOS_26-Clang-MacOS-MacOS_26-X86_64-ARM64.7z"
		MAIN_SHA1="6880cbacce9a8f59a0aa44b456972ffb0757e6cd"
		PLUGIN_SHA1="abe09efd84e1fea703149033fe81614680e59f42"
		MARKER_CORE="lib/QtWebEngineCore.framework/Versions/A/QtWebEngineCore"
		MARKER_PROCESS="lib/QtWebEngineCore.framework/Versions/A/Helpers/QtWebEngineProcess.app/Contents/MacOS/QtWebEngineProcess"
		MARKER_PLUGIN="plugins/webview/libqtwebview_webengine.dylib"
		;;
	win64_msvc2022_64|win64_msvc2022_arm64|win64_msvc2022_arm64_cross_compiled)
		die "arch '${QT_ARCH}' is a Windows target; use dev/qt/fetch-qtwebengine-ext.ps1 instead"
		;;
	*)
		die "unsupported arch '${QT_ARCH}' (want linux_gcc_64 or clang_64)"
		;;
	esac
}

# Verify the extension marker files exist under QT_ROOT. Returns 0 when the
# pinned WebEngine is installed, 1 otherwise.
markers_present() {
	[ -f "${QT_ROOT}/${MARKER_CORE}" ] \
		&& [ -f "${QT_ROOT}/${MARKER_PROCESS}" ] \
		&& [ -f "${QT_ROOT}/${MARKER_PLUGIN}" ]
}

report_markers() {
	local marker
	for marker in "${MARKER_CORE}" "${MARKER_PROCESS}" "${MARKER_PLUGIN}"; do
		if [ -f "${QT_ROOT}/${marker}" ]; then
			log "found ${marker}"
		else
			log "missing ${marker}"
		fi
	done
}

# Verify a file against an expected SHA1; returns non-zero on mismatch.
verify_sha1() {
	local file="$1"
	local expected="$2"
	local actual=""
	if command -v sha1sum >/dev/null 2>&1; then
		actual="$(sha1sum "${file}" | awk '{print $1}')"
	elif command -v shasum >/dev/null 2>&1; then
		actual="$(shasum -a 1 "${file}" | awk '{print $1}')"
	else
		die "no SHA1 tool found (need sha1sum or shasum)"
	fi
	[ "${actual}" = "${expected}" ]
}

download_archive() {
	local name="$1"   # archive name without version prefix
	local sha1="$2"   # pinned SHA1
	local dest="$3"   # download directory
	local file="${EXT_VERSION}${name}"
	local url="${BASE_URL}/${REPO_HOST}/extensions/qtwebengine/6120/61400/${REPO_SUBDIR}/${PKG}/${file}"
	if [ -f "${dest}/${file}" ]; then
		if verify_sha1 "${dest}/${file}" "${sha1}"; then
			log "reusing ${file} (SHA1 matches)" >&2
			echo "${dest}/${file}"
			return 0
		fi
		log "cached ${file} has a wrong SHA1; re-downloading" >&2
		rm -f "${dest}/${file}"
	fi
	log "downloading ${url}" >&2
	curl --fail --location --retry 3 --output "${dest}/${file}" "${url}"
	if ! verify_sha1 "${dest}/${file}" "${sha1}"; then
		rm -f "${dest}/${file}"
		die "SHA1 mismatch for ${file} (expected ${sha1}); deleted the download"
	fi
	log "verified ${file} (SHA1 ${sha1})" >&2
	echo "${dest}/${file}"
}

extract_archive() {
	local archive="$1"
	if command -v 7z >/dev/null 2>&1; then
		7z x "${archive}" -o"${QT_ROOT}" -y
	elif command -v 7zz >/dev/null 2>&1; then
		7zz x "${archive}" -o"${QT_ROOT}" -y
	elif command -v 7zr >/dev/null 2>&1; then
		7zr x "${archive}" -o"${QT_ROOT}" -y
	elif "${PYTHON}" -c "import py7zr" >/dev/null 2>&1; then
		"${PYTHON}" -m py7zr x "${archive}" "${QT_ROOT}"
	else
		die "no 7z extractor found (need 7z, or ${PYTHON} with py7zr)"
	fi
}

main() {
	while [ "$#" -gt 0 ]; do
		case "$1" in
		--qt-root) QT_ROOT="$2"; shift 2 ;;
		--qt-root=*) QT_ROOT="${1#--qt-root=}"; shift ;;
		--qt-version) QT_VERSION="$2"; shift 2 ;;
		--qt-version=*) QT_VERSION="${1#--qt-version=}"; shift ;;
		--arch) QT_ARCH="$2"; shift 2 ;;
		--arch=*) QT_ARCH="${1#--arch=}"; shift ;;
		--check-only) CHECK_ONLY=1; shift ;;
		--download-dir) DOWNLOAD_DIR="$2"; shift 2 ;;
		--download-dir=*) DOWNLOAD_DIR="${1#--download-dir=}"; shift ;;
		--keep) KEEP=1; shift ;;
		--python) PYTHON="$2"; shift 2 ;;
		--python=*) PYTHON="${1#--python=}"; shift ;;
		-h|--help) usage; exit 0 ;;
		*) die "unknown argument '$1' (see --help)" ;;
		esac
	done

	[ -n "${QT_ROOT}" ] || die "--qt-root is required (see --help)"
	case "${QT_VERSION}" in
	6.12*) ;;
	*) die "Qt ${QT_VERSION} is not supported: the pinned extension (${EXT_VERSION}) matches Qt 6.12 only" ;;
	esac

	if [ -z "${QT_ARCH}" ]; then
		case "$(uname -s)" in
		Linux) QT_ARCH="linux_gcc_64" ;;
		Darwin) QT_ARCH="clang_64" ;;
		*) die "cannot detect arch on $(uname -s); pass --arch explicitly" ;;
		esac
	fi
	resolve_arch

	[ -d "${QT_ROOT}" ] || die "Qt SDK directory not found: ${QT_ROOT}"
	[ -f "${QT_ROOT}/lib/cmake/Qt6/Qt6Config.cmake" ] \
		|| die "${QT_ROOT} does not look like a Qt SDK (lib/cmake/Qt6/Qt6Config.cmake missing)"

	if [ "${CHECK_ONLY}" -eq 1 ]; then
		report_markers
		if markers_present; then
			log "Qt WebEngine ${WEBENGINE_VERSION} extension is installed"
			exit 0
		fi
		log "Qt WebEngine ${WEBENGINE_VERSION} extension is NOT installed"
		exit 1
	fi

	if markers_present; then
		log "Qt WebEngine ${WEBENGINE_VERSION} extension already installed; skipping download"
		exit 0
	fi

	command -v curl >/dev/null 2>&1 || die "curl is required to download the extension"

	local workdir="${DOWNLOAD_DIR}"
	if [ -z "${workdir}" ]; then
		workdir="$(mktemp -d "${TMPDIR:-/tmp}/qtwebengine-ext.XXXXXX")"
		if [ "${KEEP}" -eq 0 ]; then
			# shellcheck disable=SC2064
			trap "rm -rf '${workdir}'" EXIT
		else
			log "keeping downloads in ${workdir}"
		fi
	else
		mkdir -p "${workdir}"
	fi

	local main_file plugin_file
	main_file="$(download_archive "${MAIN_ARCH}" "${MAIN_SHA1}" "${workdir}")"
	plugin_file="$(download_archive "qtwebview_qtwebengine_plugin.7z" "${PLUGIN_SHA1}" "${workdir}")"

	log "extracting ${main_file} over ${QT_ROOT}"
	extract_archive "${main_file}"
	log "extracting ${plugin_file} over ${QT_ROOT}"
	extract_archive "${plugin_file}"

	if ! markers_present; then
		report_markers
		die "extraction finished but extension marker files are missing"
	fi
	report_markers
	log "Qt WebEngine ${WEBENGINE_VERSION} extension installed into ${QT_ROOT}"
}

if [ "${BASH_SOURCE[0]:-$0}" = "$0" ]; then
	main "$@"
fi
