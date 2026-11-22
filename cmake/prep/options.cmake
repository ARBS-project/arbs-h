# Publisher Metadata
set(SUNSHINE_PUBLISHER_NAME "ARBS project"
        CACHE STRING "The name of the publisher (not developer) of the application.")
set(SUNSHINE_PUBLISHER_WEBSITE "https://github.com/arbs-project/arbs-h"
        CACHE STRING "The URL of the publisher's website.")
set(SUNSHINE_PUBLISHER_ISSUE_URL "https://github.com/arbs-project/arbs-h/issues"
        CACHE STRING "The URL of the publisher's support site or issue tracker.
        If you provide a modified version of Sunshine, we kindly request that you use your own url.")

# ARBS-H R1a (D-R1a-2/3/11): machine-wide names that must never collide with Vibepollo, and the
# update check default. The installer (packaging/windows/arbs-h) uses the same service name.
set(ARBS_H_SERVICE_NAME "ARBSHService" CACHE STRING "Windows service name of ARBS-H (must differ from ApolloService)")
set(ARBS_H_UPDATE_CHECK_DEFAULT_SECONDS "0" CACHE STRING
        "Default update_check_interval in seconds (0 = off; installer builds use 86400)")
if(NOT ARBS_H_UPDATE_CHECK_DEFAULT_SECONDS MATCHES "^[0-9]+$")
    message(FATAL_ERROR "ARBS_H_UPDATE_CHECK_DEFAULT_SECONDS must be a non-negative integer")
endif()
if(ARBS_H_SERVICE_NAME STREQUAL "ApolloService" OR NOT ARBS_H_SERVICE_NAME MATCHES "^[A-Za-z0-9_]+$")
    message(FATAL_ERROR "ARBS_H_SERVICE_NAME must be a plain name and must not be ApolloService")
endif()
add_compile_definitions(ARBS_H_SERVICE_NAME="${ARBS_H_SERVICE_NAME}"
        ARBS_H_UPDATE_CHECK_DEFAULT_SECONDS=${ARBS_H_UPDATE_CHECK_DEFAULT_SECONDS})
message(STATUS "ARBS-H service name: ${ARBS_H_SERVICE_NAME}, update check default: ${ARBS_H_UPDATE_CHECK_DEFAULT_SECONDS}s")

option(BUILD_DOCS "Build documentation" OFF)
option(BUILD_TESTS "Build unit tests." ON)
option(BUILD_WERROR "Enable -Werror flag." OFF)

# if this option is set, the build will exit after configuring special package configuration files
option(SUNSHINE_CONFIGURE_ONLY "Configure special files only, then exit." OFF)

option(SUNSHINE_ENABLE_TRAY "Enable system tray icon." ON)
option(SUNSHINE_ENABLE_WEBRTC "Enable WebRTC streaming support (Windows only)." OFF)

# PyroWave GPU encoders are available on Windows and Linux.
if(WIN32 OR CMAKE_SYSTEM_NAME STREQUAL "Linux")
    option(SUNSHINE_ENABLE_PYROWAVE "Enable the PyroWave video codec." ON)
else()
    option(SUNSHINE_ENABLE_PYROWAVE "Enable the PyroWave video codec." OFF)
endif()

option(SUNSHINE_EXPERIMENTAL_PYROWAVE_D3D12 "Enable the Windows PyroWave conversion-only D3D12 prototype (native qualification required)." OFF)

option(SUNSHINE_SYSTEM_VULKAN_HEADERS "Use system installation of vulkan-headers rather than the submodule." OFF)
option(SUNSHINE_SYSTEM_WAYLAND_PROTOCOLS "Use system installation of wayland-protocols rather than the submodule." OFF)

if(APPLE)
    option(BOOST_USE_STATIC "Use static boost libraries." OFF)
else()
    option(BOOST_USE_STATIC "Use static boost libraries." ON)
endif()

option(CUDA_FAIL_ON_MISSING "Fail the build if CUDA is not found." ON)
option(SUNSHINE_REQUIRE_CUDA_PASCAL "Require Pascal-compatible CUDA for release packages" OFF)
option(CUDA_INHERIT_COMPILE_OPTIONS
        "When building CUDA code, inherit compile options from the the main project. You may want to disable this if
        your IDE throws errors about unknown flags after running cmake." ON)

if(UNIX)
    option(SUNSHINE_BUILD_HOMEBREW
            "Enable a Homebrew build." OFF)
    option(SUNSHINE_CONFIGURE_HOMEBREW
            "Configure Homebrew formula. Recommended to use with SUNSHINE_CONFIGURE_ONLY" OFF)
endif()

if(APPLE)
    option(SUNSHINE_CONFIGURE_PORTFILE
            "Configure macOS Portfile. Recommended to use with SUNSHINE_CONFIGURE_ONLY" OFF)
elseif(UNIX)  # Linux
    option(SUNSHINE_BUILD_STEAMOS "Build a relocatable SteamOS user bundle." OFF)
    if(SUNSHINE_BUILD_STEAMOS)
        if(NOT CMAKE_SYSTEM_NAME STREQUAL "Linux")
            message(FATAL_ERROR "The SteamOS bundle requires Linux")
        endif()
        if(SUNSHINE_BUILD_APPIMAGE OR SUNSHINE_BUILD_FLATPAK OR SUNSHINE_CONFIGURE_PKGBUILD)
            message(FATAL_ERROR "The SteamOS bundle cannot be combined with other packaging profiles")
        endif()
        # These defaults apply only to a fresh build directory. An explicit
        # backend choice remains available for other Gamescope hardware.
        option(SUNSHINE_ENABLE_CUDA "Enable cuda specific code." OFF)
        option(SUNSHINE_ENABLE_DRM "Enable KMS grab if available." OFF)
        set(SUNSHINE_ASSETS_DIR "share/vibepollo")
    endif()
    option(SUNSHINE_BUILD_APPIMAGE
            "Enable an AppImage build." OFF)
    option(SUNSHINE_BUILD_FLATPAK
            "Enable a Flatpak build." OFF)
    option(SUNSHINE_CONFIGURE_PKGBUILD
            "Configure files required for AUR. Recommended to use with SUNSHINE_CONFIGURE_ONLY" OFF)
    option(SUNSHINE_CONFIGURE_FLATPAK_MAN
            "Configure manifest file required for Flatpak build. Recommended to use with SUNSHINE_CONFIGURE_ONLY" OFF)

    # Linux capture methods
    option(SUNSHINE_ENABLE_CUDA
            "Enable cuda specific code." ON)
    option(SUNSHINE_ENABLE_DRM
            "Enable KMS grab if available." ON)
    option(SUNSHINE_ENABLE_VAAPI
            "Enable building vaapi specific code." ON)
    option(SUNSHINE_ENABLE_VULKAN
            "Enable Vulkan video encoding." ON)
    option(SUNSHINE_ENABLE_WAYLAND
            "Enable building wayland specific code." ON)
    option(SUNSHINE_ENABLE_X11
            "Enable X11 grab if available." ON)
    option(SUNSHINE_ENABLE_KWIN
            "Enable KWin ScreenCast grab if available" ON)
    option(SUNSHINE_ENABLE_PORTAL
            "Enable XDG portal grab if available" ON)
    option(SUNSHINE_ENABLE_GAMESCOPE "Enable Gamescope PipeWire capture" ${SUNSHINE_ENABLE_WAYLAND})
    if(SUNSHINE_BUILD_STEAMOS AND NOT SUNSHINE_ENABLE_GAMESCOPE)
        message(FATAL_ERROR "The SteamOS bundle requires Gamescope capture")
    endif()
endif()
