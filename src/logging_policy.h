/**
 * @file src/logging_policy.h
 * @brief Deterministic policy for rendering logging records.
 */
#pragma once

#include <ostream>
#include <string>
#include <string_view>
#include <system_error>

namespace logging::policy {
  enum class level: int {
    verbose = 0,
    debug = 1,
    info = 2,
    warning = 3,
    error = 4,
    fatal = 5,
    tests = 10,
  };

  struct record_t {
    int severity = static_cast<int>(level::error);
    std::string_view message = "<missing log message>";
  };

  std::string_view severity_prefix(int severity) noexcept;
  std::string format_line(std::string_view timestamp, const record_t &record);

  /**
   * @brief ARBS-H R1b (D-R1b-11): decide log rotation from the outcome of `exists(path, ec)`.
   * A failed check skips rotation and prints one line instead of ending startup.
   * @return True only when the file is known to exist.
   */
  bool should_rotate_log(bool exists, const std::error_code &ec, std::ostream &diagnostics);
}  // namespace logging::policy
