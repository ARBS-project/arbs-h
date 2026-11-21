// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * @file src/arbs_trigger_status.h
 * @brief ARBS-H H2: DualSense adaptive-trigger status bytes for the virtual input report.
 *
 * A real DualSense reports, per trigger, how the active adaptive-trigger program is
 * reacting (e.g. Weapon ready / firing / fired). The shared Sony encoder leaves these
 * bytes zero. When the host setting `arbs_trigger_status` is enabled, the USB/IP slot
 * fills them from the last trigger program the game sent and the trigger position the
 * client sent. With the setting disabled nothing here is called and the report is
 * byte-for-byte the encoder's output.
 *
 * PROVISIONAL decisions (docs/analysis/B3.md section 2, not yet judged by the planner):
 *   [D-H2-1] Only the status bytes 42 (right) and 43 (left) are written, counting the
 *            report ID 0x01 as byte 0 (= LVG ds5_input_report::reserved2[1] / [2]).
 *            Byte 48 (reserved2[7], "active effect" nibbles, one value source) stays 0.
 *   [D-H2-2] Byte value = (Status << 4) | StopLocation. A virtual device has no trigger
 *            motor arm, so StopLocation = zone of the current trigger position while a
 *            status-reporting program (Feedback 0x21, Weapon 0x25, Vibration 0x26) is
 *            active, otherwise the whole byte is 0.
 *   [D-H2-4] Every other mode (0x00, 0x05 Off, 0x01, 0x02, 0x06, 0x22 Bow, 0x23, 0x27,
 *            0xFC, unknown) and every invalid program -> 0x00 and the Weapon latch clears.
 *
 * ARBS-H B3b H2b (PROVISIONAL [D-B3b-H] / [D-B3b-5], docs/analysis/B3b.md section 4):
 *   Setting values: `disabled` (default, 0) / `enabled` (1, H2 = bytes 42/43 only, same
 *   bytes as b3) / `h2b` (2, H2 plus byte 48). Byte 48 (reserved2[7]) = active effect
 *   nibbles: right trigger low nibble, left trigger high nibble, 1 = Feedback, 2 = Weapon,
 *   3 = Vibration, 0 = reset / any other effect (S1 fandom revid 602 for position and
 *   values, S8 daidr for position only). A nibble is non-zero only for a program that is
 *   valid by the same rules as bytes 42/43. No other field is written (no source).
 *   H2b also writes a diagnostic line when the bytes change, at most 20 per binding.
 * Status values: Feedback 0 = no load / 1 = load applied, Weapon 0 = ready / 1 = firing /
 * 2 = fired (until the trigger returns before the start position), Vibration 0 / 1.
 * Program decoding mirrors ARBS Core trigger_effect.cpp (the host does not link Core).
 * Not thread-safe: the caller holds the owning slot's mutex.
 */
#pragma once

#include <algorithm>
#include <array>
#include <bit>
#include <cstddef>
#include <cstdint>
#include <cctype>
#include <cstdio>
#include <span>
#include <string>
#include <string_view>

namespace arbs::trigger_status {
  /// Input report byte offsets, report ID included (LVG ds5_input_report).
  inline constexpr std::size_t left_position_offset = 5;  ///< left_trigger
  inline constexpr std::size_t right_position_offset = 6;  ///< right_trigger
  inline constexpr std::size_t right_status_offset = 42;  ///< reserved2[1] [D-H2-1]
  inline constexpr std::size_t left_status_offset = 43;  ///< reserved2[2] [D-H2-1]
  inline constexpr std::size_t active_effect_offset = 48;  ///< reserved2[7] [D-B3b-H], h2b only

  inline constexpr std::uint8_t mode_off = 0x05;
  inline constexpr std::uint8_t mode_feedback = 0x21;
  inline constexpr std::uint8_t mode_weapon = 0x25;
  inline constexpr std::uint8_t mode_vibration = 0x26;

  inline constexpr std::uint8_t status_none = 0;  ///< no load / ready / not vibrating
  inline constexpr std::uint8_t status_active = 1;  ///< load applied / firing / vibrating
  inline constexpr std::uint8_t status_fired = 2;  ///< Weapon only

  /// Byte 48 nibble values (S1). 0 = reset / any other effect.
  inline constexpr std::uint8_t effect_feedback = 1;
  inline constexpr std::uint8_t effect_weapon = 2;
  inline constexpr std::uint8_t effect_vibration = 3;

  /// `arbs_trigger_status` values as stored in config::input.arbs_trigger_status.
  inline constexpr int setting_disabled = 0;  ///< default: encoder bytes unchanged
  inline constexpr int setting_enabled = 1;  ///< H2: bytes 42/43 (as b3)
  inline constexpr int setting_h2b = 2;  ///< H2b: bytes 42/43 + 48 [D-B3b-H]

  /// Parses the config value. `h2b` (any letter case) selects H2b; every other value keeps
  /// the b3 boolean meaning, passed in as `legacy_enabled` (config.cpp to_bool), so old
  /// files read exactly as before (`enabled` -> 1, `disabled` -> 0).
  inline int setting_from(std::string_view value, bool legacy_enabled) {
    std::string lowered(value);
    for (auto &ch : lowered) {
      ch = static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
    }
    if (lowered == "h2b") {
      return setting_h2b;
    }
    return legacy_enabled ? setting_enabled : setting_disabled;
  }

  /// Values other than 1 and 2 (including the -1 "never set" marker) mean disabled.
  constexpr int normalized_setting(int setting) {
    return setting == setting_enabled || setting == setting_h2b ? setting : setting_disabled;
  }

  /// Trigger position 0..255 -> zone 0..9 (same zones as the program's 10-bit mask).
  constexpr std::uint8_t zone_of(std::uint8_t position) {
    return static_cast<std::uint8_t>(std::min(9, position * 10 / 256));
  }

  /// First trigger position inside a zone (Core TriggerEffect::positionFor).
  constexpr int position_for(int zone) {
    return (zone * 256 + 9) / 10;
  }

  constexpr std::uint8_t encode(std::uint8_t status, std::uint8_t stop_location) {
    return static_cast<std::uint8_t>((status << 4) | (stop_location & 0x0F));
  }

  /// Byte 48 nibble for one trigger program [D-B3b-H]. Non-zero only for the status-reporting
  /// modes and with the same validity rules tracker_t::update uses for bytes 42/43
  /// (mask <= 10 bits and non-zero, Weapon exactly two zone bits, Vibration frequency != 0).
  constexpr std::uint8_t effect_of(std::uint8_t mode, std::span<const std::uint8_t, 10> parameters) {
    const unsigned mask = parameters[0] | (static_cast<unsigned>(parameters[1]) << 8);
    if (mask == 0 || (mask & ~0x3FFu)) {
      return 0;
    }
    switch (mode) {
      case mode_feedback:
        return effect_feedback;
      case mode_weapon:
        return std::popcount(mask) == 2 ? effect_weapon : 0;
      case mode_vibration:
        return parameters[8] ? effect_vibration : 0;
      default:
        return 0;
    }
  }

  /// Status of one trigger: the program last sent by the game plus the Weapon "fired" latch.
  class tracker_t {
  public:
    using parameters_t = std::span<const std::uint8_t, 10>;

    /// Forget the latch and the remembered program (new or rebound controller).
    void reset() {
      fired_ = false;
      have_program_ = false;
      mode_ = 0;
      parameters_ = {};
    }

    /// Status byte for this trigger. A changed program clears the Weapon latch.
    std::uint8_t update(std::uint8_t mode, parameters_t parameters, std::uint8_t position) {
      if (!have_program_ || mode != mode_ || !std::equal(parameters.begin(), parameters.end(), parameters_.begin())) {
        fired_ = false;
        have_program_ = true;
        mode_ = mode;
        std::copy(parameters.begin(), parameters.end(), parameters_.begin());
      }
      const unsigned mask = parameters[0] | (static_cast<unsigned>(parameters[1]) << 8);
      if (mask & ~0x3FFu) {
        fired_ = false;
        return 0;
      }
      const auto zone = zone_of(position);
      const auto in_zone = static_cast<std::uint8_t>((mask >> zone) & 1u);
      switch (mode) {
        case mode_weapon:
          {
            // Exactly two zone bits: start (lower) and end (upper).
            if (std::popcount(mask) != 2) {
              fired_ = false;
              return 0;
            }
            const int start = position_for(std::countr_zero(mask));
            const int end = position_for(std::bit_width(mask) - 1);
            std::uint8_t status;
            if (position < start) {
              fired_ = false;
              status = status_none;
            } else if (position >= end) {
              // Same break point as Core's rendered Weapon click (position >= end).
              fired_ = true;
              status = status_fired;
            } else {
              status = fired_ ? status_fired : status_active;
            }
            return encode(status, zone);
          }
        case mode_feedback:
          fired_ = false;
          return mask ? encode(in_zone ? status_active : status_none, zone) : 0;
        case mode_vibration:
          fired_ = false;
          // parameters[8] is the frequency (Core b[9]); 0 means Off.
          return mask && parameters[8] ? encode(in_zone ? status_active : status_none, zone) : 0;
        default:
          fired_ = false;  // [D-H2-4]
          return 0;
      }
    }

  private:
    bool fired_ = false;
    bool have_program_ = false;
    std::uint8_t mode_ = 0;
    std::array<std::uint8_t, 10> parameters_ {};
  };

  /// Both triggers of one controller.
  struct state_t {
    tracker_t right;
    tracker_t left;

    void reset() {
      right.reset();
      left.reset();
    }

    /// Writes bytes 42 (right) and 43 (left) of an encoded 64-byte input report, using the
    /// trigger positions already in that report (bytes 5 and 6). Byte 48 is touched only with
    /// `active_effect` (setting h2b): right effect in the low nibble, left in the high nibble.
    void apply(std::span<std::uint8_t> report, std::uint8_t right_mode, tracker_t::parameters_t right_parameters, std::uint8_t left_mode, tracker_t::parameters_t left_parameters, bool active_effect = false) {
      if (report.size() <= left_status_offset) {
        return;
      }
      report[right_status_offset] = right.update(right_mode, right_parameters, report[right_position_offset]);
      report[left_status_offset] = left.update(left_mode, left_parameters, report[left_position_offset]);
      if (active_effect && report.size() > active_effect_offset) {
        report[active_effect_offset] = static_cast<std::uint8_t>(effect_of(right_mode, right_parameters) |
                                                                 (effect_of(left_mode, left_parameters) << 4));
      }
    }
  };

  /// H2b diagnostic lines [D-B3b-5]: one line whenever bytes 42/43/48 change, at most
  /// `max_lines` per binding (reset() at a new slot or rebound). No addresses.
  class byte_log_t {
  public:
    static constexpr int max_lines = 20;

    void reset() {
      lines_ = 0;
      have_last_ = false;
    }

    /// True (and `line` set) when the bytes differ from the last logged ones and the budget
    /// for this binding is not used up.
    bool next(int pad, std::uint8_t right, std::uint8_t left, std::uint8_t effect, std::string &line) {
      if (have_last_ && right == right_ && left == left_ && effect == effect_) {
        return false;
      }
      if (lines_ >= max_lines) {
        return false;
      }
      have_last_ = true;
      right_ = right;
      left_ = left;
      effect_ = effect;
      ++lines_;
      char buffer[160];
      std::snprintf(buffer, sizeof(buffer), "ARBS-H 트리거 상태 바이트(패드 %d, %d/%d): R 0x%02X L 0x%02X 효과 0x%02X%s",
                    pad, lines_, max_lines, right, left, effect,
                    lines_ == max_lines ? " - 이 연결의 마지막 줄" : "");
      line = buffer;
      return true;
    }

  private:
    int lines_ = 0;
    bool have_last_ = false;
    std::uint8_t right_ = 0;
    std::uint8_t left_ = 0;
    std::uint8_t effect_ = 0;
  };
}  // namespace arbs::trigger_status
