// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * @file src/arbs_haptics_timing.h
 * @brief ARBS-H H1-0: one log line per second summarizing PCM haptics block timing.
 *
 * Three points of the host waveform haptics path are measured without logging per block:
 *   1. creation - a 5 ms PCM block leaves the packetizer (USB/IP transport thread)
 *   2. drain    - the control thread takes the block from the feedback queue and sends it
 *   3. return   - the control thread returns from control_server_t::iterate() (enet_host_service)
 * All blocks drained between two iterate() returns form one drain pass.
 * The summary contains no addresses, tokens or client names.
 */
#pragma once

#include <algorithm>
#include <array>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace arbs::haptics_timing {
  using clock = std::chrono::steady_clock;

  /// Length of one summary window.
  inline constexpr std::chrono::milliseconds summary_period {1000};
  /// Spacing at or above this is an idle gap, not burst spacing, and is not aggregated.
  inline constexpr std::chrono::milliseconds max_interval {1000};

  /// Count, mean, nearest-rank p95 and maximum of millisecond samples in one window.
  class series_t {
  public:
    static constexpr std::size_t max_samples = 4096;

    void add(double ms) {
      ++count_;
      sum_ += ms;
      max_ = count_ == 1 ? ms : std::max(max_, ms);
      if (samples_.size() < max_samples) {
        samples_.push_back(ms);
      }
    }

    std::uint32_t count() const {
      return count_;
    }

    double mean() const {
      return count_ ? sum_ / count_ : 0.0;
    }

    double max() const {
      return max_;
    }

    /// p95 of the retained samples (the first max_samples of the window).
    double p95() const {
      if (samples_.empty()) {
        return 0.0;
      }
      std::vector<double> sorted = samples_;
      const std::size_t rank = (sorted.size() * 95 + 99) / 100;  // ceil(0.95 * n), n >= 1
      const auto index = static_cast<std::ptrdiff_t>(rank - 1);
      std::nth_element(sorted.begin(), sorted.begin() + index, sorted.end());
      return sorted[static_cast<std::size_t>(index)];
    }

  private:
    std::uint32_t count_ = 0;
    double sum_ = 0;
    double max_ = 0;
    std::vector<double> samples_;
  };

  /// Values of one completed window.
  struct summary_t {
    double window_ms = 0;
    std::uint32_t created = 0;  ///< blocks created in the window
    series_t create_interval;  ///< spacing between consecutive created blocks
    std::uint32_t drained = 0;  ///< blocks drained in the window
    series_t drain_interval;  ///< spacing between consecutive drain passes that sent >= 1 block
    series_t blocks_per_drain;  ///< blocks sent per drain pass
    series_t queue_wait;  ///< creation -> drain per block
    series_t iterate_interval;  ///< spacing between consecutive iterate() returns
  };

  inline double to_ms(clock::duration d) {
    return std::chrono::duration<double, std::milli>(d).count();
  }

  /// Thread-safe recorder. Creation runs on the USB/IP transport thread, the rest on the control thread.
  class recorder_t {
  public:
    void block_created(std::uint16_t id, std::uint32_t sequence, clock::time_point now) {
      std::lock_guard lock {mutex_};
      start_window_if_needed(now);
      add_interval(current_.create_interval, last_create_, now);
      ++current_.created;
      pending_[sequence % pending_.size()] = {true, id, sequence, now};
    }

    void block_drained(std::uint16_t id, std::uint32_t sequence, clock::time_point now) {
      std::lock_guard lock {mutex_};
      start_window_if_needed(now);
      ++current_.drained;
      ++pass_blocks_;
      pass_time_ = now;
      auto &slot = pending_[sequence % pending_.size()];
      if (slot.valid && slot.id == id && slot.sequence == sequence && now >= slot.created) {
        current_.queue_wait.add(to_ms(now - slot.created));
      }
      slot.valid = false;
    }

    /// Ends the current drain pass and records the iterate() return spacing.
    void iterate_returned(clock::time_point now) {
      std::lock_guard lock {mutex_};
      start_window_if_needed(now);
      if (pass_blocks_ > 0) {
        current_.blocks_per_drain.add(pass_blocks_);
        add_interval(current_.drain_interval, last_drain_, pass_time_);
        pass_blocks_ = 0;
      }
      add_interval(current_.iterate_interval, last_iterate_, now);
    }

    /**
     * @brief Close the window once summary_period has elapsed.
     * @return The completed window when it saw PCM blocks; otherwise nothing, so idle seconds log nothing.
     */
    std::optional<summary_t> take(clock::time_point now) {
      std::lock_guard lock {mutex_};
      if (!window_start_ || now - *window_start_ < summary_period) {
        return std::nullopt;
      }
      summary_t done = std::move(current_);
      done.window_ms = to_ms(now - *window_start_);
      current_ = {};
      window_start_ = now;
      if (done.created == 0 && done.drained == 0) {
        return std::nullopt;
      }
      return done;
    }

  private:
    struct pending_block_t {
      bool valid = false;
      std::uint16_t id = 0;
      std::uint32_t sequence = 0;
      clock::time_point created {};
    };

    void start_window_if_needed(clock::time_point now) {
      if (!window_start_) {
        window_start_ = now;
      }
    }

    static void add_interval(series_t &series, std::optional<clock::time_point> &last, clock::time_point now) {
      if (last && now >= *last && now - *last < max_interval) {
        series.add(to_ms(now - *last));
      }
      last = now;
    }

    std::mutex mutex_;
    std::optional<clock::time_point> window_start_;
    summary_t current_;
    std::optional<clock::time_point> last_create_;
    std::optional<clock::time_point> last_drain_;
    std::optional<clock::time_point> last_iterate_;
    std::uint32_t pass_blocks_ = 0;
    clock::time_point pass_time_ {};
    // The feedback queue holds at most 256 messages, so 1024 slots keyed by
    // sequence do not alias a block that is still queued.
    std::array<pending_block_t, 1024> pending_ {};
  };

  /// One summary line, starting with the fixed prefix "ARBS-H 햅틱 요약:".
  inline std::string format_summary(const summary_t &s, std::string_view time_source) {
    const auto stats = [](const series_t &series) {
      char buffer[128];
      std::snprintf(buffer, sizeof(buffer), "평균 %.2f p95 %.2f 최대 %.2f", series.mean(), series.p95(), series.max());
      return std::string {buffer};
    };
    char buffer[256];
    std::string line = "ARBS-H 햅틱 요약: ENet시간원=";
    line.append(time_source);
    std::snprintf(buffer, sizeof(buffer), " 구간 %.0fms | 생성 %u개 간격ms ", s.window_ms, static_cast<unsigned>(s.created));
    line += buffer;
    line += stats(s.create_interval);
    std::snprintf(buffer, sizeof(buffer), " | 비움 %u회(블록 %u개) 블록/회 평균 %.2f 최대 %.0f 간격ms", static_cast<unsigned>(s.blocks_per_drain.count()), static_cast<unsigned>(s.drained), s.blocks_per_drain.mean(), s.blocks_per_drain.max());
    line += buffer;
    line += stats(s.drain_interval);
    line += " | 대기ms ";
    line += stats(s.queue_wait);
    std::snprintf(buffer, sizeof(buffer), " | iterate %u회 간격ms ", static_cast<unsigned>(s.iterate_interval.count()));
    line += buffer;
    line += stats(s.iterate_interval);
    return line;
  }

  /// Process-wide recorder shared by the USB/IP gamepad and the control stream.
  inline recorder_t &recorder() {
    static recorder_t instance;
    return instance;
  }
}  // namespace arbs::haptics_timing
