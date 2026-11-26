// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * @file src/arbs_listener_status.h
 * @brief ARBS-H 0.3.0 (S4): did each listener bind its port? Read by GET /api/network/diagnostics.
 *
 * nvhttp (http, https) and confighttp are marked ok from the Simple-Web-Server start callback
 * (called after bind + listen) and failed when start() throws; rtsp from its bind result; stream
 * from the three UDP binds in start_broadcast (first session; not_started before that).
 * Only states are kept: no port number, no address.
 */
#pragma once

#include <array>
#include <atomic>
#include <cstddef>
#include <string_view>

namespace arbs::listener_status {

  enum class id_e : std::size_t {
    nvhttp_http,
    nvhttp_https,
    confighttp,
    rtsp,
    stream,
    count,
  };

  enum class state_e : int {
    not_started = 0,
    ok = 1,
    failed = 2,
  };

  constexpr std::string_view to_string(state_e state) {
    switch (state) {
      case state_e::not_started:
        return "not_started";
      case state_e::ok:
        return "ok";
      case state_e::failed:
        return "failed";
    }
    return "not_started";
  }

  using snapshot_t = std::array<state_e, static_cast<std::size_t>(id_e::count)>;

  namespace detail {
    inline std::array<std::atomic<int>, static_cast<std::size_t>(id_e::count)> states {};
  }  // namespace detail

  inline void set(id_e id, state_e state) {
    detail::states[static_cast<std::size_t>(id)].store(static_cast<int>(state), std::memory_order_relaxed);
  }

  inline state_e get(id_e id) {
    const int raw = detail::states[static_cast<std::size_t>(id)].load(std::memory_order_relaxed);
    return raw == 1 ? state_e::ok : raw == 2 ? state_e::failed : state_e::not_started;
  }

  inline snapshot_t snapshot() {
    snapshot_t out {};
    for (std::size_t i = 0; i < out.size(); ++i) {
      out[i] = get(static_cast<id_e>(i));
    }
    return out;
  }

  /// For tests: every listener back to not_started.
  inline void reset() {
    for (auto &state : detail::states) {
      state.store(0, std::memory_order_relaxed);
    }
  }

}  // namespace arbs::listener_status
