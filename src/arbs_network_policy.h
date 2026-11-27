// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * @file src/arbs_network_policy.h
 * @brief ARBS-H 0.3.0 "remote access": port rules, address kinds, UPnP mapping list and UPnP status.
 *
 * Pure rules shared by the server (config.cpp, upnp.cpp, the diagnostics API) and the unit tests
 * (docs/analysis/NET2.md sections 4-5). Nothing here logs, opens a socket or keeps an address:
 * addresses are only classified into kinds.
 *
 * - Ports: every port is derived from the one `port` value (base). The server default stays 47989
 *   (config.cpp); new ARBS-H installs get `port = 45989` from the installer only.
 * - S3 (ARBS policy): UPnP never maps the web UI port (base + 1), whatever origin_web_ui_allowed says.
 * - S5: 1019..1028 is still used as before (no silent move to 47989) but gets a warning, because the
 *   HTTPS port (base - 5) would be below 1024. New values from the web screens start at 1029.
 */
#pragma once

#include <array>
#include <cstdint>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace arbs::netpolicy {

  // Offsets from the base port (same values as nvhttp::PORT_HTTPS / PORT_HTTP, confighttp::PORT_HTTPS,
  // rtsp_stream::RTSP_SETUP_PORT and stream::VIDEO_STREAM_PORT / CONTROL_PORT / AUDIO_STREAM_PORT;
  // config.cpp and upnp.cpp static_assert that they match).
  inline constexpr int offset_https = -5;
  inline constexpr int offset_http = 0;
  inline constexpr int offset_web_ui = 1;
  inline constexpr int offset_rtsp = 21;
  inline constexpr int offset_video = 9;
  inline constexpr int offset_control = 10;
  inline constexpr int offset_audio = 11;

  /// Server default (config.cpp), unchanged for existing installs.
  inline constexpr int default_port = 47989;
  /// ARBS-H recommended base: written by the installer into a newly created sunshine.conf only.
  inline constexpr int arbs_recommended_port = 45989;
  /// Lowest value the server accepts (kept from Vibepollo so an existing 1019..1028 does not move).
  inline constexpr int accepted_min_port = 1024 + offset_https;  // 1019
  /// Lowest value without a warning: the HTTPS port base - 5 stays >= 1024.
  inline constexpr int recommended_min_port = 1024 - offset_https;  // 1029
  /// Highest value: the RTSP port base + 21 stays <= 65535.
  inline constexpr int max_port = 65535 - offset_rtsp;  // 65514
  inline constexpr int usbip_port = 3240;
  /// Default port family of Sunshine-based hosts (Sunshine, Apollo, Vibepollo): 47984..48010.
  inline constexpr int sunshine_family_first = 47984;
  inline constexpr int sunshine_family_last = 48010;
  /// Windows dynamic (ephemeral) port range start.
  inline constexpr int dynamic_first = 49152;

  enum class port_rule_e {
    use,  ///< 1029..65514
    use_with_warning,  ///< 1019..1028: used as is, warning log + note in the web screen
    ignore,  ///< anything else: ignored, the previous value (default 47989) stays
  };

  constexpr port_rule_e port_rule(long long value) {
    if (value >= recommended_min_port && value <= max_port) {
      return port_rule_e::use;
    }
    if (value >= accepted_min_port && value < recommended_min_port) {
      return port_rule_e::use_with_warning;
    }
    return port_rule_e::ignore;
  }

  /// Warning line for a port in 1019..1028 (only the port number, never an address).
  inline std::string port_warning_text(int port) {
    return "port " + std::to_string(port) + " is below " + std::to_string(recommended_min_port) +
           ": the HTTPS port (port - 5) would be below 1024; choose " + std::to_string(recommended_min_port) +
           " or higher (the value is kept as is)";
  }

  struct port_entry_t {
    int port;
    std::string_view role;
  };

  /// TCP ports a remote client needs: https (base-5), http (base), rtsp (base+21). The web UI port is not here.
  inline std::vector<port_entry_t> tcp_ports(int base) {
    return {{base + offset_https, "https"}, {base + offset_http, "http"}, {base + offset_rtsp, "rtsp"}};
  }

  /// UDP ports a remote client needs: video (base+9), control (base+10), audio (base+11).
  inline std::vector<port_entry_t> udp_ports(int base) {
    return {{base + offset_video, "video"}, {base + offset_control, "control"}, {base + offset_audio, "audio"}};
  }

  /// Any derived port (TCP base-5, base, base+1, base+21 or UDP base+9..11) is inside 47984..48010.
  constexpr bool overlaps_sunshine_default(int base) {
    constexpr std::array<int, 7> offsets {offset_https, offset_http, offset_web_ui, offset_rtsp, offset_video, offset_control, offset_audio};
    for (const int offset : offsets) {
      const int port = base + offset;
      if (port >= sunshine_family_first && port <= sunshine_family_last) {
        return true;
      }
    }
    return false;
  }

  /// The highest derived port (base+21) is in the Windows dynamic range.
  constexpr bool in_dynamic_range(int base) {
    return base + offset_rtsp >= dynamic_first;
  }

  /// "" / "below_1029" / "overlaps_sunshine_default" (diagnostics `port_note`).
  constexpr std::string_view port_note(int base) {
    if (base < recommended_min_port) {
      return "below_1029";
    }
    if (overlaps_sunshine_default(base)) {
      return "overlaps_sunshine_default";
    }
    return "";
  }

  // ---------------------------------------------------------------------------------------------
  // S3: UPnP mappings. The web UI port (base + 1) is never in this list (ARBS policy, NET1 D2).
  // ---------------------------------------------------------------------------------------------
  struct upnp_mapping_t {
    int port;
    std::string_view proto;
    std::string_view description;
  };

  inline std::vector<upnp_mapping_t> upnp_mappings(int base) {
    return {
      {base + offset_rtsp, "TCP", "Sunshine - RTSP"},
      {base + offset_video, "UDP", "Sunshine - Video"},
      {base + offset_audio, "UDP", "Sunshine - Audio"},
      {base + offset_control, "UDP", "Sunshine - Control"},
      {base + offset_http, "TCP", "Sunshine - Client HTTP"},
      {base + offset_https, "TCP", "Sunshine - Client HTTPS"},
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Address kinds (D5: the API carries the address for the screen, logs never do).
  // ---------------------------------------------------------------------------------------------
  enum class addr_kind_e {
    private_v4,  ///< 10/8, 172.16/12, 192.168/16
    cgnat_v4,  ///< 100.64/10 (Tailscale or a carrier-grade NAT)
    public_v4,
    ipv6_global,  ///< 2000::/3
    ipv6_ula,  ///< fc00::/7
    link_local,  ///< 169.254/16, fe80::/10
    loopback,  ///< 127/8, ::1 (not listed)
    other,  ///< anything else (not listed)
  };

  constexpr std::string_view to_string(addr_kind_e kind) {
    switch (kind) {
      case addr_kind_e::private_v4:
        return "private_v4";
      case addr_kind_e::cgnat_v4:
        return "cgnat_v4";
      case addr_kind_e::public_v4:
        return "public_v4";
      case addr_kind_e::ipv6_global:
        return "ipv6_global";
      case addr_kind_e::ipv6_ula:
        return "ipv6_ula";
      case addr_kind_e::link_local:
        return "link_local";
      case addr_kind_e::loopback:
        return "loopback";
      case addr_kind_e::other:
        return "other";
    }
    return "other";
  }

  /// Kinds that appear in the diagnostics `interfaces` list (loopback and other are left out).
  constexpr bool listed(addr_kind_e kind) {
    return kind != addr_kind_e::loopback && kind != addr_kind_e::other;
  }

  constexpr addr_kind_e kind_of_v4(const std::array<std::uint8_t, 4> &a) {
    if (a[0] == 127) {
      return addr_kind_e::loopback;
    }
    if (a[0] == 169 && a[1] == 254) {
      return addr_kind_e::link_local;
    }
    if (a[0] == 10 || (a[0] == 172 && (a[1] & 0xF0) == 16) || (a[0] == 192 && a[1] == 168)) {
      return addr_kind_e::private_v4;
    }
    if (a[0] == 100 && (a[1] & 0xC0) == 64) {
      return addr_kind_e::cgnat_v4;
    }
    if (a[0] == 0 || a[0] >= 224) {
      return addr_kind_e::other;  // "this network", multicast, reserved, broadcast
    }
    return addr_kind_e::public_v4;
  }

  constexpr addr_kind_e kind_of_v6(const std::array<std::uint8_t, 16> &a) {
    bool zero_head = true;
    for (int i = 0; i < 15; ++i) {
      zero_head = zero_head && a[i] == 0;
    }
    if (zero_head && a[15] == 1) {
      return addr_kind_e::loopback;
    }
    if (a[0] == 0xFE && (a[1] & 0xC0) == 0x80) {
      return addr_kind_e::link_local;
    }
    if ((a[0] & 0xFE) == 0xFC) {
      return addr_kind_e::ipv6_ula;
    }
    if ((a[0] & 0xE0) == 0x20) {
      return addr_kind_e::ipv6_global;
    }
    return addr_kind_e::other;
  }

  /// Tailscale's IPv6 prefix fd7a:115c:a1e0::/48.
  constexpr bool tailscale_v6(const std::array<std::uint8_t, 16> &a) {
    return a[0] == 0xFD && a[1] == 0x7A && a[2] == 0x11 && a[3] == 0x5C && a[4] == 0xA1 && a[5] == 0xE0;
  }

  /// Dotted IPv4 text ("a.b.c.d", no spaces, no leading '+') to bytes.
  inline std::optional<std::array<std::uint8_t, 4>> parse_v4(std::string_view text) {
    std::array<std::uint8_t, 4> out {};
    std::size_t pos = 0;
    for (int part = 0; part < 4; ++part) {
      if (pos >= text.size()) {
        return std::nullopt;
      }
      int value = 0;
      int digits = 0;
      while (pos < text.size() && text[pos] >= '0' && text[pos] <= '9') {
        value = value * 10 + (text[pos] - '0');
        ++digits;
        ++pos;
        if (digits > 3 || value > 255) {
          return std::nullopt;
        }
      }
      if (digits == 0) {
        return std::nullopt;
      }
      out[part] = static_cast<std::uint8_t>(value);
      if (part < 3) {
        if (pos >= text.size() || text[pos] != '.') {
          return std::nullopt;
        }
        ++pos;
      }
    }
    if (pos != text.size()) {
      return std::nullopt;
    }
    return out;
  }

  /**
   * P6 for the UPnP debug lines: the kind of the host in a device URL ("http://host:port/path"), never the
   * host itself. IPv4 = its kind (private_v4, ...), "[...]" = ipv6, a name = name, empty or unreadable = unknown.
   */
  inline std::string_view url_host_kind(std::string_view url) {
    const auto scheme = url.find("://");
    if (scheme == std::string_view::npos) {
      return "unknown";
    }
    auto host = url.substr(scheme + 3);
    host = host.substr(0, host.find_first_of("/?#"));
    if (const auto at = host.rfind('@'); at != std::string_view::npos) {
      host = host.substr(at + 1);
    }
    if (host.empty()) {
      return "unknown";
    }
    if (host.front() == '[') {
      return host.find(']') == std::string_view::npos ? "unknown" : "ipv6";
    }
    host = host.substr(0, host.find(':'));
    if (host.empty()) {
      return "unknown";
    }
    if (const auto bytes = parse_v4(host)) {
      return to_string(kind_of_v4(*bytes));
    }
    return host.find_first_not_of("0123456789.") == std::string_view::npos ? "unknown" : "name";
  }

  /// One address of this PC for the diagnostics list. No adapter name is kept.
  struct interface_t {
    addr_kind_e kind;
    std::string address;
    bool tailscale_like;
  };

  // ---------------------------------------------------------------------------------------------
  // S2: last UPnP result (kinds and counts only; the WAN address itself is never stored).
  // ---------------------------------------------------------------------------------------------
  enum class igd_e { not_run, none, connected, private_ip, disconnected, unknown_device };
  enum class pinhole_e { not_tried, ok, failed };
  enum class wan_kind_e { unknown, public_, private_, cgnat };

  constexpr std::string_view to_string(igd_e value) {
    switch (value) {
      case igd_e::not_run:
        return "not_run";
      case igd_e::none:
        return "none";
      case igd_e::connected:
        return "connected";
      case igd_e::private_ip:
        return "private_ip";
      case igd_e::disconnected:
        return "disconnected";
      case igd_e::unknown_device:
        return "unknown_device";
    }
    return "not_run";
  }

  constexpr std::string_view to_string(pinhole_e value) {
    switch (value) {
      case pinhole_e::not_tried:
        return "not_tried";
      case pinhole_e::ok:
        return "ok";
      case pinhole_e::failed:
        return "failed";
    }
    return "not_tried";
  }

  constexpr std::string_view to_string(wan_kind_e value) {
    switch (value) {
      case wan_kind_e::unknown:
        return "unknown";
      case wan_kind_e::public_:
        return "public";
      case wan_kind_e::private_:
        return "private";
      case wan_kind_e::cgnat:
        return "cgnat";
    }
    return "unknown";
  }

  /// Kind of the router's external address text (from UPnP). Empty or unreadable = unknown.
  inline wan_kind_e wan_kind_of(std::string_view text) {
    const auto bytes = parse_v4(text);
    if (!bytes) {
      return wan_kind_e::unknown;
    }
    switch (kind_of_v4(*bytes)) {
      case addr_kind_e::public_v4:
        return wan_kind_e::public_;
      case addr_kind_e::cgnat_v4:
        return wan_kind_e::cgnat;
      case addr_kind_e::private_v4:
      case addr_kind_e::link_local:
        return wan_kind_e::private_;
      default:
        return wan_kind_e::unknown;
    }
  }

  struct upnp_status_t {
    igd_e igd = igd_e::not_run;
    int mapped_ok = 0;
    int mapped_total = 0;
    pinhole_e ipv6_pinhole = pinhole_e::not_tried;
    wan_kind_e wan_kind = wan_kind_e::unknown;
  };

  /// Thread-safe holder: the UPnP thread writes, the diagnostics API reads a copy.
  class upnp_status_store {
  public:
    void set(const upnp_status_t &value) {
      std::lock_guard lock {mutex_};
      value_ = value;
    }

    upnp_status_t get() const {
      std::lock_guard lock {mutex_};
      return value_;
    }

  private:
    mutable std::mutex mutex_;
    upnp_status_t value_ {};
  };

  // ---------------------------------------------------------------------------------------------
  // 0.3.1 (H031 F3): router's outside address for the "connect from outside" step, read only.
  // The server asks the router on the same LAN (UPnP GetExternalIPAddress, no mapping); these are the pure parts.
  // ---------------------------------------------------------------------------------------------

  /// A UPnP device / control URL may be followed only when its host is a LAN address (private IPv4 or link-local).
  /// Names, public addresses, IPv6 and unreadable URLs are refused, so a fake SSDP reply cannot send the request out.
  inline bool lan_url(std::string_view url) {
    const auto kind = url_host_kind(url);
    return kind == to_string(addr_kind_e::private_v4) || kind == to_string(addr_kind_e::link_local);
  }

  enum class router_wan_e {
    ok,  ///< the router answered (kind tells public / private / cgnat / unknown)
    no_router,  ///< no UPnP device answered on the LAN
    no_answer,  ///< a device was found but gave no external address
    busy,  ///< another request is asking right now
  };

  constexpr std::string_view to_string(router_wan_e value) {
    switch (value) {
      case router_wan_e::ok:
        return "ok";
      case router_wan_e::no_router:
        return "no_router";
      case router_wan_e::no_answer:
        return "no_answer";
      case router_wan_e::busy:
        return "busy";
    }
    return "no_answer";
  }

  struct router_wan_t {
    router_wan_e state = router_wan_e::no_answer;
    wan_kind_e kind = wan_kind_e::unknown;
    std::string address;  ///< only for a public address (private / 100.64 values are never kept, P-10)
  };

  /// Router's GetExternalIPAddress text -> result. Empty, 0.0.0.0 or unreadable = no_answer; the text is kept only
  /// when it is a public IPv4 address.
  inline router_wan_t router_wan_from_text(std::string_view text) {
    router_wan_t out;
    if (text.empty() || !parse_v4(text)) {
      return out;
    }
    out.kind = wan_kind_of(text);
    if (out.kind == wan_kind_e::unknown) {
      return out;  // 0.0.0.0, loopback, multicast, reserved
    }
    out.state = router_wan_e::ok;
    if (out.kind == wan_kind_e::public_) {
      out.address = std::string(text);
    }
    return out;
  }

}  // namespace arbs::netpolicy
