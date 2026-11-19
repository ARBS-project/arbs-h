/**
 * @file tests/unit/test_arbs_haptics_timing.cpp
 * @brief ARBS-H H1-0 PCM haptics timing summary (pure; fixed time points, no clock reads).
 */
#include "../tests_common.h"

#include "src/arbs_haptics_timing.h"

#include <chrono>
#include <cstdint>
#include <string>

namespace {
  using namespace std::chrono_literals;
  using arbs::haptics_timing::clock;
  using arbs::haptics_timing::recorder_t;
  using arbs::haptics_timing::series_t;

  const clock::time_point t0 = clock::time_point {} + 100s;
}  // namespace

TEST(ArbsHapticsTiming, SeriesMeanP95Max) {
  series_t series;
  EXPECT_EQ(series.count(), 0u);
  EXPECT_EQ(series.p95(), 0.0);
  for (int i = 1; i <= 100; ++i) {
    series.add(i);
  }
  EXPECT_EQ(series.count(), 100u);
  EXPECT_DOUBLE_EQ(series.mean(), 50.5);
  EXPECT_DOUBLE_EQ(series.max(), 100.0);
  EXPECT_DOUBLE_EQ(series.p95(), 95.0);  // nearest rank: ceil(0.95 * 100) = 95th value
}

TEST(ArbsHapticsTiming, SingleSampleP95IsThatSample) {
  series_t series;
  series.add(7.5);
  EXPECT_DOUBLE_EQ(series.p95(), 7.5);
  EXPECT_DOUBLE_EQ(series.mean(), 7.5);
  EXPECT_DOUBLE_EQ(series.max(), 7.5);
}

TEST(ArbsHapticsTiming, NoSummaryBeforeOneSecond) {
  recorder_t recorder;
  recorder.iterate_returned(t0);
  recorder.block_created(0, 1, t0);
  EXPECT_FALSE(recorder.take(t0 + 999ms).has_value());
}

TEST(ArbsHapticsTiming, NoSummaryWithoutPcmActivity) {
  recorder_t recorder;
  for (int i = 0; i <= 100; ++i) {
    recorder.iterate_returned(t0 + i * 15ms);
  }
  EXPECT_FALSE(recorder.take(t0 + 1500ms).has_value());
}

TEST(ArbsHapticsTiming, TickBoundDrainShowsBursts) {
  // Blocks are created every 5 ms but drained three at a time each 15 ms
  // iterate() return: the bunching the H1 analysis expects with GetTickCount.
  recorder_t recorder;
  std::uint32_t sequence = 0;
  for (int tick = 0; tick < 66; ++tick) {
    const auto base = t0 + tick * 15ms;
    for (std::uint32_t k = 0; k < 3; ++k) {
      recorder.block_created(0, sequence + k, base + k * 5ms);
    }
    const auto drain_time = base + 15ms;
    for (std::uint32_t k = 0; k < 3; ++k) {
      recorder.block_drained(0, sequence + k, drain_time);
    }
    recorder.iterate_returned(drain_time + 15ms);  // pass closes at the next return
    sequence += 3;
  }
  const auto summary = recorder.take(t0 + 1000ms + 15ms);
  ASSERT_TRUE(summary.has_value());
  EXPECT_EQ(summary->created, 198u);
  EXPECT_EQ(summary->drained, 198u);
  EXPECT_DOUBLE_EQ(summary->create_interval.mean(), 5.0);
  EXPECT_EQ(summary->blocks_per_drain.count(), 66u);
  EXPECT_DOUBLE_EQ(summary->blocks_per_drain.mean(), 3.0);
  EXPECT_DOUBLE_EQ(summary->blocks_per_drain.max(), 3.0);
  EXPECT_DOUBLE_EQ(summary->drain_interval.mean(), 15.0);
  EXPECT_DOUBLE_EQ(summary->queue_wait.max(), 15.0);
  EXPECT_DOUBLE_EQ(summary->queue_wait.mean(), 10.0);  // (15 + 10 + 5) / 3
  EXPECT_DOUBLE_EQ(summary->iterate_interval.mean(), 15.0);
}

TEST(ArbsHapticsTiming, OnTimeDrainShowsOneBlockPerPass) {
  recorder_t recorder;
  for (std::uint32_t i = 0; i < 199; ++i) {
    const auto created = t0 + i * 5ms;
    recorder.block_created(0, i, created);
    recorder.block_drained(0, i, created + 1ms);
    recorder.iterate_returned(created + 2ms);
  }
  const auto summary = recorder.take(t0 + 1000ms);
  ASSERT_TRUE(summary.has_value());
  EXPECT_DOUBLE_EQ(summary->blocks_per_drain.max(), 1.0);
  EXPECT_DOUBLE_EQ(summary->drain_interval.max(), 5.0);
  EXPECT_DOUBLE_EQ(summary->queue_wait.p95(), 1.0);
}

TEST(ArbsHapticsTiming, IdleGapsAreNotIntervals) {
  recorder_t recorder;
  recorder.block_created(0, 0, t0);
  recorder.block_created(0, 1, t0 + 5ms);
  recorder.block_created(0, 2, t0 + 3005ms);  // 3 s pause in the game's haptics
  const auto summary = recorder.take(t0 + 3005ms);
  ASSERT_TRUE(summary.has_value());
  EXPECT_EQ(summary->created, 3u);
  EXPECT_EQ(summary->create_interval.count(), 1u);
  EXPECT_DOUBLE_EQ(summary->create_interval.max(), 5.0);
}

TEST(ArbsHapticsTiming, UnmatchedDrainHasNoQueueWait) {
  recorder_t recorder;
  recorder.block_created(1, 10, t0);
  recorder.block_drained(2, 10, t0 + 4ms);  // other controller, same sequence
  recorder.block_drained(1, 11, t0 + 4ms);  // never created (e.g. evicted slot)
  recorder.iterate_returned(t0 + 5ms);
  const auto summary = recorder.take(t0 + 1s);
  ASSERT_TRUE(summary.has_value());
  EXPECT_EQ(summary->drained, 2u);
  EXPECT_EQ(summary->queue_wait.count(), 0u);
  EXPECT_DOUBLE_EQ(summary->blocks_per_drain.max(), 2.0);
}

TEST(ArbsHapticsTiming, ReturnWithoutDrainIsNotADrainPass) {
  recorder_t recorder;
  recorder.iterate_returned(t0);
  recorder.block_created(0, 0, t0);
  recorder.iterate_returned(t0 + 5ms);
  const auto summary = recorder.take(t0 + 1s);
  ASSERT_TRUE(summary.has_value());
  EXPECT_EQ(summary->blocks_per_drain.count(), 0u);
  EXPECT_EQ(summary->iterate_interval.count(), 1u);
}

TEST(ArbsHapticsTiming, WindowResetsAfterSummary) {
  recorder_t recorder;
  recorder.block_created(0, 0, t0);
  ASSERT_TRUE(recorder.take(t0 + 1s).has_value());
  EXPECT_FALSE(recorder.take(t0 + 2s).has_value());
}

TEST(ArbsHapticsTiming, SummaryLineHasPrefixAndOneLine) {
  recorder_t recorder;
  recorder.block_created(0, 0, t0);
  recorder.block_created(0, 1, t0 + 5ms);
  recorder.block_drained(0, 0, t0 + 6ms);
  recorder.block_drained(0, 1, t0 + 6ms);
  recorder.iterate_returned(t0 + 6ms);
  const auto summary = recorder.take(t0 + 1s);
  ASSERT_TRUE(summary.has_value());
  const auto line = arbs::haptics_timing::format_summary(*summary, "timeGetTime");
  EXPECT_EQ(line.rfind("ARBS-H 햅틱 요약:", 0), 0u) << line;
  EXPECT_NE(line.find("ENet시간원=timeGetTime"), std::string::npos) << line;
  EXPECT_NE(line.find("생성 2개"), std::string::npos) << line;
  EXPECT_NE(line.find("비움 1회(블록 2개) 블록/회 평균 2.00 최대 2"), std::string::npos) << line;
  EXPECT_NE(line.find("대기ms 평균 3.50 p95 6.00 최대 6.00"), std::string::npos) << line;
  EXPECT_EQ(line.find('\n'), std::string::npos);
}
