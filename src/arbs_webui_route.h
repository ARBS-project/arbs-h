// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * @file src/arbs_webui_route.h
 * @brief ARBS-H UI1b: which browser shell answers a page request (classic v1, v2 or ARBS WebUI).
 *
 * Pure rules, no I/O: getWebUi (confighttp.cpp) supplies the request path, the `ui` query value,
 * and two callables that read the `arbs_webui_default` setting and check that the ARBS WebUI shell
 * (`arbs/index.html`) exists. The callables run only for the root page `/`.
 *
 * Root page `/` (docs/analysis/UI1b.md section 1-2):
 *   - query `ui=classic`                   -> classic shell (`index.html`)
 *   - setting `classic`                    -> classic shell
 *   - setting `v2`                         -> 302 to `/v2/`
 *   - setting `arbs`, missing, empty, any
 *     other value                          -> 302 to `/arbs/`; classic shell when `arbs/index.html`
 *                                             is missing (partial install must not end at a 404)
 * Setting and query values are compared ignoring ASCII letter case and surrounding blanks.
 * `/arbs`, `/arbs/...` -> `arbs/index.html`; `/arbs/assets/...`, `/arbs/images/...` are static files
 * served by getWebAsset, so reaching getWebUi means the file is missing -> 404 (same as v2).
 * Every other path keeps the pre-UI1b behaviour.
 */
#pragma once

#include <array>
#include <cctype>
#include <filesystem>
#include <optional>
#include <string>
#include <string_view>

namespace arbs::webui_route {
  /// Config key (sunshine.conf) holding the default browser interface. Web-UI-only: config.cpp
  /// consumes it without a struct member; getWebUi reads the config file on each `/` request.
  inline constexpr std::string_view setting_key = "arbs_webui_default";

  enum class default_ui_e {
    arbs,  ///< ARBS WebUI at /arbs/ (default)
    classic,  ///< original Vibepollo interface at /
    v2,  ///< Vibepollo v2 interface at /v2/
  };

  /// Value used when the config has no line, an empty one or an unknown value.
  inline constexpr default_ui_e setting_default = default_ui_e::arbs;

  inline constexpr std::string_view classic_shell = "index.html";
  inline constexpr std::string_view v2_shell = "v2/index.html";
  inline constexpr std::string_view arbs_shell = "arbs/index.html";
  inline constexpr std::string_view arbs_location = "/arbs/";
  inline constexpr std::string_view v2_location = "/v2/";

  /// Lower-case ASCII copy without leading/trailing blanks.
  inline std::string normalized(std::string_view value) {
    constexpr std::string_view blanks = " \t\r\n";
    const auto first = value.find_first_not_of(blanks);
    if (first == std::string_view::npos) {
      return {};
    }
    const auto last = value.find_last_not_of(blanks);
    std::string out {value.substr(first, last - first + 1)};
    for (auto &ch : out) {
      ch = static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
    }
    return out;
  }

  /// Parses `arbs_webui_default`. std::nullopt = the config has no such line.
  inline default_ui_e setting_from(const std::optional<std::string_view> &value) {
    if (!value) {
      return setting_default;
    }
    const auto lowered = normalized(*value);
    if (lowered == "classic") {
      return default_ui_e::classic;
    }
    if (lowered == "v2") {
      return default_ui_e::v2;
    }
    return setting_default;  // "arbs", empty, unknown
  }

  /// True when the `ui` query value asks for the classic interface.
  inline bool query_wants_classic(const std::optional<std::string_view> &ui_query) {
    return ui_query && normalized(*ui_query) == "classic";
  }

  enum class action_e {
    not_found,  ///< 404
    serve,  ///< serve `target` (path relative to WEB_DIR)
    redirect,  ///< 302 Found, Location = `target`
  };

  struct decision_t {
    action_e action;
    std::string_view target;  ///< static string: shell file or redirect location; empty for 404

    friend bool operator==(const decision_t &, const decision_t &) = default;
  };

  inline bool is_under(std::string_view path, std::string_view prefix) {
    return path == prefix || (path.starts_with(prefix) && path.size() > prefix.size() && path[prefix.size()] == '/');
  }

  /**
   * @brief Decide the response for a GET that no static or API route matched.
   * @param path Request path without the query string.
   * @param ui_query Value of the `ui` query parameter, std::nullopt when absent.
   * @param read_setting Callable returning std::optional<std::string> (the raw
   *        `arbs_webui_default` value, std::nullopt when the line is missing). Called only for `/`.
   * @param arbs_shell_exists Callable returning bool (`arbs/index.html` is a regular file).
   *        Called only for `/` when the setting selects the ARBS WebUI.
   */
  template<typename ReadSetting, typename ShellExists>
  decision_t decide(std::string_view path, const std::optional<std::string_view> &ui_query, ReadSetting &&read_setting, ShellExists &&arbs_shell_exists) {
    static constexpr std::array reserved_prefixes {std::string_view {"/api"}, std::string_view {"/assets"}, std::string_view {"/covers"}, std::string_view {"/images"}};
    for (const auto prefix : reserved_prefixes) {
      if (path.starts_with(prefix)) {
        return {action_e::not_found, {}};
      }
    }

    if (is_under(path, "/v2/assets") || is_under(path, "/v2/images") ||
        is_under(path, "/arbs/assets") || is_under(path, "/arbs/images")) {
      return {action_e::not_found, {}};
    }

    // Missing files stay 404s. Extension-free paths are client-side navigation routes.
    if (std::filesystem::path {std::string {path}}.has_extension()) {
      return {action_e::not_found, {}};
    }

    if (path == "/") {
      if (query_wants_classic(ui_query)) {
        return {action_e::serve, classic_shell};
      }
      const std::optional<std::string> raw = read_setting();
      std::optional<std::string_view> raw_view;
      if (raw) {
        raw_view = std::string_view {*raw};
      }
      switch (setting_from(raw_view)) {
        case default_ui_e::classic:
          return {action_e::serve, classic_shell};
        case default_ui_e::v2:
          return {action_e::redirect, v2_location};
        case default_ui_e::arbs:
          break;
      }
      if (!arbs_shell_exists()) {
        return {action_e::serve, classic_shell};
      }
      return {action_e::redirect, arbs_location};
    }

    if (is_under(path, "/arbs")) {
      return {action_e::serve, arbs_shell};
    }
    if (is_under(path, "/v2")) {
      return {action_e::serve, v2_shell};
    }
    return {action_e::serve, classic_shell};
  }
}  // namespace arbs::webui_route
