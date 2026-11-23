// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * @file src/arbs_startup_errors.h
 * @brief ARBS-H R1a-fix1 (F5/F6): log startup exceptions instead of a silent std::terminate.
 *
 * ARBS-H 0.1.0 installed the credentials files with an ACL nobody could open. The HTTPS server
 * constructor (Simple-Web-Server server_https.hpp, use_certificate_chain_file) threw
 * boost::system::system_error [system:5] on the confighttp thread, nothing caught it, and the
 * process ended with only libstdc++'s "terminate called ..." on stderr (docs/analysis/R1a-fix1.md).
 *
 * - make_tls_server(): constructs a TLS server (its constructor loads the certificate and key
 *   files) and turns a thrown exception into one message with both paths, what() and the error
 *   code. The certificate/key CONTENTS are never part of the message.
 * - describe_current(): text for a std::terminate handler (current exception what() + code).
 */
#pragma once

#include <boost/system/system_error.hpp>
#include <exception>
#include <memory>
#include <string>
#include <string_view>
#include <system_error>

namespace arbs::startup_errors {

  /// what() plus " (code <category>:<value>)" for boost/std system_error (incl. filesystem errors).
  inline std::string describe(const std::exception &e) {
    std::string text = e.what();
    if (const auto *b = dynamic_cast<const boost::system::system_error *>(&e)) {
      text += " (code ";
      text += b->code().category().name();
      text += ':';
      text += std::to_string(b->code().value());
      text += ')';
    } else if (const auto *s = dynamic_cast<const std::system_error *>(&e)) {
      text += " (code ";
      text += s->code().category().name();
      text += ':';
      text += std::to_string(s->code().value());
      text += ')';
    }
    return text;
  }

  /// For a std::terminate handler: describes std::current_exception(), if any.
  inline std::string describe_current() {
    const auto current = std::current_exception();
    if (!current) {
      return "std::terminate called without an active exception";
    }
    try {
      std::rethrow_exception(current);
    } catch (const std::exception &e) {
      return "Unhandled exception: " + describe(e);
    } catch (...) {
      return "Unhandled exception of a non-standard type";
    }
  }

  /// One fatal log line: component, certificate and key PATHS, what() and code.
  inline std::string tls_load_failure(std::string_view component, const std::string &cert, const std::string &pkey, const std::exception &e) {
    std::string text(component);
    text += ": cannot load TLS certificate/key [";
    text += cert;
    text += "], [";
    text += pkey;
    text += "]: ";
    text += describe(e);
    return text;
  }

  /**
   * Constructs Server(cert, pkey). Returns nullptr and sets @p error when the constructor throws
   * (unreadable, missing or invalid certificate/key file). Server is not copied or moved.
   */
  template<class Server>
  std::unique_ptr<Server> make_tls_server(std::string_view component, const std::string &cert, const std::string &pkey, std::string &error) {
    try {
      return std::make_unique<Server>(cert, pkey);
    } catch (const std::exception &e) {
      error = tls_load_failure(component, cert, pkey, e);
    } catch (...) {
      error = std::string(component) + ": cannot load TLS certificate/key [" + cert + "], [" + pkey + "]: non-standard exception";
    }
    return nullptr;
  }

}  // namespace arbs::startup_errors
