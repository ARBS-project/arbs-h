// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * @file tests/unit/test_arbs_config_patch.cpp
 * @brief ARBS-H UI1b: PATCH /api/config stores the ARBS WebUI keys (merge step of patchConfig).
 *
 * docs/CC_TASK_UI1b.md section 3 / docs/analysis/UI1b.md section 1-4: patchConfig has no
 * allow-list, so `arbs_trigger_status`, `arbs_enet_precise_time` and `arbs_webui_default` are
 * written like every other key. These tests pin that on the code patchConfig runs
 * (src/arbs_config_patch.h) and read the written text back line by line.
 */
#include "src/arbs_config_patch.h"
#include "src/arbs_trigger_status.h"
#include "src/arbs_webui_route.h"

#include <gtest/gtest.h>
#include <nlohmann/json.hpp>
#include <set>
#include <sstream>
#include <string>
#include <unordered_map>

namespace {
  namespace cp = arbs::config_patch;

  // Minimal `key = value` reader for the serialized text (one entry per line).
  cp::config_map_t read_back(const std::string &text) {
    cp::config_map_t out;
    std::istringstream in {text};
    std::string line;
    while (std::getline(in, line)) {
      const auto eq = line.find(" = ");
      if (eq == std::string::npos) {
        continue;
      }
      out.emplace(line.substr(0, eq), line.substr(eq + 3));
    }
    return out;
  }

  cp::config_map_t existing() {
    return {
      {"gamepad", "usbip_ds5"},
      {"controller", "true"},
      {"port", "47989"},
    };
  }

  cp::config_map_t patched(cp::config_map_t current, const nlohmann::json &patch, std::set<std::string> *keys = nullptr) {
    std::set<std::string> changed;
    cp::merge(current, patch, changed);
    if (keys) {
      *keys = changed;
    }
    return read_back(cp::serialize(current));
  }
}  // namespace

TEST(ArbsConfigPatch, StoresTheThreeArbsWebUiKeys) {
  std::set<std::string> changed;
  const auto file = patched(existing(), nlohmann::json::parse(R"({
    "arbs_trigger_status": "enabled",
    "arbs_enet_precise_time": false,
    "arbs_webui_default": "classic"
  })"),
                            &changed);

  EXPECT_EQ(file.at("arbs_trigger_status"), "enabled");
  EXPECT_EQ(file.at("arbs_enet_precise_time"), "false");
  EXPECT_EQ(file.at("arbs_webui_default"), "classic");
  EXPECT_EQ(changed, (std::set<std::string> {"arbs_trigger_status", "arbs_enet_precise_time", "arbs_webui_default"}));

  // Untouched keys survive the merge.
  EXPECT_EQ(file.at("gamepad"), "usbip_ds5");
  EXPECT_EQ(file.at("controller"), "true");
  EXPECT_EQ(file.at("port"), "47989");
  EXPECT_EQ(file.size(), 6u);
}

TEST(ArbsConfigPatch, StoredValuesReadAsTheServerExpects) {
  for (const char *value : {"h2b", "enabled", "disabled"}) {
    const auto file = patched(existing(), nlohmann::json {{"arbs_trigger_status", value}});
    EXPECT_EQ(file.at("arbs_trigger_status"), value);
  }
  const auto h2b = patched(existing(), nlohmann::json {{"arbs_trigger_status", "h2b"}});
  EXPECT_EQ(arbs::trigger_status::setting_from(h2b.at("arbs_trigger_status"), false), arbs::trigger_status::setting_h2b);

  EXPECT_EQ(patched(existing(), nlohmann::json {{"arbs_enet_precise_time", true}}).at("arbs_enet_precise_time"), "true");

  for (const auto &[value, expected] : {
         std::pair {"arbs", arbs::webui_route::default_ui_e::arbs},
         std::pair {"classic", arbs::webui_route::default_ui_e::classic},
         std::pair {"v2", arbs::webui_route::default_ui_e::v2},
       }) {
    const auto file = patched(existing(), nlohmann::json {{"arbs_webui_default", value}});
    EXPECT_EQ(arbs::webui_route::setting_from(std::string_view {file.at("arbs_webui_default")}), expected) << value;
  }
}

TEST(ArbsConfigPatch, OverwritesAnExistingValue) {
  auto current = existing();
  current["arbs_webui_default"] = "v2";
  current["arbs_trigger_status"] = "disabled";
  const auto file = patched(current, nlohmann::json {{"arbs_webui_default", "arbs"}, {"arbs_trigger_status", "h2b"}});
  EXPECT_EQ(file.at("arbs_webui_default"), "arbs");
  EXPECT_EQ(file.at("arbs_trigger_status"), "h2b");
}

TEST(ArbsConfigPatch, NullOrEmptyRemovesTheLine) {
  auto current = existing();
  current["arbs_webui_default"] = "classic";
  current["arbs_enet_precise_time"] = "false";
  std::set<std::string> changed;
  const auto file = patched(current, nlohmann::json {{"arbs_webui_default", nullptr}, {"arbs_enet_precise_time", ""}}, &changed);
  EXPECT_FALSE(file.contains("arbs_webui_default"));  // -> server default arbs
  EXPECT_FALSE(file.contains("arbs_enet_precise_time"));
  EXPECT_EQ(changed.size(), 2u);
  EXPECT_EQ(file.size(), 3u);
}

TEST(ArbsConfigPatch, NoAllowListAndNoValueCheck) {
  // Same as before UI1b: unknown keys and unexpected values are stored; the screen restricts values.
  const auto file = patched(existing(), nlohmann::json {{"arbs_webui_default", "something"}, {"some_new_key", 3}});
  EXPECT_EQ(file.at("arbs_webui_default"), "something");
  EXPECT_EQ(file.at("some_new_key"), "3");
}

TEST(ArbsConfigPatch, SerializeWritesOneLinePerEntry) {
  const cp::config_map_t one {{"arbs_webui_default", "classic"}};
  EXPECT_EQ(cp::serialize(one), "arbs_webui_default = classic\n");
  EXPECT_EQ(cp::serialize({}), "");
}
