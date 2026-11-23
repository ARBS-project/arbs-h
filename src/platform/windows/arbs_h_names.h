/**
 * @file src/platform/windows/arbs_h_names.h
 * @brief ARBS-H R1a (D-R1a-2/3): machine-wide names that must never collide with Vibepollo.
 *
 * ARBS-H can be installed next to an official Vibepollo. Every Windows-global identity (service,
 * ProgramData folder, HKLM key, scheduled task) is therefore its own. The service name comes from
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
