// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * @file tests/unit/test_arbs_trigger_status.cpp
 * @brief ARBS-H H2 adaptive-trigger status bytes (pure rules + the real Sony input encoder).
 *
 * Expected values follow docs/analysis/B3.md section 2-3 (T1..T11). The rules are
 * provisional decisions [D-H2-1/2/4]; these tests pin them, they do not prove a game reads them.
 */
#include "src/arbs_trigger_status.h"
#include "third-party/libvirtualgamepad/driver/src/dualsense.h"

#include <array>
#include <cstddef>
#include <cstdint>
#include <gtest/gtest.h>
#include <span>
#include <string>
#include <vector>

namespace {
  namespace ts = arbs::trigger_status;
  using params_t = std::array<std::uint8_t, 10>;

  // Weapon, start zone 2 / end zone 3 (positions 52 / 77), strength byte 7.
  constexpr params_t weapon_2_3 {0x0C, 0x00, 0x07};
  // Feedback / Vibration over zones 3..9.
  constexpr params_t zones_3_9 {0xF8, 0x03};
  constexpr params_t none {};

  std::uint8_t once(std::uint8_t mode, const params_t &params, std::uint8_t position) {
    ts::tracker_t tracker;
    return tracker.update(mode, params, position);
  }

  std::vector<std::uint8_t> sequence(ts::tracker_t &tracker, std::uint8_t mode, const params_t &params, std::initializer_list<std::uint8_t> positions) {
    std::vector<std::uint8_t> out;
    for (const auto position : positions) {
      out.push_back(tracker.update(mode, params, position));
    }
    return out;
  }

  lvg::driver::ds5_input_report encoded(std::uint8_t left_trigger, std::uint8_t right_trigger) {
    lvg::input_state_request input {};
    input.header.size = sizeof(input);
    input.header.version = lvg::k_protocol_version;
    input.left_trigger = left_trigger;
    input.right_trigger = right_trigger;
    lvg::driver::ds5_state state {};
    state.reset();
    return lvg::driver::encode_ds5_input(input, &state);
  }

  std::span<std::uint8_t> bytes(lvg::driver::ds5_input_report &report) {
    return {reinterpret_cast<std::uint8_t *>(&report), sizeof(report)};
  }
}  // namespace

// [D-H2-1] byte positions, report ID included.
static_assert(offsetof(lvg::driver::ds5_input_report, reserved2) == 41);
static_assert(offsetof(lvg::driver::ds5_input_report, left_trigger) == ts::left_position_offset);
static_assert(offsetof(lvg::driver::ds5_input_report, right_trigger) == ts::right_position_offset);
static_assert(ts::right_status_offset == 42 && ts::left_status_offset == 43);

TEST(ArbsTriggerStatus, ZoneAndPositionRoundTrip) {
  for (int zone = 0; zone <= 9; ++zone) {
    EXPECT_EQ(ts::zone_of(static_cast<std::uint8_t>(ts::position_for(zone))), zone) << zone;
    if (zone > 0) {
      EXPECT_EQ(ts::zone_of(static_cast<std::uint8_t>(ts::position_for(zone) - 1)), zone - 1) << zone;
    }
  }
  EXPECT_EQ(ts::position_for(2), 52);
  EXPECT_EQ(ts::position_for(3), 77);
  EXPECT_EQ(ts::zone_of(255), 9);
}

TEST(ArbsTriggerStatus, T1_WeaponAtRest) {
  EXPECT_EQ(once(ts::mode_weapon, weapon_2_3, 0), 0x00);
}

TEST(ArbsTriggerStatus, T2_WeaponAtEndIsFired) {
  EXPECT_EQ(once(ts::mode_weapon, weapon_2_3, 77), 0x23);
}

TEST(ArbsTriggerStatus, T3_WeaponFullPullIsFired) {
  EXPECT_EQ(once(ts::mode_weapon, weapon_2_3, 255), 0x29);
}

TEST(ArbsTriggerStatus, T4_WeaponBeforeStartAndFiringWithoutLatch) {
  ts::tracker_t tracker;
  EXPECT_EQ(sequence(tracker, ts::mode_weapon, weapon_2_3, {51, 52, 76}), (std::vector<std::uint8_t> {0x01, 0x12, 0x12}));
}

TEST(ArbsTriggerStatus, T5_WeaponFiredLatchHoldsUntilBeforeStart) {
  ts::tracker_t tracker;
  EXPECT_EQ(sequence(tracker, ts::mode_weapon, weapon_2_3, {0, 255, 60, 51, 60}), (std::vector<std::uint8_t> {0x00, 0x29, 0x22, 0x01, 0x12}));
}

TEST(ArbsTriggerStatus, T6_ReleasedEffectIsZeroAndClearsLatch) {
  ts::tracker_t tracker;
  EXPECT_EQ(tracker.update(ts::mode_weapon, weapon_2_3, 255), 0x29);
  EXPECT_EQ(tracker.update(ts::mode_off, none, 255), 0x00);
  EXPECT_EQ(tracker.update(0x00, none, 255), 0x00);
  // The same Weapon program again starts without the latch.
  EXPECT_EQ(tracker.update(ts::mode_weapon, weapon_2_3, 60), 0x12);
}

TEST(ArbsTriggerStatus, T7_FeedbackLoadAppliedInsideZones) {
  ts::tracker_t tracker;
  EXPECT_EQ(sequence(tracker, ts::mode_feedback, zones_3_9, {76, 77, 255}), (std::vector<std::uint8_t> {0x02, 0x13, 0x19}));
  EXPECT_EQ(once(ts::mode_feedback, none, 255), 0x00);  // empty zone mask = Off
}

TEST(ArbsTriggerStatus, T8_VibrationNeedsFrequency) {
  auto silent = zones_3_9;
  silent[8] = 0;
  auto vibrating = zones_3_9;
  vibrating[8] = 30;
  EXPECT_EQ(once(ts::mode_vibration, silent, 255), 0x00);
  EXPECT_EQ(once(ts::mode_vibration, vibrating, 255), 0x19);
  EXPECT_EQ(once(ts::mode_vibration, vibrating, 76), 0x02);
}

TEST(ArbsTriggerStatus, T9_OtherModesAndInvalidProgramsAreZero) {
  constexpr params_t bow_2_3 {0x0C, 0x00, 0x07};
  constexpr params_t three_bits {0x1C, 0x00, 0x07};
  constexpr params_t bit_10 {0x00, 0x04};
  EXPECT_EQ(once(0x22, bow_2_3, 255), 0x00);  // Bow
  EXPECT_EQ(once(0x7F, weapon_2_3, 255), 0x00);  // unknown
  for (const std::uint8_t mode : std::initializer_list<std::uint8_t> {0x01, 0x02, 0x06, 0x23, 0x27, 0xFC}) {
    EXPECT_EQ(once(mode, weapon_2_3, 255), 0x00) << int(mode);
  }
  EXPECT_EQ(once(ts::mode_weapon, three_bits, 255), 0x00);
  EXPECT_EQ(once(ts::mode_weapon, bit_10, 255), 0x00);
  EXPECT_EQ(once(ts::mode_feedback, bit_10, 255), 0x00);
  EXPECT_EQ(once(ts::mode_vibration, bit_10, 255), 0x00);
  // An invalid program in between clears the latch.
  ts::tracker_t tracker;
  EXPECT_EQ(tracker.update(ts::mode_weapon, weapon_2_3, 255), 0x29);
  EXPECT_EQ(tracker.update(ts::mode_weapon, three_bits, 255), 0x00);
  EXPECT_EQ(tracker.update(ts::mode_weapon, weapon_2_3, 60), 0x12);
}

TEST(ArbsTriggerStatus, ChangedProgramOrResetClearsLatch) {
  constexpr params_t weapon_2_4 {0x14, 0x00, 0x07};  // start 52, end 103
  ts::tracker_t tracker;
  EXPECT_EQ(tracker.update(ts::mode_weapon, weapon_2_3, 255), 0x29);
  EXPECT_EQ(tracker.update(ts::mode_weapon, weapon_2_4, 60), 0x12);
  EXPECT_EQ(tracker.update(ts::mode_weapon, weapon_2_4, 255), 0x29);
  EXPECT_EQ(tracker.update(ts::mode_weapon, weapon_2_4, 60), 0x22);
  tracker.reset();
  EXPECT_EQ(tracker.update(ts::mode_weapon, weapon_2_4, 60), 0x12);
}

TEST(ArbsTriggerStatus, T10_ReportBytesRightAndLeft) {
  {
    auto report = encoded(0, 255);
    ts::state_t state;
    state.apply(bytes(report), ts::mode_weapon, weapon_2_3, ts::mode_off, none);
    const auto b = bytes(report);
    EXPECT_EQ(b[42], 0x29);
    EXPECT_EQ(b[43], 0x00);
  }
  {
    auto report = encoded(255, 0);
    ts::state_t state;
    state.apply(bytes(report), ts::mode_off, none, ts::mode_weapon, weapon_2_3);
    const auto b = bytes(report);
    EXPECT_EQ(b[42], 0x00);
    EXPECT_EQ(b[43], 0x29);
  }
  {
    // Only 42/43 change: every other byte, including 41 and 48 [D-H2-1], is the encoder's.
    auto report = encoded(255, 255);
    const auto before = report;
    ts::state_t state;
    state.apply(bytes(report), ts::mode_weapon, weapon_2_3, ts::mode_weapon, weapon_2_3);
    const auto after = bytes(report);
    const auto *original = reinterpret_cast<const std::uint8_t *>(&before);
    for (std::size_t i = 0; i < sizeof(report); ++i) {
      if (i == 42 || i == 43) {
        EXPECT_EQ(after[i], 0x29) << i;
      } else {
        EXPECT_EQ(after[i], original[i]) << i;
      }
    }
    EXPECT_EQ(after[48], 0x00);
  }
  {
    std::array<std::uint8_t, 43> short_report {};  // too short: untouched
    ts::state_t state;
    short_report[6] = 255;
    state.apply(short_report, ts::mode_weapon, weapon_2_3, ts::mode_weapon, weapon_2_3);
    EXPECT_EQ(short_report[42], 0x00);
  }
}

TEST(ArbsTriggerStatus, T11_SettingOffLeavesEncoderBytesZero) {
  // With arbs_trigger_status off the slot does not call apply(): the encoder's bytes go out.
  for (const std::uint8_t position : {std::uint8_t {0}, std::uint8_t {77}, std::uint8_t {255}}) {
    auto report = encoded(position, position);
    const auto b = bytes(report);
    for (std::size_t i = 41; i <= 52; ++i) {
      EXPECT_EQ(b[i], 0x00) << "byte " << i << " position " << int(position);
    }
  }
}

// ---- ARBS-H B3b H2b (provisional [D-B3b-H] / [D-B3b-5], docs/analysis/B3b.md section 4) ----

static_assert(offsetof(lvg::driver::ds5_input_report, reserved2) + 7 == ts::active_effect_offset);
static_assert(ts::active_effect_offset == 48);

TEST(ArbsTriggerStatus, H2b_EffectNibbleForValidStatusPrograms) {
  constexpr params_t vibration_3_9 {0xF8, 0x03, 0, 0, 0, 0, 0, 0, 30};
  EXPECT_EQ(ts::effect_of(ts::mode_feedback, zones_3_9), ts::effect_feedback);
  EXPECT_EQ(ts::effect_of(ts::mode_weapon, weapon_2_3), ts::effect_weapon);
  EXPECT_EQ(ts::effect_of(ts::mode_vibration, vibration_3_9), ts::effect_vibration);
  EXPECT_EQ(ts::effect_feedback, 1);
  EXPECT_EQ(ts::effect_weapon, 2);
  EXPECT_EQ(ts::effect_vibration, 3);
}

TEST(ArbsTriggerStatus, H2b_EffectNibbleZeroWhereStatusBytesAreZero) {
  constexpr params_t weapon_three_bits {0x0E, 0x00, 0x07};
  constexpr params_t too_wide {0x00, 0x04};  // mask 0x0400 > 10 bits
  constexpr params_t vibration_no_frequency {0xF8, 0x03};
  EXPECT_EQ(ts::effect_of(ts::mode_weapon, weapon_three_bits), 0);
  EXPECT_EQ(ts::effect_of(ts::mode_weapon, too_wide), 0);
  EXPECT_EQ(ts::effect_of(ts::mode_feedback, none), 0);  // mask 0
  EXPECT_EQ(ts::effect_of(ts::mode_feedback, too_wide), 0);
  EXPECT_EQ(ts::effect_of(ts::mode_vibration, vibration_no_frequency), 0);
  for (const std::uint8_t mode : {std::uint8_t {0x00}, std::uint8_t {0x01}, std::uint8_t {0x02}, std::uint8_t {ts::mode_off}, std::uint8_t {0x06}, std::uint8_t {0x22}, std::uint8_t {0x23}, std::uint8_t {0x27}, std::uint8_t {0xFC}, std::uint8_t {0x7F}}) {
    EXPECT_EQ(ts::effect_of(mode, zones_3_9), 0) << int(mode);
  }
}

TEST(ArbsTriggerStatus, H2b_ReportByte48RightLowLeftHigh) {
  constexpr params_t vibration_3_9 {0xF8, 0x03, 0, 0, 0, 0, 0, 0, 30};
  {
    // Right Weapon, left Feedback: 48 = 0x12; 42/43 equal the H2 (enabled) result.
    auto h2 = encoded(77, 255);
    auto h2b = h2;
    const auto original = h2;
    ts::state_t h2_state;
    ts::state_t h2b_state;
    h2_state.apply(bytes(h2), ts::mode_weapon, weapon_2_3, ts::mode_feedback, zones_3_9);
    h2b_state.apply(bytes(h2b), ts::mode_weapon, weapon_2_3, ts::mode_feedback, zones_3_9, true);
    const auto a = bytes(h2);
    const auto b = bytes(h2b);
    const auto *o = reinterpret_cast<const std::uint8_t *>(&original);
    EXPECT_EQ(b[48], 0x12);
    EXPECT_EQ(a[48], 0x00);  // enabled: byte 48 untouched, as b3
    for (std::size_t i = 0; i < sizeof(h2); ++i) {
      if (i == 48) {
        continue;
      }
      EXPECT_EQ(b[i], a[i]) << i;
      if (i != 42 && i != 43) {
        EXPECT_EQ(b[i], o[i]) << i;
      }
    }
    EXPECT_EQ(b[42], 0x29);
    EXPECT_EQ(b[43], 0x13);  // left Feedback, position 77 = zone 3 inside zones 3..9
  }
  {
    // Right Off, left Vibration: 48 = 0x30. Right Vibration, left Weapon: 0x23.
    auto report = encoded(0, 0);
    ts::state_t state;
    state.apply(bytes(report), ts::mode_off, none, ts::mode_vibration, vibration_3_9, true);
    EXPECT_EQ(bytes(report)[48], 0x30);
    state.apply(bytes(report), ts::mode_vibration, vibration_3_9, ts::mode_weapon, weapon_2_3, true);
    EXPECT_EQ(bytes(report)[48], 0x23);
    state.apply(bytes(report), ts::mode_off, none, ts::mode_off, none, true);
    EXPECT_EQ(bytes(report)[48], 0x00);  // reset / other effect
  }
  {
    std::array<std::uint8_t, 48> short_report {};  // 42/43 fit, 48 does not: no write past the end
    ts::state_t state;
    short_report[6] = 255;
    state.apply(short_report, ts::mode_weapon, weapon_2_3, ts::mode_weapon, weapon_2_3, true);
    EXPECT_EQ(short_report[42], 0x29);
  }
}

TEST(ArbsTriggerStatus, H2b_SettingParse) {
  // `h2b` in any letter case selects H2b; every other value keeps the b3 boolean result.
  EXPECT_EQ(ts::setting_from("h2b", false), ts::setting_h2b);
  EXPECT_EQ(ts::setting_from("H2B", false), ts::setting_h2b);
  EXPECT_EQ(ts::setting_from("H2b", true), ts::setting_h2b);
  EXPECT_EQ(ts::setting_from("enabled", true), ts::setting_enabled);
  EXPECT_EQ(ts::setting_from("disabled", false), ts::setting_disabled);
  EXPECT_EQ(ts::setting_from("h2", false), ts::setting_disabled);
  EXPECT_EQ(ts::setting_from("h2bx", false), ts::setting_disabled);
  EXPECT_EQ(ts::setting_from("", false), ts::setting_disabled);
  EXPECT_EQ(ts::setting_disabled, 0);
  EXPECT_EQ(ts::setting_enabled, 1);
  EXPECT_EQ(ts::setting_h2b, 2);
  EXPECT_EQ(ts::normalized_setting(-1), 0);
  EXPECT_EQ(ts::normalized_setting(0), 0);
  EXPECT_EQ(ts::normalized_setting(1), 1);
  EXPECT_EQ(ts::normalized_setting(2), 2);
  EXPECT_EQ(ts::normalized_setting(3), 0);
}

TEST(ArbsTriggerStatus, H2b_DiagnosticLineOnChangeAtMostTwentyPerBinding) {
  ts::byte_log_t log;
  std::string line;
  ASSERT_TRUE(log.next(0, 0x00, 0x00, 0x00, line));  // first report of a binding
  EXPECT_EQ(line, "ARBS-H 트리거 상태 바이트(패드 0, 1/20): R 0x00 L 0x00 효과 0x00");
  EXPECT_FALSE(log.next(0, 0x00, 0x00, 0x00, line));  // unchanged: no line
  ASSERT_TRUE(log.next(0, 0x29, 0x00, 0x02, line));
  EXPECT_EQ(line, "ARBS-H 트리거 상태 바이트(패드 0, 2/20): R 0x29 L 0x00 효과 0x02");
  int written = 2;
  for (int i = 0; i < 40; ++i) {
    if (log.next(0, static_cast<std::uint8_t>(i & 1 ? 0x22 : 0x29), 0x00, 0x02, line)) {
      ++written;
    }
  }
  EXPECT_EQ(written, ts::byte_log_t::max_lines);
  EXPECT_EQ(line, "ARBS-H 트리거 상태 바이트(패드 0, 20/20): R 0x29 L 0x00 효과 0x02 - 이 연결의 마지막 줄");
  EXPECT_FALSE(log.next(0, 0x13, 0x13, 0x11, line));  // budget used up
  log.reset();  // new slot or rebound
  ASSERT_TRUE(log.next(3, 0x13, 0x13, 0x11, line));
  EXPECT_EQ(line, "ARBS-H 트리거 상태 바이트(패드 3, 1/20): R 0x13 L 0x13 효과 0x11");
}
