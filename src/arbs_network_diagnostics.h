// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * @file src/arbs_network_diagnostics.h
 * @brief ARBS-H 0.3.0 (S1): body of GET /api/network/diagnostics (docs/analysis/NET2.md section 4).
 *
 * The handler in confighttp.cpp signs in first (authenticate), never calls print_req and never logs
 * this body; it sends it with Cache-Control: no-store. This builder is pure: it does not log, keep or
 * send anything. Interface addresses are included for the screen (shown hidden by default, D5); the
 * UPnP WAN address is never included (kind only), adapter names are never included.
 */
#pragma once

#include "arbs_listener_status.h"
#include "arbs_network_policy.h"

#include <nlohmann/json.hpp>
#include <string_view>
#include <vector>

namespace arbs::netdiag {

  /// Cache-Control value of the diagnostics reply.
  inline constexpr std::string_view cache_control = "no-store";

  struct inputs_t {
    int port = netpolicy::default_port;  ///< effective base port (config::sunshine.port)
    listener_status::snapshot_t listeners {};
    bool upnp_enabled = false;  ///< config flag UPNP
    netpolicy::upnp_status_t upnp {};
    bool origin_wan = false;  ///< origin_web_ui_allowed is wan
    bool interfaces_supported = false;  ///< Windows only
    std::vector<netpolicy::interface_t> interfaces;
  };

  inline nlohmann::json ports_json(const std::vector<netpolicy::port_entry_t> &ports) {
    nlohmann::json out = nlohmann::json::array();
    for (const auto &entry : ports) {
      out.push_back({{"port", entry.port}, {"role", std::string(entry.role)}});
    }
    return out;
  }

  inline nlohmann::json build(const inputs_t &in) {
    using listener_status::id_e;
    using listener_status::to_string;
    const auto state = [&](id_e id) {
      return std::string(to_string(in.listeners[static_cast<std::size_t>(id)]));
    };

    nlohmann::json out;
    out["status"] = true;
    out["port"] = in.port;
    out["tcp"] = ports_json(netpolicy::tcp_ports(in.port));
    out["udp"] = ports_json(netpolicy::udp_ports(in.port));
    out["web_ui_port"] = in.port + netpolicy::offset_web_ui;
    out["never_open"] = nlohmann::json::array({
      {{"port", in.port + netpolicy::offset_web_ui}, {"why", "web_ui"}},
      {{"port", netpolicy::usbip_port}, {"why", "usbip"}},
    });
    out["port_note"] = std::string(netpolicy::port_note(in.port));
    out["listeners"] = {
      {"nvhttp_http", state(id_e::nvhttp_http)},
      {"nvhttp_https", state(id_e::nvhttp_https)},
      {"confighttp", state(id_e::confighttp)},
      {"rtsp", state(id_e::rtsp)},
      {"stream", state(id_e::stream)},
    };
    const auto &u = in.upnp;
    out["upnp"] = {
      {"enabled", in.upnp_enabled},
      {"igd", std::string(netpolicy::to_string(in.upnp_enabled ? u.igd : netpolicy::igd_e::not_run))},
      {"mapped_ok", in.upnp_enabled ? u.mapped_ok : 0},
      {"mapped_total", in.upnp_enabled ? u.mapped_total : 0},
      {"web_ui_mapped", false},  // S3: never mapped
      {"ipv6_pinhole", std::string(netpolicy::to_string(in.upnp_enabled ? u.ipv6_pinhole : netpolicy::pinhole_e::not_tried))},
      {"wan_kind", std::string(netpolicy::to_string(in.upnp_enabled ? u.wan_kind : netpolicy::wan_kind_e::unknown))},
    };
    nlohmann::json interfaces = nlohmann::json::array();
    if (in.interfaces_supported) {
      for (const auto &item : in.interfaces) {
        if (!netpolicy::listed(item.kind)) {
          continue;
        }
        interfaces.push_back({
          {"kind", std::string(netpolicy::to_string(item.kind))},
          {"address", item.address},
          {"tailscale_like", item.tailscale_like},
        });
      }
    }
    out["interfaces"] = interfaces;
    out["interfaces_supported"] = in.interfaces_supported;
    out["risk"] = {
      {"upnp_with_wan_origin", in.upnp_enabled && in.origin_wan},
      {"origin_wan", in.origin_wan},
    };
    return out;
  }

}  // namespace arbs::netdiag
