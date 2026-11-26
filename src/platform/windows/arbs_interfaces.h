// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * @file src/platform/windows/arbs_interfaces.h
 * @brief ARBS-H 0.3.0 (S1): addresses of this PC's network adapters for GET /api/network/diagnostics.
 */
#pragma once

#include "src/arbs_network_policy.h"

#include <vector>

namespace platf {
  /**
   * @brief Addresses of the adapters that are up (loopback and "other" kinds left out). Defined in misc.cpp.
   * @details Kind + address text + "looks like Tailscale". The adapter name is read only to decide
   * tailscale_like and is never returned or logged. Nothing here is logged.
   */
  std::vector<arbs::netpolicy::interface_t> arbs_interface_addresses();
}  // namespace platf
