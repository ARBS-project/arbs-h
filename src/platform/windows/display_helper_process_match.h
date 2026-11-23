/**
 * @file src/platform/windows/display_helper_process_match.h
 * @brief ARBS-H R1b-fix1 G4: decides which running display helper belongs to this install.
 *
 * Vibepollo and Apollo ship a helper with the same file name, so a process name says nothing about its owner. A
 * helper is ours only when its full image path equals <folder of this program>\tools\sunshine_display_helper.exe.
 * Anything that cannot be proven ours (unreadable or unusual path) is left running.
 */
#pragma once

#ifdef _WIN32
  #ifndef NOMINMAX
    #define NOMINMAX
  #endif
  #ifndef WIN32_LEAN_AND_MEAN
    #define WIN32_LEAN_AND_MEAN
  #endif
  #include <winsock2.h>
  #include <windows.h>

  #include <algorithm>
  #include <filesystem>
  #include <optional>
  #include <string>
  #include <string_view>

namespace display_helper_process_match {
  inline constexpr std::size_t kMaxPathChars = 32768;

  /// Absolute drive path in one spelling (backslashes, no \\?\ prefix, no . or ..). Anything else, including a
  /// network path, is nullopt and therefore never matches: such a helper is left running.
  inline std::optional<std::wstring> normalize_image_path(std::wstring_view raw) {
    if (raw.empty() || raw.size() >= kMaxPathChars || raw.find(L'\0') != std::wstring_view::npos) {
      return std::nullopt;
    }
    std::wstring text(raw);
    std::replace(text.begin(), text.end(), L'/', L'\\');
    if (text.starts_with(L"\\\\?\\") && !text.starts_with(L"\\\\?\\UNC\\")) {
      text.erase(0, 4);
    }
    if (text.starts_with(L"\\\\") || text.starts_with(L"\\??\\")) {
      return std::nullopt;  // network, device or NT namespace: not a path this check can compare
    }
    const std::filesystem::path path(text);
    if (!path.is_absolute()) {
      return std::nullopt;
    }
    std::wstring normal = path.lexically_normal().wstring();
    if (normal.empty() || normal.back() == L'\\') {
      return std::nullopt;  // a folder, not a program file
    }
    return normal;
  }

  /// Same file path, ignoring case the way NTFS does. False when either side is not a usable path.
  inline bool same_image_path(std::wstring_view left, std::wstring_view right) {
    const auto a = normalize_image_path(left);
    const auto b = normalize_image_path(right);
    if (!a || !b) {
      return false;
    }
    return CompareStringOrdinal(a->c_str(), static_cast<int>(a->size()), b->c_str(), static_cast<int>(b->size()), TRUE) == CSTR_EQUAL;
  }

  /// <folder of the running program>\tools\sunshine_display_helper.exe
  inline std::optional<std::wstring> helper_path_for_module(std::wstring_view module_path) {
    const auto module = normalize_image_path(module_path);
    if (!module) {
      return std::nullopt;
    }
    return (std::filesystem::path(*module).parent_path() / L"tools" / L"sunshine_display_helper.exe").wstring();
  }

  /// The decision itself: never this process, never a process whose path could not be read.
  inline bool should_terminate(DWORD pid, DWORD self_pid, const std::optional<std::wstring> &image_path, std::wstring_view own_helper_path) {
    if (pid == self_pid || !image_path) {
      return false;
    }
    return same_image_path(*image_path, own_helper_path);
  }

  /// Needs PROCESS_QUERY_LIMITED_INFORMATION. nullopt when Windows does not give the path.
  inline std::optional<std::wstring> query_process_image_path(HANDLE process) {
    std::wstring buffer(1024, L'\0');
    while (true) {
      DWORD size = static_cast<DWORD>(buffer.size());
      if (QueryFullProcessImageNameW(process, 0, buffer.data(), &size)) {
        buffer.resize(size);
        return buffer;
      }
      if (GetLastError() != ERROR_INSUFFICIENT_BUFFER || buffer.size() >= kMaxPathChars) {
        return std::nullopt;
      }
      buffer.resize(std::min(buffer.size() * 2, kMaxPathChars));
    }
  }

  /// Helper path of this install, from the running program's own path.
  inline std::optional<std::wstring> current_helper_path() {
    std::wstring buffer(1024, L'\0');
    while (true) {
      const DWORD written = GetModuleFileNameW(nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
      if (written == 0) {
        return std::nullopt;
      }
      if (written < buffer.size()) {
        buffer.resize(written);
        return helper_path_for_module(buffer);
      }
      if (buffer.size() >= kMaxPathChars) {
        return std::nullopt;
      }
      buffer.resize(std::min(buffer.size() * 2, kMaxPathChars));
    }
  }
}  // namespace display_helper_process_match
#endif
