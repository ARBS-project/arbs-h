/**
 * @file src/platform/windows/arbs_h_names.h
 * @brief ARBS-H R1a (D-R1a-2/3): machine-wide names that must never collide with Vibepollo.
 *
 * ARBS-H can be installed next to an official Vibepollo or Apollo. The identities listed in this
 * file (service, ProgramData folder, HKLM key, scheduled task, named kernel objects, per-user state
 * folder, ETW session, temporary CA bundle) are its own. Not every name is unique: the Playnite
 * connector (pipe, plugin id, GUID, extension folder) is still shared with Vibepollo (H013 D1,
 * deferred), and protocol names such as the mDNS service type must stay identical for Moonlight.
 * packaging/windows/arbs-h/tests/test_arbs_h_static.ps1 lists the known exceptions. The service name comes from
 * the CMake cache variable ARBS_H_SERVICE_NAME (cmake/prep/options.cmake); the fallback below is
 * only for standalone compiles (tests/unit/test_display_restore_task.py and similar).
 */
#pragma once

#ifndef ARBS_H_SERVICE_NAME
  #define ARBS_H_SERVICE_NAME "ARBSHService"
#endif

#define ARBS_H_NAMES_WIDEN_(x) L##x
#define ARBS_H_NAMES_WIDEN(x) ARBS_H_NAMES_WIDEN_(x)

/// Windows service name (ANSI / wide). Never "ApolloService" (enforced by CMake).
#define ARBS_H_SERVICE_NAME_A ARBS_H_SERVICE_NAME
#define ARBS_H_SERVICE_NAME_W ARBS_H_NAMES_WIDEN(ARBS_H_SERVICE_NAME)

/// Folder under %ProgramData% used by the service log (was "Vibepollo").
#define ARBS_H_PROGRAMDATA_DIR_W L"ARBS-H"

/// HKLM key of the display helper (was SOFTWARE\Nonary\Vibepollo\DisplayHelper).
#define ARBS_H_DISPLAY_HELPER_KEY_W L"SOFTWARE\\ARBS-H\\DisplayHelper"

/// Scheduled task that restores display settings after reboot (was VibepolloDisplayRestore).
#define ARBS_H_DISPLAY_RESTORE_TASK_A "ARBS-H-DisplayRestore"
#define ARBS_H_DISPLAY_RESTORE_TASK_W L"ARBS-H-DisplayRestore"

/// Logon trigger id inside that task (was VibepolloDisplayHelperLogonTrigger).
#define ARBS_H_DISPLAY_RESTORE_TRIGGER_W L"ARBSHDisplayHelperLogonTrigger"

/// Display helper single-instance mutex (R1b-fix1 G4, was Global/Local SunshineDisplayHelper, shared with Vibepollo).
#define ARBS_H_DISPLAY_HELPER_MUTEX_GLOBAL_W L"Global\\ARBS-H-DisplayHelper"
#define ARBS_H_DISPLAY_HELPER_MUTEX_LOCAL_W L"Local\\ARBS-H-DisplayHelper"

/// Machine-wide display mutation mutex of helper and host (R1b-fix1 G4, was Global SunshineDisplayHelperMutationV1).
#define ARBS_H_DISPLAY_HELPER_MUTATION_MUTEX_W L"Global\\ARBS-H-DisplayHelperMutationV1"

/// Per-user state and helper logs: %APPDATA%\ARBS-H and %LOCALAPPDATA%\ARBS-H (H013 N5/N11-N14,
/// was the shared "Sunshine" / "Vibepollo" folders).
#define ARBS_H_USER_DIR_W L"ARBS-H"

/// Playnite connector log folder under %APPDATA%. Stays shared with Vibepollo until the connector
/// gets its own identity (H013 D1, deferred).
#define ARBS_H_PLAYNITE_CONNECTOR_LOG_DIR_W L"Sunshine"

/// Streaming-active events of the Vulkan HDR layer (H013 N1/N2, was SunshineVirtualHdrActive).
/// The layer DLL is not shipped by ARBS-H. If it ever is, it must be rebuilt with these names.
#define ARBS_H_VK_HDR_EVENT_GLOBAL_W L"Global\\ARBS-H-VirtualHdrActive"
#define ARBS_H_VK_HDR_EVENT_LOCAL_W L"Local\\ARBS-H-VirtualHdrActive"

/// Playnite launcher locks (H013 N3/N4, was Local\VibepolloPlaynite*).
#define ARBS_H_PLAYNITE_WATCHDOG_CACHE_MUTEX_W L"Local\\ARBS-H-PlayniteWatchdogCache-v1"
#define ARBS_H_PLAYNITE_CLEANUP_LEASE_PREFIX_W L"Local\\ARBS-H-PlayniteCleanupLease-v1-"

/// ETW session of present timing (H013 N6, was VibeshinePresentTiming and its fixed GUID).
#define ARBS_H_PRESENT_TIMING_SESSION_W L"ARBS-H-PresentTiming"
#define ARBS_H_PRESENT_TIMING_GUID_INIT {0x5A193136, 0xC5A4, 0x4F48, {0x9C, 0x0A, 0x2E, 0x96, 0x19, 0xA4, 0xB6, 0xDD}}

/// Windows CA bundle written to %TEMP% for libcurl (H013 N16, was sunshine-ca-bundle.pem).
#define ARBS_H_CA_BUNDLE_FILE_A "arbs-h-ca-bundle.pem"
