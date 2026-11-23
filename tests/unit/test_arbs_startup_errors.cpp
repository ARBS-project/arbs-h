// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * @file tests/unit/test_arbs_startup_errors.cpp
 * @brief ARBS-H R1a-fix1 F5/F6: a TLS certificate that cannot be loaded becomes one message
 *        (paths + what() + code) instead of std::terminate (docs/analysis/R1a-fix1.md section 6).
 *
 * Uses the real Simple-Web-Server HTTPS server type of confighttp (its constructor calls
 * use_certificate_chain_file / use_private_key_file, server_https.hpp:41-42). Nothing listens:
 * only the constructor runs. On Windows the 0.1.0 failure is reproduced with a temporary file
 * whose DACL is protected and empty (what 0.1.0's icacls left on the credentials files).
 */
#include "src/arbs_startup_errors.h"

#include <Simple-Web-Server/server_https.hpp>
#include <boost/system/system_error.hpp>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <gtest/gtest.h>
#include <iostream>
#include <memory>
#include <openssl/evp.h>
#include <openssl/pem.h>
#include <openssl/x509.h>
#include <string>

#ifdef _WIN32
  #include <aclapi.h>
  #include <windows.h>
#endif

namespace {
  namespace se = arbs::startup_errors;
  using https_server_t = SimpleWeb::Server<SimpleWeb::HTTPS>;  // same type as confighttp.cpp
  namespace fs = std::filesystem;

  class ScratchDir {
  public:
    ScratchDir() {
      const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
      path_ = fs::temp_directory_path() / ("arbs-startup-errors-" + std::to_string(stamp));
      fs::create_directories(path_);
    }

    ~ScratchDir() {
      std::error_code ec;
      fs::remove_all(path_, ec);
    }

    const fs::path &path() const {
      return path_;
    }

  private:
    fs::path path_;
  };

  // Self-signed test certificate + key written as PEM (no secret: generated per run, deleted after).
  bool write_test_credentials(const fs::path &cert, const fs::path &key) {
    EVP_PKEY *pkey = EVP_RSA_gen(2048);
    if (!pkey) {
      return false;
    }
    X509 *x509 = X509_new();
    bool ok = x509 && ASN1_INTEGER_set(X509_get_serialNumber(x509), 1) && X509_gmtime_adj(X509_getm_notBefore(x509), 0) &&
              X509_gmtime_adj(X509_getm_notAfter(x509), 3600) && X509_set_pubkey(x509, pkey);
    if (ok) {
      X509_NAME *name = X509_NAME_new();
      ok = name && X509_NAME_add_entry_by_txt(name, "CN", MBSTRING_ASC, reinterpret_cast<const unsigned char *>("arbs-h-test"), -1, -1, 0) &&
           X509_set_subject_name(x509, name) && X509_set_issuer_name(x509, name) && X509_sign(x509, pkey, EVP_sha256()) > 0;
      X509_NAME_free(name);
    }
    if (ok) {
      FILE *f = std::fopen(cert.string().c_str(), "wb");
      ok = f && PEM_write_X509(f, x509);
      if (f) {
        std::fclose(f);
      }
    }
    if (ok) {
      FILE *f = std::fopen(key.string().c_str(), "wb");
      ok = f && PEM_write_PrivateKey(f, pkey, nullptr, nullptr, 0, nullptr, nullptr);
      if (f) {
        std::fclose(f);
      }
    }
    X509_free(x509);
    EVP_PKEY_free(pkey);
    return ok;
  }

  bool contains(const std::string &text, const std::string &part) {
    return text.find(part) != std::string::npos;
  }
}  // namespace

TEST(ArbsStartupErrors, DescribeBoostSystemErrorAddsCode) {
  const boost::system::system_error e(boost::system::error_code(5, boost::system::system_category()), "use_certificate_chain_file");
  const auto text = se::describe(e);
  EXPECT_TRUE(contains(text, "use_certificate_chain_file")) << text;
  EXPECT_TRUE(contains(text, "(code system:5)")) << text;
}

TEST(ArbsStartupErrors, DescribeFilesystemErrorAddsCode) {
  const std::filesystem::filesystem_error e("create_directories", fs::path("x"), std::make_error_code(std::errc::permission_denied));
  const auto text = se::describe(e);
  EXPECT_TRUE(contains(text, "create_directories")) << text;
  EXPECT_TRUE(contains(text, "(code generic:" + std::to_string(static_cast<int>(std::errc::permission_denied)) + ")")) << text;
}

TEST(ArbsStartupErrors, DescribePlainExceptionHasNoCode) {
  const std::runtime_error e("plain");
  EXPECT_EQ(se::describe(e), "plain");
}

TEST(ArbsStartupErrors, DescribeCurrentForTerminateHandler) {
  EXPECT_EQ(se::describe_current(), "std::terminate called without an active exception");
  try {
    throw boost::system::system_error(boost::system::error_code(5, boost::system::system_category()), "use_certificate_chain_file");
  } catch (...) {
    const auto text = se::describe_current();
    EXPECT_EQ(text.rfind("Unhandled exception: use_certificate_chain_file", 0), 0u) << text;
    EXPECT_TRUE(contains(text, "(code system:5)")) << text;
  }
  try {
    throw 42;
  } catch (...) {
    EXPECT_EQ(se::describe_current(), "Unhandled exception of a non-standard type");
  }
}

TEST(ArbsStartupErrors, MissingCertificateIsReportedNotThrown) {
  ScratchDir dir;
  const auto cert = (dir.path() / "credentials" / "cacert.pem").string();
  const auto key = (dir.path() / "credentials" / "cakey.pem").string();
  std::string error;
  std::unique_ptr<https_server_t> server;
  EXPECT_NO_THROW(server = se::make_tls_server<https_server_t>("confighttp", cert, key, error));
  EXPECT_EQ(server, nullptr);
  EXPECT_EQ(error.rfind("confighttp: cannot load TLS certificate/key [" + cert + "], [" + key + "]: ", 0), 0u) << error;
  EXPECT_TRUE(contains(error, "use_certificate_chain_file")) << error;
  EXPECT_TRUE(contains(error, "(code ")) << error;
}

TEST(ArbsStartupErrors, ValidCertificateCreatesServer) {
  ScratchDir dir;
  const auto cert = dir.path() / "cacert.pem";
  const auto key = dir.path() / "cakey.pem";
  ASSERT_TRUE(write_test_credentials(cert, key));
  std::string error;
  const auto server = se::make_tls_server<https_server_t>("confighttp", cert.string(), key.string(), error);
  EXPECT_NE(server, nullptr);
  EXPECT_TRUE(error.empty()) << error;
}

#ifdef _WIN32
// The 0.1.0 failure: the certificate file exists but its DACL is protected and has no ACE.
TEST(ArbsStartupErrors, UnreadableCertificateGivesAccessDeniedMessage) {
  ScratchDir dir;
  const auto cert = dir.path() / "cacert.pem";
  const auto key = dir.path() / "cakey.pem";
  ASSERT_TRUE(write_test_credentials(cert, key));

  ACL empty_acl;
  ASSERT_TRUE(InitializeAcl(&empty_acl, sizeof(empty_acl), ACL_REVISION));
  const auto wide = cert.wstring();
  ASSERT_EQ(SetNamedSecurityInfoW(const_cast<LPWSTR>(wide.c_str()), SE_FILE_OBJECT, DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION, nullptr, nullptr, &empty_acl, nullptr), static_cast<DWORD>(ERROR_SUCCESS));

  std::string error;
  std::unique_ptr<https_server_t> server;
  EXPECT_NO_THROW(server = se::make_tls_server<https_server_t>("nvhttp", cert.string(), key.string(), error));
  EXPECT_EQ(server, nullptr);
  EXPECT_EQ(error.rfind("nvhttp: cannot load TLS certificate/key [" + cert.string() + "]", 0), 0u) << error;
  EXPECT_TRUE(contains(error, "use_certificate_chain_file")) << error;
  EXPECT_TRUE(contains(error, "(code system:5)")) << error;
  EXPECT_FALSE(contains(error, "BEGIN")) << "certificate/key contents must never be in the message";
  std::cout << "fatal line that nvhttp/confighttp would log: " << error << '\n';

  // Owner keeps WRITE_DAC: empty explicit DACL + inheritance again (= the 0.1.1 /reset result) so the
  // same server now loads, and the scratch folder can be removed.
  ASSERT_EQ(SetNamedSecurityInfoW(const_cast<LPWSTR>(wide.c_str()), SE_FILE_OBJECT, DACL_SECURITY_INFORMATION | UNPROTECTED_DACL_SECURITY_INFORMATION, nullptr, nullptr, &empty_acl, nullptr), static_cast<DWORD>(ERROR_SUCCESS));
  error.clear();
  EXPECT_NE(se::make_tls_server<https_server_t>("nvhttp", cert.string(), key.string(), error), nullptr) << error;
}
#endif
