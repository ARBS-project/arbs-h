// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * @file tests/unit/test_arbs_webui_route.cpp
 * @brief ARBS-H UI1b: getWebUi shell choice and the `/` default-interface redirect.
 *
 * Table from docs/analysis/UI1b.md section 1-2 / 7-2. The rules are pure; the two callables
 * stand in for "read arbs_webui_default from sunshine.conf" and "arbs/index.html exists".
 */
#include "src/arbs_webui_route.h"

#include <gtest/gtest.h>
#include <optional>
#include <ostream>
#include <string>
#include <string_view>

namespace arbs::webui_route {
  // Readable failure output.
  void PrintTo(const decision_t &decision, std::ostream *os) {
    const char *action = decision.action == action_e::serve ? "serve" : decision.action == action_e::redirect ? "redirect" : "not_found";
    *os << action << '(' << decision.target << ')';
  }
}  // namespace arbs::webui_route

namespace {
  namespace wr = arbs::webui_route;
  using wr::action_e;
  using wr::decision_t;

  const decision_t classic {action_e::serve, wr::classic_shell};
  const decision_t v2 {action_e::serve, wr::v2_shell};
  const decision_t arbs_shell {action_e::serve, wr::arbs_shell};
  const decision_t to_arbs {action_e::redirect, wr::arbs_location};
  const decision_t to_v2 {action_e::redirect, wr::v2_location};
  const decision_t missing {action_e::not_found, {}};

  struct probe_t {
    std::optional<std::string> setting;  ///< std::nullopt = no line in the config file
    bool shell_exists = true;
    int setting_reads = 0;
    int shell_checks = 0;

    decision_t run(std::string_view path, std::optional<std::string_view> ui = std::nullopt) {
      return wr::decide(
        path,
        ui,
        [this]() {
          ++setting_reads;
          return setting;
        },
        [this]() {
          ++shell_checks;
          return shell_exists;
        }
      );
    }
  };

  decision_t root_with(std::optional<std::string> setting, std::optional<std::string_view> ui = std::nullopt, bool shell_exists = true) {
    probe_t probe {std::move(setting), shell_exists};
    return probe.run("/", ui);
  }
}  // namespace

TEST(ArbsWebUiRoute, RootFollowsTheThreeSettingValues) {
  EXPECT_EQ(root_with("arbs"), to_arbs);
  EXPECT_EQ(root_with("classic"), classic);
  EXPECT_EQ(root_with("v2"), to_v2);
}

TEST(ArbsWebUiRoute, RootDefaultsToArbsWithoutTheSetting) {
  EXPECT_EQ(root_with(std::nullopt), to_arbs);
  EXPECT_EQ(root_with(""), to_arbs);
  EXPECT_EQ(root_with("   "), to_arbs);
}

TEST(ArbsWebUiRoute, RootTreatsUnknownValuesAsArbs) {
  EXPECT_EQ(root_with("legacy"), to_arbs);
  EXPECT_EQ(root_with("v1"), to_arbs);
  EXPECT_EQ(root_with("\"classic\""), to_arbs);  // JSON-quoted text is not the classic value
  EXPECT_EQ(root_with("classicx"), to_arbs);
  EXPECT_EQ(root_with("true"), to_arbs);
}

TEST(ArbsWebUiRoute, SettingIgnoresLetterCaseAndBlanks) {
  EXPECT_EQ(root_with("CLASSIC"), classic);
  EXPECT_EQ(root_with(" Classic "), classic);
  EXPECT_EQ(root_with("V2"), to_v2);
  EXPECT_EQ(root_with("ARBS"), to_arbs);
}

TEST(ArbsWebUiRoute, ClassicQueryAlwaysServesTheClassicShell) {
  for (const char *setting : {"arbs", "classic", "v2"}) {
    probe_t probe {std::string {setting}};
    EXPECT_EQ(probe.run("/", "classic"), classic) << setting;
    EXPECT_EQ(probe.setting_reads, 0) << setting;  // query wins before the file is read
  }
  EXPECT_EQ(root_with(std::nullopt, "classic"), classic);
  EXPECT_EQ(root_with(std::nullopt, "Classic"), classic);
}

TEST(ArbsWebUiRoute, OtherQueryValuesFollowTheSetting) {
  EXPECT_EQ(root_with("arbs", "v2"), to_arbs);
  EXPECT_EQ(root_with("arbs", ""), to_arbs);
  EXPECT_EQ(root_with("v2", "arbs"), to_v2);
  EXPECT_EQ(root_with("classic", "arbs"), classic);
}

TEST(ArbsWebUiRoute, MissingArbsShellFallsBackToClassic) {
  probe_t probe {std::string {"arbs"}, false};
  EXPECT_EQ(probe.run("/"), classic);
  EXPECT_EQ(probe.shell_checks, 1);
  EXPECT_EQ(root_with(std::nullopt, std::nullopt, false), classic);
  // classic/v2 settings do not depend on the ARBS shell.
  probe_t v2_probe {std::string {"v2"}, false};
  EXPECT_EQ(v2_probe.run("/"), to_v2);
  EXPECT_EQ(v2_probe.shell_checks, 0);
}

TEST(ArbsWebUiRoute, ArbsRoutesServeTheArbsShell) {
  probe_t probe {std::string {"classic"}};
  EXPECT_EQ(probe.run("/arbs"), arbs_shell);
  EXPECT_EQ(probe.run("/arbs/"), arbs_shell);
  EXPECT_EQ(probe.run("/arbs/devices"), arbs_shell);
  EXPECT_EQ(probe.run("/arbs/devices/0123-abcd"), arbs_shell);
  EXPECT_EQ(probe.run("/arbs/apps/new"), arbs_shell);
  EXPECT_EQ(probe.setting_reads, 0);
  EXPECT_EQ(probe.shell_checks, 0);
}

TEST(ArbsWebUiRoute, ArbsStaticPathsAndFilesAre404) {
  probe_t probe;
  EXPECT_EQ(probe.run("/arbs/assets"), missing);
  EXPECT_EQ(probe.run("/arbs/assets/index-abc.js"), missing);
  EXPECT_EQ(probe.run("/arbs/images"), missing);
  EXPECT_EQ(probe.run("/arbs/images/logo.png"), missing);
  EXPECT_EQ(probe.run("/arbs/index.html"), missing);
  EXPECT_EQ(probe.run("/arbs/manifest.webmanifest"), missing);
}

TEST(ArbsWebUiRoute, ArbsPrefixNeedsAPathBoundary) {
  probe_t probe;
  EXPECT_EQ(probe.run("/arbsx"), classic);
  EXPECT_EQ(probe.run("/arbs-settings"), classic);
  EXPECT_EQ(probe.run("/arbs/assetsx"), arbs_shell);  // not the static folder
}

TEST(ArbsWebUiRoute, V2RoutesAreUnchanged) {
  probe_t probe {std::string {"arbs"}};
  EXPECT_EQ(probe.run("/v2"), v2);
  EXPECT_EQ(probe.run("/v2/"), v2);
  EXPECT_EQ(probe.run("/v2/settings"), v2);
  EXPECT_EQ(probe.run("/v2/assets"), missing);
  EXPECT_EQ(probe.run("/v2/assets/app.js"), missing);
  EXPECT_EQ(probe.run("/v2/images/x.png"), missing);
  EXPECT_EQ(probe.run("/v2/index.html"), missing);
  EXPECT_EQ(probe.setting_reads, 0);
}

TEST(ArbsWebUiRoute, ClassicSpaRoutesAreUnchanged) {
  probe_t probe {std::string {"arbs"}};
  EXPECT_EQ(probe.run("/applications"), classic);
  EXPECT_EQ(probe.run("/settings"), classic);
  EXPECT_EQ(probe.run("/troubleshooting"), classic);
  EXPECT_EQ(probe.run("/v2x"), classic);
  EXPECT_EQ(probe.setting_reads, 0);  // only `/` reads the setting
  EXPECT_EQ(probe.shell_checks, 0);
}

TEST(ArbsWebUiRoute, ReservedPrefixesAndFilesAre404) {
  probe_t probe;
  EXPECT_EQ(probe.run("/api"), missing);
  EXPECT_EQ(probe.run("/api/config"), missing);
  EXPECT_EQ(probe.run("/assets/x.js"), missing);
  EXPECT_EQ(probe.run("/covers/1.png"), missing);
  EXPECT_EQ(probe.run("/images/logo.png"), missing);
  EXPECT_EQ(probe.run("/index.html"), missing);
  EXPECT_EQ(probe.run("/favicon.ico"), missing);
  EXPECT_EQ(probe.setting_reads, 0);
}

TEST(ArbsWebUiRoute, SettingParserNamesTheKey) {
  EXPECT_EQ(wr::setting_key, "arbs_webui_default");
  EXPECT_EQ(wr::setting_default, wr::default_ui_e::arbs);
  EXPECT_EQ(wr::setting_from(std::nullopt), wr::default_ui_e::arbs);
  EXPECT_EQ(wr::setting_from(std::string_view {"classic"}), wr::default_ui_e::classic);
  EXPECT_EQ(wr::setting_from(std::string_view {"v2"}), wr::default_ui_e::v2);
  EXPECT_EQ(wr::setting_from(std::string_view {"arbs"}), wr::default_ui_e::arbs);
}
