// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * @file tests/unit/test_arbs_network_diagnostics.cpp
 * @brief ARBS-H 0.3.0 S1-S5: port rules, address kinds, UPnP mapping list (S3) and status (S2),
 * listener states (S4) and the GET /api/network/diagnostics body (S1, docs/analysis/NET2.md 4-5).
 *
 * Addresses below are documentation / format examples only (RFC 5737 203.0.113.0/24 and
 * 198.51.100.0/24, RFC 3849 2001:db8::/32). Range tests use made-up values inside the range (x.217.43 style),
 * never a common router / gateway value and never a real network value.
 */
#include "src/arbs_listener_status.h"
#include "src/arbs_network_diagnostics.h"
#include "src/arbs_network_policy.h"
#include "src/http_auth_request_policy.h"

#include <algorithm>
#include <boost/log/core.hpp>
#include <boost/log/sinks/sync_frontend.hpp>
#include <boost/log/sinks/text_ostream_backend.hpp>
#include <boost/log/sources/logger.hpp>
#include <boost/log/sources/record_ostream.hpp>
#include <boost/smart_ptr/make_shared_object.hpp>
#include <gtest/gtest.h>
#include <memory>
#include <set>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

namespace {
  namespace np = arbs::netpolicy;
  namespace ls = arbs::listener_status;
  namespace nd = arbs::netdiag;

  std::vector<int> ports_of(const std::vector<np::port_entry_t> &list) {
    std::vector<int> out;
    for (const auto &e : list) {
      out.push_back(e.port);
    }
    return out;
  }

  // ---------------- S5 ----------------
  TEST(ArbsPortRule, AcceptedRangeKeepsOldValuesAndWarnsBelow1029) {
    EXPECT_EQ(np::port_rule(1018), np::port_rule_e::ignore);
    EXPECT_EQ(np::port_rule(1019), np::port_rule_e::use_with_warning);
    EXPECT_EQ(np::port_rule(1028), np::port_rule_e::use_with_warning);
    EXPECT_EQ(np::port_rule(1029), np::port_rule_e::use);
    EXPECT_EQ(np::port_rule(47989), np::port_rule_e::use);
    EXPECT_EQ(np::port_rule(45989), np::port_rule_e::use);
    EXPECT_EQ(np::port_rule(65514), np::port_rule_e::use);
    EXPECT_EQ(np::port_rule(65515), np::port_rule_e::ignore);
    EXPECT_EQ(np::port_rule(-1), np::port_rule_e::ignore);
    EXPECT_EQ(np::accepted_min_port, 1019);
    EXPECT_EQ(np::recommended_min_port, 1029);
    EXPECT_EQ(np::max_port, 65514);
    EXPECT_EQ(np::default_port, 47989);
    EXPECT_EQ(np::arbs_recommended_port, 45989);
  }

  TEST(ArbsPortRule, WarningTextNamesThePortAndTheFix) {
    const auto text = np::port_warning_text(1024);
    EXPECT_NE(text.find("port 1024"), std::string::npos) << text;
    EXPECT_NE(text.find("below 1029"), std::string::npos) << text;
    EXPECT_NE(text.find("choose 1029 or higher"), std::string::npos) << text;
    EXPECT_NE(text.find("kept as is"), std::string::npos) << text;
  }

  // ---------------- port lists ----------------
  TEST(ArbsPorts, DerivedFromBaseWithoutWebUiOrUnusedUdp) {
    EXPECT_EQ(ports_of(np::tcp_ports(47989)), (std::vector<int> {47984, 47989, 48010}));
    EXPECT_EQ(ports_of(np::udp_ports(47989)), (std::vector<int> {47998, 47999, 48000}));
    EXPECT_EQ(ports_of(np::tcp_ports(45989)), (std::vector<int> {45984, 45989, 46010}));
    EXPECT_EQ(ports_of(np::udp_ports(45989)), (std::vector<int> {45998, 45999, 46000}));
    EXPECT_EQ(ports_of(np::tcp_ports(1029)), (std::vector<int> {1024, 1029, 1050}));
    EXPECT_EQ(ports_of(np::tcp_ports(65514)), (std::vector<int> {65509, 65514, 65535}));
    for (const int base : {1029, 45989, 47989, 65514}) {
      const auto tcp = ports_of(np::tcp_ports(base));
      const auto udp = ports_of(np::udp_ports(base));
      EXPECT_EQ(std::count(tcp.begin(), tcp.end(), base + 1), 0) << "web UI port is never in the list";
      EXPECT_EQ(std::count(udp.begin(), udp.end(), base + 13), 0) << "UDP base+13 not used";
      EXPECT_EQ(std::count(udp.begin(), udp.end(), base + 21), 0) << "UDP base+21 not used";
    }
    EXPECT_EQ(std::string(np::tcp_ports(1029)[0].role), "https");
    EXPECT_EQ(std::string(np::udp_ports(1029)[2].role), "audio");
  }

  TEST(ArbsPorts, SunshineFamilyOverlapAndDynamicRangeBoundaries) {
    EXPECT_FALSE(np::overlaps_sunshine_default(47962));
    EXPECT_TRUE(np::overlaps_sunshine_default(47963));
    EXPECT_TRUE(np::overlaps_sunshine_default(47989));
    EXPECT_TRUE(np::overlaps_sunshine_default(48015));
    EXPECT_FALSE(np::overlaps_sunshine_default(48016));
    EXPECT_FALSE(np::overlaps_sunshine_default(45989));
    EXPECT_FALSE(np::in_dynamic_range(49130));
    EXPECT_TRUE(np::in_dynamic_range(49131));
    EXPECT_FALSE(np::in_dynamic_range(45989));
    EXPECT_EQ(np::port_note(1028), "below_1029");
    EXPECT_EQ(np::port_note(47989), "overlaps_sunshine_default");
    EXPECT_EQ(np::port_note(45989), "");
    EXPECT_EQ(np::port_note(1029), "");
  }

  // ---------------- S3 ----------------
  TEST(ArbsUpnpPolicy, WebUiPortIsNeverMapped) {
    for (const int base : {1029, 45989, 47989, 48089, 65514}) {
      const auto list = np::upnp_mappings(base);
      ASSERT_EQ(list.size(), 6u);
      std::set<int> tcp;
      std::set<int> udp;
      for (const auto &m : list) {
        EXPECT_NE(m.port, base + 1) << "web UI port mapped for base " << base;
        EXPECT_EQ(std::string(m.description).find("Configuration"), std::string::npos);
        (std::string(m.proto) == "TCP" ? tcp : udp).insert(m.port);
      }
      EXPECT_EQ(tcp, (std::set<int> {base - 5, base, base + 21}));
      EXPECT_EQ(udp, (std::set<int> {base + 9, base + 10, base + 11}));
    }
  }

  TEST(ArbsUpnpPolicy, DiagnosticsSaysWebUiNotMappedEvenWithWanOrigin) {
    nd::inputs_t in;
    in.upnp_enabled = true;
    in.origin_wan = true;
    in.upnp.igd = np::igd_e::connected;
    in.upnp.mapped_ok = 6;
    in.upnp.mapped_total = 6;
    const auto out = nd::build(in);
    EXPECT_FALSE(out["upnp"]["web_ui_mapped"].get<bool>());
    EXPECT_EQ(out["upnp"]["mapped_total"], 6);
    EXPECT_TRUE(out["risk"]["upnp_with_wan_origin"].get<bool>());
    EXPECT_TRUE(out["risk"]["origin_wan"].get<bool>());
  }

  // ---------------- address kinds ----------------
  TEST(ArbsAddressKind, Ipv4) {
    EXPECT_EQ(np::kind_of_v4({10, 217, 43, 9}), np::addr_kind_e::private_v4);
    EXPECT_EQ(np::kind_of_v4({172, 16, 217, 43}), np::addr_kind_e::private_v4);
    EXPECT_EQ(np::kind_of_v4({172, 31, 217, 43}), np::addr_kind_e::private_v4);
    EXPECT_EQ(np::kind_of_v4({172, 32, 217, 43}), np::addr_kind_e::public_v4);
    EXPECT_EQ(np::kind_of_v4({192, 168, 217, 43}), np::addr_kind_e::private_v4);
    EXPECT_EQ(np::kind_of_v4({100, 64, 217, 43}), np::addr_kind_e::cgnat_v4);
    EXPECT_EQ(np::kind_of_v4({100, 127, 217, 43}), np::addr_kind_e::cgnat_v4);
    EXPECT_EQ(np::kind_of_v4({100, 128, 217, 43}), np::addr_kind_e::public_v4);
    EXPECT_EQ(np::kind_of_v4({100, 63, 217, 43}), np::addr_kind_e::public_v4);
    EXPECT_EQ(np::kind_of_v4({203, 0, 113, 7}), np::addr_kind_e::public_v4);
    EXPECT_EQ(np::kind_of_v4({169, 254, 217, 43}), np::addr_kind_e::link_local);
    EXPECT_EQ(np::kind_of_v4({127, 0, 0, 1}), np::addr_kind_e::loopback);
    EXPECT_EQ(np::kind_of_v4({0, 0, 0, 0}), np::addr_kind_e::other);
    EXPECT_EQ(np::kind_of_v4({239, 217, 43, 9}), np::addr_kind_e::other);
  }

  TEST(ArbsAddressKind, Ipv6AndTailscalePrefix) {
    const std::array<std::uint8_t, 16> doc {0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1};
    const std::array<std::uint8_t, 16> ula {0xfd, 0x9e, 0x21, 0xa7, 0x43, 0xc5, 0, 0, 0, 0, 0, 0, 0, 0xd9, 0x2b, 0x43};
    const std::array<std::uint8_t, 16> ts {0xfd, 0x7a, 0x11, 0x5c, 0xa1, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0xd9, 0x2b, 0x43};
    const std::array<std::uint8_t, 16> ll {0xfe, 0x80, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xd9, 0x2b, 0x43};
    const std::array<std::uint8_t, 16> lo {0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1};
    EXPECT_EQ(np::kind_of_v6(doc), np::addr_kind_e::ipv6_global);
    EXPECT_EQ(np::kind_of_v6(ula), np::addr_kind_e::ipv6_ula);
    EXPECT_EQ(np::kind_of_v6(ts), np::addr_kind_e::ipv6_ula);
    EXPECT_EQ(np::kind_of_v6(ll), np::addr_kind_e::link_local);
    EXPECT_EQ(np::kind_of_v6(lo), np::addr_kind_e::loopback);
    EXPECT_TRUE(np::tailscale_v6(ts));
    EXPECT_FALSE(np::tailscale_v6(ula));
    EXPECT_FALSE(np::listed(np::addr_kind_e::loopback));
    EXPECT_FALSE(np::listed(np::addr_kind_e::other));
    EXPECT_TRUE(np::listed(np::addr_kind_e::cgnat_v4));
  }

  // ---------------- S2 ----------------
  TEST(ArbsUpnpStatus, WanKindFromTextOnly) {
    EXPECT_EQ(np::wan_kind_of("203.0.113.7"), np::wan_kind_e::public_);
    EXPECT_EQ(np::wan_kind_of("100.91.217.43"), np::wan_kind_e::cgnat);
    EXPECT_EQ(np::wan_kind_of("192.168.217.43"), np::wan_kind_e::private_);
    EXPECT_EQ(np::wan_kind_of("10.217.43.9"), np::wan_kind_e::private_);
    EXPECT_EQ(np::wan_kind_of(""), np::wan_kind_e::unknown);
    EXPECT_EQ(np::wan_kind_of("0.0.0.0"), np::wan_kind_e::unknown);
    EXPECT_EQ(np::wan_kind_of("garbage"), np::wan_kind_e::unknown);
    EXPECT_EQ(np::wan_kind_of("203.0.113"), np::wan_kind_e::unknown);
    EXPECT_EQ(np::wan_kind_of("203.0.113.7.5"), np::wan_kind_e::unknown);
    EXPECT_EQ(np::wan_kind_of("256.0.113.7"), np::wan_kind_e::unknown);
    EXPECT_EQ(np::wan_kind_of("203.0.113.7 "), np::wan_kind_e::unknown);
    EXPECT_EQ(np::to_string(np::wan_kind_e::public_), "public");
    EXPECT_EQ(np::to_string(np::wan_kind_e::private_), "private");
  }

  // P6: the UPnP debug lines ("Found device", "Found valid IGD device") log only the kind of the router URL host.
  TEST(ArbsUpnpStatus, DeviceUrlLoggedAsKindOnly) {
    EXPECT_EQ(np::url_host_kind("http://192.168.217.43:1900/gatedesc.xml"), "private_v4");
    EXPECT_EQ(np::url_host_kind("http://203.0.113.45:5000/rootDesc.xml"), "public_v4");
    EXPECT_EQ(np::url_host_kind("http://100.91.217.43/desc"), "cgnat_v4");
    EXPECT_EQ(np::url_host_kind("http://user@198.51.100.23:80/"), "public_v4");
    EXPECT_EQ(np::url_host_kind("http://[2001:db8::1]:5000/desc.xml"), "ipv6");
    EXPECT_EQ(np::url_host_kind("http://router.example/desc.xml"), "name");
    EXPECT_EQ(np::url_host_kind("http://198.51.100/desc.xml"), "unknown");
    EXPECT_EQ(np::url_host_kind("http://[2001:db8::1/desc.xml"), "unknown");
    EXPECT_EQ(np::url_host_kind("http:///desc.xml"), "unknown");
    EXPECT_EQ(np::url_host_kind(""), "unknown");
    EXPECT_EQ(np::url_host_kind("198.51.100.23"), "unknown");
    for (const char *url : {"http://192.168.217.43:1900/gatedesc.xml", "http://[2001:db8::1]:5000/desc.xml", "http://router.example/desc.xml"}) {
      const std::string kind {np::url_host_kind(url)};
      EXPECT_EQ(kind.find_first_of(".:/["), std::string::npos) << kind;
    }
  }

  TEST(ArbsUpnpStatus, EnumNamesAndStore) {
    EXPECT_EQ(np::to_string(np::igd_e::not_run), "not_run");
    EXPECT_EQ(np::to_string(np::igd_e::none), "none");
    EXPECT_EQ(np::to_string(np::igd_e::connected), "connected");
    EXPECT_EQ(np::to_string(np::igd_e::private_ip), "private_ip");
    EXPECT_EQ(np::to_string(np::igd_e::disconnected), "disconnected");
    EXPECT_EQ(np::to_string(np::igd_e::unknown_device), "unknown_device");
    EXPECT_EQ(np::to_string(np::pinhole_e::not_tried), "not_tried");
    EXPECT_EQ(np::to_string(np::pinhole_e::ok), "ok");
    EXPECT_EQ(np::to_string(np::pinhole_e::failed), "failed");

    np::upnp_status_store store;
    EXPECT_EQ(store.get().igd, np::igd_e::not_run);
    std::thread writer([&store] {
      for (int i = 0; i <= 1000; ++i) {
        store.set({np::igd_e::connected, i % 7, 6, np::pinhole_e::failed, np::wan_kind_e::cgnat});
      }
    });
    for (int i = 0; i < 1000; ++i) {
      const auto v = store.get();
      EXPECT_TRUE(v.igd == np::igd_e::not_run || (v.mapped_total == 6 && v.wan_kind == np::wan_kind_e::cgnat));
    }
    writer.join();
    const auto last = store.get();
    EXPECT_EQ(last.igd, np::igd_e::connected);
    EXPECT_EQ(last.mapped_ok, 1000 % 7);
    EXPECT_EQ(last.ipv6_pinhole, np::pinhole_e::failed);
  }

  // ---------------- S4 ----------------
  TEST(ArbsListenerStatus, Transitions) {
    ls::reset();
    for (const auto s : ls::snapshot()) {
      EXPECT_EQ(s, ls::state_e::not_started);
    }
    ls::set(ls::id_e::nvhttp_https, ls::state_e::ok);
    ls::set(ls::id_e::rtsp, ls::state_e::failed);
    auto snap = ls::snapshot();
    EXPECT_EQ(snap[static_cast<std::size_t>(ls::id_e::nvhttp_https)], ls::state_e::ok);
    EXPECT_EQ(snap[static_cast<std::size_t>(ls::id_e::rtsp)], ls::state_e::failed);
    EXPECT_EQ(snap[static_cast<std::size_t>(ls::id_e::stream)], ls::state_e::not_started);
    ls::set(ls::id_e::stream, ls::state_e::failed);
    ls::set(ls::id_e::stream, ls::state_e::ok);  // a later session binds again
    EXPECT_EQ(ls::get(ls::id_e::stream), ls::state_e::ok);
    EXPECT_EQ(ls::to_string(ls::state_e::not_started), "not_started");
    EXPECT_EQ(ls::to_string(ls::state_e::ok), "ok");
    EXPECT_EQ(ls::to_string(ls::state_e::failed), "failed");
    ls::reset();
  }

  // ---------------- S1 ----------------
  nd::inputs_t sample_inputs() {
    nd::inputs_t in;
    in.port = 45989;
    in.listeners = {ls::state_e::ok, ls::state_e::ok, ls::state_e::ok, ls::state_e::failed, ls::state_e::not_started};
    in.interfaces_supported = true;
    in.interfaces = {
      {np::addr_kind_e::private_v4, "198.51.100.23", false},
      {np::addr_kind_e::cgnat_v4, "203.0.113.45", true},
      {np::addr_kind_e::ipv6_global, "2001:db8::1", false},
      {np::addr_kind_e::loopback, "127.0.0.1", false},
      {np::addr_kind_e::other, "198.51.100.255", false},
    };
    return in;
  }

  TEST(ArbsNetworkDiagnostics, ShapeAndValues) {
    EXPECT_EQ(nd::cache_control, "no-store");
    const auto out = nd::build(sample_inputs());
    for (const char *key : {"status", "port", "tcp", "udp", "web_ui_port", "never_open", "port_note", "listeners", "upnp", "interfaces", "interfaces_supported", "risk"}) {
      EXPECT_TRUE(out.contains(key)) << key;
    }
    EXPECT_EQ(out["port"], 45989);
    EXPECT_EQ(out["web_ui_port"], 45990);
    EXPECT_EQ(out["port_note"], "");
    ASSERT_EQ(out["tcp"].size(), 3u);
    EXPECT_EQ(out["tcp"][0]["port"], 45984);
    EXPECT_EQ(out["tcp"][0]["role"], "https");
    EXPECT_EQ(out["tcp"][2]["port"], 46010);
    ASSERT_EQ(out["udp"].size(), 3u);
    EXPECT_EQ(out["udp"][0]["role"], "video");
    EXPECT_EQ(out["udp"][1]["role"], "control");
    EXPECT_EQ(out["udp"][2]["port"], 46000);
    ASSERT_EQ(out["never_open"].size(), 2u);
    EXPECT_EQ(out["never_open"][0]["port"], 45990);
    EXPECT_EQ(out["never_open"][0]["why"], "web_ui");
    EXPECT_EQ(out["never_open"][1]["port"], 3240);
    EXPECT_EQ(out["never_open"][1]["why"], "usbip");
    EXPECT_EQ(out["listeners"]["nvhttp_http"], "ok");
    EXPECT_EQ(out["listeners"]["rtsp"], "failed");
    EXPECT_EQ(out["listeners"]["stream"], "not_started");
    // UPnP off: not run, nothing mapped, no WAN kind.
    EXPECT_FALSE(out["upnp"]["enabled"].get<bool>());
    EXPECT_EQ(out["upnp"]["igd"], "not_run");
    EXPECT_EQ(out["upnp"]["mapped_ok"], 0);
    EXPECT_EQ(out["upnp"]["ipv6_pinhole"], "not_tried");
    EXPECT_EQ(out["upnp"]["wan_kind"], "unknown");
    EXPECT_FALSE(out["upnp"].contains("wan_address"));
    // Interfaces: loopback / other left out, no adapter name field.
    ASSERT_EQ(out["interfaces"].size(), 3u);
    EXPECT_EQ(out["interfaces"][0]["kind"], "private_v4");
    EXPECT_EQ(out["interfaces"][1]["kind"], "cgnat_v4");
    EXPECT_TRUE(out["interfaces"][1]["tailscale_like"].get<bool>());
    EXPECT_EQ(out["interfaces"][2]["kind"], "ipv6_global");
    for (const auto &item : out["interfaces"]) {
      EXPECT_EQ(item.size(), 3u) << item.dump();
      EXPECT_FALSE(item.contains("name"));
    }
    EXPECT_EQ(out.dump().find("127.0.0.1"), std::string::npos);
    EXPECT_FALSE(out["risk"]["upnp_with_wan_origin"].get<bool>());
  }

  TEST(ArbsNetworkDiagnostics, DefaultPortNoteAndNonWindows) {
    nd::inputs_t in;
    in.interfaces = {{np::addr_kind_e::private_v4, "198.51.100.23", false}};
    in.interfaces_supported = false;
    const auto out = nd::build(in);
    EXPECT_EQ(out["port"], 47989);
    EXPECT_EQ(out["port_note"], "overlaps_sunshine_default");
    EXPECT_TRUE(out["interfaces"].is_array());
    EXPECT_TRUE(out["interfaces"].empty());
    EXPECT_FALSE(out["interfaces_supported"].get<bool>());
    in.port = 1024;
    EXPECT_EQ(nd::build(in)["port_note"], "below_1029");
  }

  // Building the reply (and classifying addresses) writes no log record at all, so no address can reach a log.
  TEST(ArbsNetworkDiagnostics, NothingIsLogged) {
    namespace logging = boost::log;
    auto stream = boost::make_shared<std::ostringstream>();
    auto backend = boost::make_shared<logging::sinks::text_ostream_backend>();
    backend->add_stream(stream);
    backend->auto_flush(true);
    auto sink = boost::make_shared<logging::sinks::synchronous_sink<logging::sinks::text_ostream_backend>>(backend);
    std::size_t records = 0;
    sink->set_filter([&records](const logging::attribute_value_set &) {
      ++records;
      return true;
    });
    logging::core::get()->add_sink(sink);
    {
      // Control: the sink does see a record written through the logging core.
      logging::sources::logger probe;
      BOOST_LOG(probe) << "probe";
      ASSERT_EQ(records, 1u);
      records = 0;
      stream->str("");
    }
    const auto body = nd::build(sample_inputs()).dump();
    (void) np::wan_kind_of("203.0.113.7");
    (void) np::kind_of_v4({192, 168, 217, 43});
    (void) np::port_warning_text(1024);
    logging::core::get()->remove_sink(sink);
    sink->flush();
    EXPECT_EQ(records, 0u);
    const auto logged = stream->str();
    for (const char *address : {"198.51.100.23", "203.0.113.45", "2001:db8::1", "203.0.113.7"}) {
      EXPECT_EQ(logged.find(address), std::string::npos) << address;
    }
    EXPECT_NE(body.find("198.51.100.23"), std::string::npos) << "the screen still gets the address (shown hidden)";
  }

  // The route is under /api/: without credentials the shared sign-in check answers 401 (same as every API).
  TEST(ArbsNetworkDiagnostics, SignInRequired) {
    confighttp::policy::RequestAuthDependencies deps;
    deps.remote_allowed = [](const std::string &) { return true; };
    deps.credentials_configured = [] { return true; };
    deps.credentials_valid = [](const std::string &, const std::string &) { return false; };
    deps.bearer_valid = [](const std::string &, const std::string &, const std::string &) { return false; };
    deps.session_valid = [](const std::string &) { return false; };
    deps.decode_base64 = [](const std::string &value) { return value; };
    deps.cookie_unescape = [](const std::string &value) { return value; };
    deps.https_port = [] { return std::uint16_t {45990}; };
    const confighttp::policy::RequestAuthPolicy auth {std::move(deps)};
    const auto result = auth.check("127.0.0.1", "", "/api/network/diagnostics", "GET");
    EXPECT_FALSE(result.ok);
    EXPECT_EQ(result.code, SimpleWeb::StatusCode::client_error_unauthorized);
    const auto bad = auth.check("127.0.0.1", "Basic user:wrong", "/api/network/diagnostics", "GET");
    EXPECT_FALSE(bad.ok);
    EXPECT_EQ(bad.code, SimpleWeb::StatusCode::client_error_unauthorized);
  }
}  // namespace
