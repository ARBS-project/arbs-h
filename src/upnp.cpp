/**
 * @file src/upnp.cpp
 * @brief Definitions for UPnP port mapping.
 */
// standard includes
#include <stddef.h>  // workaround for type_t error in miniupnpc 2.3.3, see https://github.com/miniupnp/miniupnp/commit/e263ab6f56c382e10fed31347ec68095d691a0e8

// lib includes
#include <cstddef>  // Needed to compile size_t in Windows
#include <miniupnpc/miniupnpc.h>
#include <miniupnpc/upnpcommands.h>

// local includes
#include "config.h"
#include "confighttp.h"
#include "globals.h"
#include "logging.h"
#include "network.h"
#include "nvhttp.h"
#include "rtsp.h"
#include "stream.h"
#include "upnp.h"
#include "utility.h"

using namespace std::literals;

namespace upnp {

  struct mapping_t {
    struct {
      std::string wan;
      std::string lan;
      std::string proto;
    } port;

    std::string description;
  };

  // ARBS-H 0.3.0 (S2): written by the UPnP thread, read by GET /api/network/diagnostics.
  static arbs::netpolicy::upnp_status_store g_last_status;

  static arbs::netpolicy::igd_e status_kind(igd_status_e status) {
    using enum igd_status_e;
    using arbs::netpolicy::igd_e;

    switch (status) {
      case none:
        return igd_e::none;
      case connected:
        return igd_e::connected;
#if (MINIUPNPC_API_VERSION >= 18)
      case private_ip:
        return igd_e::private_ip;
#endif
      case disconnected:
        return igd_e::disconnected;
      case unknown_device:
        return igd_e::unknown_device;
    }

    return igd_e::unknown_device;
  }

  static std::string_view status_string(igd_status_e status) {
    using enum igd_status_e;

    switch (status) {
      case none:
        return "No IGD device found"sv;
      case connected:
        return "Valid IGD device found"sv;
#if (MINIUPNPC_API_VERSION >= 18)
      case private_ip:
        return "Valid IGD device found, but it has a private IP address"sv;
#endif
      case disconnected:
        return "Valid IGD device found, but it isn't connected"sv;
      case unknown_device:
        return "A UPnP device has been found, but it wasn't recognized as an IGD"sv;
    }

    return "Unknown status"sv;
  }

  /**
   * This function is a wrapper around UPNP_GetValidIGD() that returns the status code. There is a pre-processor
   * check to determine which version of the function to call based on the version of the MiniUPnPc library.
   */
  igd_status_e UPNP_GetValidIGDStatus(device_t &device, urls_t *urls, IGDdatas *data, std::array<char, INET6_ADDRESS_STRLEN> &lan_addr, std::array<char, INET6_ADDRESS_STRLEN> *wan_addr) {
    if (wan_addr) {
      wan_addr->fill('\0');
    }
#if (MINIUPNPC_API_VERSION >= 18)
    auto status = UPNP_GetValidIGD(device.get(), &urls->el, data, lan_addr.data(), (int) lan_addr.size(), wan_addr ? wan_addr->data() : nullptr, wan_addr ? (int) wan_addr->size() : 0);
#else
    auto status = UPNP_GetValidIGD(device.get(), &urls->el, data, lan_addr.data(), (int) lan_addr.size());
#endif
    return static_cast<igd_status_e>(status);
  }

  bool is_valid_igd(igd_status_e status) {
    using enum igd_status_e;

    switch (status) {
      case connected:
#if (MINIUPNPC_API_VERSION >= 18)
      case private_ip:
#endif
      case disconnected:
        return true;
      default:
        return false;
    }
  }

  class deinit_t: public platf::deinit_t {
  public:
    deinit_t() {
      static_assert(arbs::netpolicy::offset_rtsp == rtsp_stream::RTSP_SETUP_PORT);
      static_assert(arbs::netpolicy::offset_video == stream::VIDEO_STREAM_PORT);
      static_assert(arbs::netpolicy::offset_audio == stream::AUDIO_STREAM_PORT);
      static_assert(arbs::netpolicy::offset_control == stream::CONTROL_PORT);
      static_assert(arbs::netpolicy::offset_http == nvhttp::PORT_HTTP);
      static_assert(arbs::netpolicy::offset_https == nvhttp::PORT_HTTPS);
      static_assert(arbs::netpolicy::offset_web_ui == confighttp::PORT_HTTPS);

      // ARBS-H 0.3.0 (S3, NET1 D2): ARBS never maps the web UI port, even when origin_web_ui_allowed is wan.
      // The list (arbs_network_policy.h upnp_mappings) has the 6 streaming ports only.
      for (const auto &m : arbs::netpolicy::upnp_mappings(config::sunshine.port)) {
        auto port = std::to_string(m.port);
        mappings.emplace_back(mapping_t {{port, port, std::string(m.proto)}, std::string(m.description)});
      }

      // Start the mapping thread
      upnp_thread = std::thread {&deinit_t::upnp_thread_proc, this};
    }

    ~deinit_t() {
      upnp_thread.join();
    }

    /**
     * @brief Opens pinholes for IPv6 traffic if the IGD is capable.
     * @details Not many IGDs support this feature, so we perform error logging with debug level.
     * @return `true` if the pinholes were opened successfully.
     */
    bool create_ipv6_pinholes() {
      int err;
      device_t device {upnpDiscover(2000, nullptr, nullptr, 0, IPv6, 2, &err)};
      if (!device || err) {
        BOOST_LOG(debug) << "Couldn't discover any IPv6 UPNP devices"sv;
        return false;
      }

      IGDdatas data;
      urls_t urls;
      std::array<char, INET6_ADDRESS_STRLEN> lan_addr;
      auto status = upnp::UPNP_GetValidIGDStatus(device, &urls, &data, lan_addr);
      if (!is_valid_igd(status)) {
        BOOST_LOG(debug) << "No valid IPv6 IGD: "sv << status_string(status);
        return false;
      }

      if (data.IPv6FC.controlurl[0] != 0) {
        int firewallEnabled;
        int pinholeAllowed;

        // Check if this firewall supports IPv6 pinholes
        err = UPNP_GetFirewallStatus(urls->controlURL_6FC, data.IPv6FC.servicetype, &firewallEnabled, &pinholeAllowed);
        if (err == UPNPCOMMAND_SUCCESS) {
          BOOST_LOG(debug) << "UPnP IPv6 firewall control available. Firewall is "sv
                           << (firewallEnabled ? "enabled"sv : "disabled"sv)
                           << ", pinhole is "sv
                           << (pinholeAllowed ? "allowed"sv : "disallowed"sv);

          if (pinholeAllowed) {
            // Create pinholes for each port
            auto mapping_period = std::to_string(PORT_MAPPING_LIFETIME.count());
            auto shutdown_event = mail::man->event<bool>(mail::shutdown);

            for (auto it = std::begin(mappings); it != std::end(mappings) && !shutdown_event->peek(); ++it) {
              auto mapping = *it;
              char uniqueId[8];

              // Open a pinhole for the LAN port, since there will be no WAN->LAN port mapping on IPv6
              err = UPNP_AddPinhole(urls->controlURL_6FC, data.IPv6FC.servicetype, "", "0", lan_addr.data(), mapping.port.lan.c_str(), mapping.port.proto.c_str(), mapping_period.c_str(), uniqueId);
              if (err == UPNPCOMMAND_SUCCESS) {
                BOOST_LOG(debug) << "Successfully created pinhole for "sv << mapping.port.proto << ' ' << mapping.port.lan;
              } else {
                BOOST_LOG(debug) << "Failed to create pinhole for "sv << mapping.port.proto << ' ' << mapping.port.lan << ": "sv << err;
              }
            }

            return err == 0;
          } else {
            BOOST_LOG(debug) << "IPv6 pinholes are not allowed by the IGD"sv;
            return false;
          }
        } else {
          BOOST_LOG(debug) << "Failed to get IPv6 firewall status: "sv << err;
          return false;
        }
      } else {
        BOOST_LOG(debug) << "IPv6 Firewall Control is not supported by the IGD"sv;
        return false;
      }
    }

    /**
     * @brief Maps a port via UPnP.
     * @param data IGDdatas from UPNP_GetValidIGD()
     * @param urls urls_t from UPNP_GetValidIGD()
     * @param lan_addr Local IP address to map to
     * @param mapping Information about port to map
     * @return `true` on success.
     */
    bool map_upnp_port(const IGDdatas &data, const urls_t &urls, const std::string &lan_addr, const mapping_t &mapping) {
      char intClient[16];
      char intPort[6];
      char desc[80];
      char enabled[4];
      char leaseDuration[16];
      bool indefinite = false;

      // First check if this port is already mapped successfully
      BOOST_LOG(debug) << "Checking for existing UPnP port mapping for "sv << mapping.port.wan;
      auto err = UPNP_GetSpecificPortMappingEntry(
        urls->controlURL,
        data.first.servicetype,
        // In params
        mapping.port.wan.c_str(),
        mapping.port.proto.c_str(),
        nullptr,
        // Out params
        intClient,
        intPort,
        desc,
        enabled,
        leaseDuration
      );
      if (err == 714) {  // NoSuchEntryInArray
        BOOST_LOG(debug) << "Mapping entry not found for "sv << mapping.port.wan;
      } else if (err == UPNPCOMMAND_SUCCESS) {
        // Some routers change the description, so we can't check that here
        if (!std::strcmp(intClient, lan_addr.c_str())) {
          if (std::atoi(leaseDuration) == 0) {
            BOOST_LOG(debug) << "Static mapping entry found for "sv << mapping.port.wan;

            // It's a static mapping, so we're done here
            return true;
          } else {
            BOOST_LOG(debug) << "Mapping entry found for "sv << mapping.port.wan << " ("sv << leaseDuration << " seconds remaining)"sv;
          }
        } else {
          // ARBS-H 0.3.0 (P6): the other device's address is not logged, only its kind.
          const auto other = arbs::netpolicy::parse_v4(intClient);
          BOOST_LOG(warning) << "UPnP conflict detected with another device ("sv
                             << (other ? arbs::netpolicy::to_string(arbs::netpolicy::kind_of_v4(*other)) : "unknown"sv) << ')';

          // Some UPnP IGDs won't let unauthenticated clients delete other conflicting port mappings
          // for security reasons, but we will give it a try anyway.
          err = UPNP_DeletePortMapping(
            urls->controlURL,
            data.first.servicetype,
            mapping.port.wan.c_str(),
            mapping.port.proto.c_str(),
            nullptr
          );
          if (err) {
            BOOST_LOG(error) << "Unable to delete conflicting UPnP port mapping: "sv << err;
            return false;
          }
        }
      } else {
        BOOST_LOG(error) << "UPNP_GetSpecificPortMappingEntry() failed: "sv << err;

        // If we get a strange error from the router, we'll assume it's some old broken IGDv1
        // device and only use indefinite lease durations to hopefully avoid confusing it.
        if (err != 606) {  // Unauthorized
          indefinite = true;
        }
      }

      // Add/update the port mapping
      auto mapping_period = std::to_string(indefinite ? 0 : PORT_MAPPING_LIFETIME.count());
      err = UPNP_AddPortMapping(
        urls->controlURL,
        data.first.servicetype,
        mapping.port.wan.c_str(),
        mapping.port.lan.c_str(),
        lan_addr.data(),
        mapping.description.c_str(),
        mapping.port.proto.c_str(),
        nullptr,
        mapping_period.c_str()
      );

      if (err != UPNPCOMMAND_SUCCESS && !indefinite) {
        // This may be an old/broken IGD that doesn't like non-static mappings.
        BOOST_LOG(debug) << "Trying static mapping after failure: "sv << err;
        err = UPNP_AddPortMapping(
          urls->controlURL,
          data.first.servicetype,
          mapping.port.wan.c_str(),
          mapping.port.lan.c_str(),
          lan_addr.data(),
          mapping.description.c_str(),
          mapping.port.proto.c_str(),
          nullptr,
          "0"
        );
      }

      if (err) {
        BOOST_LOG(error) << "Failed to map "sv << mapping.port.proto << ' ' << mapping.port.lan << ": "sv << err;
        return false;
      }

      BOOST_LOG(debug) << "Successfully mapped "sv << mapping.port.proto << ' ' << mapping.port.lan;
      return true;
    }

    /**
     * @brief Unmaps all ports.
     * @param urls urls_t from UPNP_GetValidIGD()
     * @param data IGDdatas from UPNP_GetValidIGD()
     */
    void unmap_all_upnp_ports(const urls_t &urls, const IGDdatas &data) {
      for (auto it = std::begin(mappings); it != std::end(mappings); ++it) {
        auto status = UPNP_DeletePortMapping(
          urls->controlURL,
          data.first.servicetype,
          it->port.wan.c_str(),
          it->port.proto.c_str(),
          nullptr
        );

        if (status && status != 714) {  // NoSuchEntryInArray
          BOOST_LOG(warning) << "Failed to unmap "sv << it->port.proto << ' ' << it->port.lan << ": "sv << status;
        } else {
          BOOST_LOG(debug) << "Successfully unmapped "sv << it->port.proto << ' ' << it->port.lan;
        }
      }
    }

    /**
     * @brief Maintains UPnP port forwarding rules
     */
    void upnp_thread_proc() {
      platf::set_thread_name("upnp");
      auto shutdown_event = mail::man->event<bool>(mail::shutdown);
      bool mapped = false;
      IGDdatas data;
      urls_t mapped_urls;
      auto address_family = net::af_from_enum_string(config::sunshine.address_family);

      // Refresh UPnP rules every few minutes. They can be lost if the router reboots,
      // WAN IP address changes, or various other conditions.
      do {
        int err = 0;
        device_t device {upnpDiscover(2000, nullptr, nullptr, 0, IPv4, 2, &err)};
        if (!device || err) {
          BOOST_LOG(warning) << "Couldn't discover any IPv4 UPNP devices"sv;
          g_last_status.set({arbs::netpolicy::igd_e::none, 0, (int) mappings.size()});
          mapped = false;
          continue;
        }

        for (auto dev = device.get(); dev != nullptr; dev = dev->pNext) {
          BOOST_LOG(debug) << "Found device: "sv << dev->descURL;
        }

        std::array<char, INET6_ADDRESS_STRLEN> lan_addr;
        std::array<char, INET6_ADDRESS_STRLEN> wan_addr;

        urls_t urls;
        auto status = upnp::UPNP_GetValidIGDStatus(device, &urls, &data, lan_addr, &wan_addr);
        // ARBS-H 0.3.0 (S2): only the kind of the external address is kept; the text is cleared right away.
        arbs::netpolicy::upnp_status_t last;
        last.igd = status_kind(status);
        last.mapped_total = (int) mappings.size();
        last.wan_kind = arbs::netpolicy::wan_kind_of(std::string_view {wan_addr.data()});
        wan_addr.fill('\0');
        if (!is_valid_igd(status)) {
          BOOST_LOG(error) << status_string(status);
          g_last_status.set(last);
          mapped = false;
          continue;
        }

        std::string lan_addr_str {lan_addr.data()};

        BOOST_LOG(debug) << "Found valid IGD device: "sv << urls->rootdescURL;

        for (auto it = std::begin(mappings); it != std::end(mappings) && !shutdown_event->peek(); ++it) {
          if (map_upnp_port(data, urls, lan_addr_str, *it)) {
            ++last.mapped_ok;
          }
        }

        if (!mapped) {
          // ARBS-H 0.3.0 (P6): no LAN or router address in the log, only the counts.
          BOOST_LOG(info) << "Completed UPnP port mappings ("sv << last.mapped_ok << '/' << last.mapped_total << ')';
        }

        // If we are listening on IPv6 and the IGD has an IPv6 firewall enabled, try to create IPv6 firewall pinholes
        if (address_family == net::af_e::BOTH) {
          const bool pinholes = create_ipv6_pinholes();
          last.ipv6_pinhole = pinholes ? arbs::netpolicy::pinhole_e::ok : arbs::netpolicy::pinhole_e::failed;
          if (pinholes && !mapped) {
            // Only log the first time through
            BOOST_LOG(info) << "Successfully opened IPv6 pinholes on the IGD"sv;
          }
        }
        g_last_status.set(last);

        mapped = true;
        mapped_urls = std::move(urls);
      } while (!shutdown_event->view(REFRESH_INTERVAL));

      if (mapped) {
        // Unmap ports upon termination
        BOOST_LOG(info) << "Unmapping UPNP ports..."sv;
        unmap_all_upnp_ports(mapped_urls, data);
      }
    }

    std::vector<mapping_t> mappings;
    std::thread upnp_thread;
  };

  std::unique_ptr<platf::deinit_t> start() {
    if (!config::sunshine.flags[config::flag::UPNP]) {
      return nullptr;
    }

    return std::make_unique<deinit_t>();
  }

  arbs::netpolicy::upnp_status_t last_status() {
    return g_last_status.get();
  }
}  // namespace upnp
