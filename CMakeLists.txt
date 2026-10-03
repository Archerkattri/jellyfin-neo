cmake_minimum_required(VERSION 3.10...3.31 FATAL_ERROR)

# use a toolchain file if any for Embedded
if (EXISTS "${CMAKE_SOURCE_DIR}/toolchain.cmake")
  set(CMAKE_TOOLCHAIN_FILE "${CMAKE_SOURCE_DIR}/toolchain.cmake")
endif()

project(JellyfinDesktop CXX C)

set(WINDOWS_DEPS_DIR "${PROJECT_SOURCE_DIR}/deps" CACHE PATH
    "Directory containing Windows packaging dependencies")

# Windows target architecture for packaging (installer filename, VCRedist).
# Detected from the target processor so ARM64 cross builds package correctly.
# Override with -DINSTALLER_ARCH_STR=x64|arm64 if detection is ever wrong.
if(WIN32 AND NOT INSTALLER_ARCH_STR)
  if(CMAKE_SYSTEM_PROCESSOR MATCHES "[Aa][Rr][Mm]64|aarch64")
    set(INSTALLER_ARCH_STR arm64)
  elseif(CMAKE_SIZEOF_VOID_P MATCHES 8)
    set(INSTALLER_ARCH_STR x64)
  else()
    set(INSTALLER_ARCH_STR x86)
  endif()
endif()
if(WIN32 AND NOT VCREDIST_EXE_NAME AND INSTALLER_ARCH_STR)
  set(VCREDIST_EXE_NAME "vc_redist.${INSTALLER_ARCH_STR}.exe")
endif()

# we want this to be able to run clang-tidy
set(CMAKE_EXPORT_COMPILE_COMMANDS ON CACHE BOOL "" FORCE)

option(CHECK_FOR_UPDATES "Enable checking for new versions of Jellyfin" OFF)
option(OPENELEC "Make an OpenELEC build" OFF)
option(LINUX_X11POWER "Enable non D-Bus screensaver management" OFF)
option(USE_STATIC_MPVQT "Build MpvQt from bundled submodule instead of using system library" OFF)
option(MACOS_LAUNCH_WRAPPER "Wrap macOS binary in a shell script to block DYLD_FRAMEWORK_PATH injection" OFF)
option(BUNDLE_QT_RUNTIME "Bundle the Qt runtime for Linux distribution packages" OFF)
option(COVERAGE "Gemerate test code coverage with gcov" OFF)

if (NOT CHECK_FOR_UPDATES)
    add_definitions(-DDISABLE_UPDATE_CHECK)
endif()

if((NOT LINUX_X11POWER) AND (UNIX AND (NOT APPLE)))
  set(LINUX_DBUS ON)
endif()

if(OPENELEC)
  add_definitions(-DKONVERGO_OPENELEC=1)
  Message(STATUS "Making an OpenELEC build")
endif(OPENELEC)

if(BUILD_TARGET STREQUAL "RPI")
  add_definitions(-DTARGET_RPI=1)
  set(RPI_LIBS bcm_host)
  Message(STATUS "Build for Raspberry PI target")
endif(BUILD_TARGET STREQUAL "RPI")

if(COVERAGE)
  add_compile_options(--coverage -fno-inline)
  add_link_options(--coverage)
endif()

set(CMAKE_INCLUDE_CURRENT_DIR ON)
set(CMAKE_MODULE_PATH ${CMAKE_MODULE_PATH} "${CMAKE_SOURCE_DIR}/CMakeModules/")
set(CMAKE_INSTALL_DEFAULT_COMPONENT_NAME Core)

macro(set_policy _POLICY _VALUE)
  if(POLICY ${_POLICY})
    cmake_policy(SET ${_POLICY} ${_VALUE})
  endif()
endmacro()

set_policy(CMP0020 NEW)
set_policy(CMP0017 NEW)
set_policy(CMP0058 NEW)
set_policy(CMP0071 NEW)
set_policy(CMP0072 NEW)
set_policy(CMP0148 OLD)

include(utils)
include(CompilerFlags)
include(DependencyConfiguration)
include(QtConfiguration)
include(VersionConfiguration)
include(NameConfiguration)
include(PlayerConfiguration)
include(InputConfiguration)
include(ClangTidy)

add_definitions(-DQS_LOG_LINE_NUMBERS -DQS_LOG_SEPARATE_THREAD)

if(APPLE)
  include(AppleConfiguration)
elseif(WIN32)
  include(Win32Configuration)
elseif(UNIX AND (NOT APPLE))
  include(LinuxConfiguration)
endif(APPLE)

if (Qt6_POSITION_INDEPENDENT_CODE)
  SET(CMAKE_POSITION_INDEPENDENT_CODE ON)
endif(Qt6_POSITION_INDEPENDENT_CODE)

add_subdirectory(external)
add_subdirectory(src)

enable_testing()
add_subdirectory(tests)

include(CPackConfiguration)

add_custom_target(install_app_bundle COMMAND ${CMAKE_COMMAND} -P cmake_install.cmake DEPENDS JellyfinDesktop)
