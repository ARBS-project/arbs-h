// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * @file src/arbs_config_patch.h
 * @brief ARBS-H UI1b: the merge step of PATCH /api/config, moved out of confighttp.cpp unchanged
 *        so a unit test can show which keys are written (docs/analysis/UI1b.md section 1-4).
 *
 * There is no allow-list: every key of the JSON object is merged into the parsed config file.
 * A null or empty-string value removes the key, a string is stored raw, anything else is stored
 * as its JSON text (true/false/numbers). The caller writes the serialized text back to the file.
 * Values are not validated here; the server interprets them on the next config apply.
 */
#pragma once

#include <nlohmann/json.hpp>
#include <set>
#include <sstream>
#include <string>
#include <unordered_map>

namespace arbs::config_patch {
  using config_map_t = std::unordered_map<std::string, std::string>;

  /// Merges `patch` (a JSON object) into `current` and records every patched key in `changed_keys`.
  inline void merge(config_map_t &current, const nlohmann::json &patch, std::set<std::string> &changed_keys) {
    for (auto it = patch.begin(); it != patch.end(); ++it) {
      const std::string key = it.key();
      const nlohmann::json &val = it.value();
      changed_keys.insert(key);

      // Remove key when explicitly null or empty string
      if (val.is_null() || (val.is_string() && val.get<std::string>().empty())) {
        auto curIt = current.find(key);
        if (curIt != current.end()) {
          current.erase(curIt);
        }
        continue;
      }

      // Persist value: strings are raw, non-strings are dumped as JSON
      if (val.is_string()) {
        current[key] = val.get<std::string>();
      } else {
        current[key] = val.dump();
      }
    }
  }

  /// Text written back to the config file: one `key = value` line per entry, map order.
  inline std::string serialize(const config_map_t &current) {
    std::stringstream config_stream;
    for (const auto &kv : current) {
      config_stream << kv.first << " = " << kv.second << std::endl;
    }
    return config_stream.str();
  }
}  // namespace arbs::config_patch
