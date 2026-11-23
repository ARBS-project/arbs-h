/**
 * @file tests/unit/platform/windows/test_display_helper_process_match.cpp
 * @brief ARBS-H R1b-fix1 G4: only the helper of this install may be ended. No process is started or ended here.
 */
#include "src/platform/windows/arbs_h_names.h"
#include "src/platform/windows/display_helper_process_match.h"

#include <gtest/gtest.h>

#include <string>

namespace match = display_helper_process_match;

namespace {
  const std::wstring kOwn = L"C:\\Program Files\\ARBS-H\\tools\\sunshine_display_helper.exe";
  constexpr DWORD kSelf = 100;
  constexpr DWORD kOther = 200;
}  // namespace

TEST(DisplayHelperProcessMatch, OwnHelperIsEnded) {
  EXPECT_TRUE(match::should_terminate(kOther, kSelf, kOwn, kOwn));
}

TEST(DisplayHelperProcessMatch, OtherInstallsWithTheSameFileNameAreLeftAlone) {
  for (const wchar_t *path : {
         L"C:\\Vibepollo\\tools\\sunshine_display_helper.exe",
         L"C:\\Apollo\\tools\\sunshine_display_helper.exe",
         L"C:\\Program Files\\Apollo\\tools\\sunshine_display_helper.exe",
         L"D:\\Program Files\\ARBS-H\\tools\\sunshine_display_helper.exe",
       }) {
    EXPECT_FALSE(match::should_terminate(kOther, kSelf, std::wstring(path), kOwn));
  }
}

TEST(DisplayHelperProcessMatch, FolderThatOnlyStartsTheSameIsDifferent) {
  EXPECT_FALSE(match::same_image_path(L"C:\\Program Files\\ARBS-H2\\tools\\sunshine_display_helper.exe", kOwn));
  EXPECT_FALSE(match::same_image_path(L"C:\\Program Files\\ARBS-H\\tools\\sunshine_display_helper.exe.bak", kOwn));
  EXPECT_FALSE(match::same_image_path(L"C:\\Program Files\\ARBS-H\\sunshine_display_helper.exe", kOwn));
  EXPECT_FALSE(match::same_image_path(L"C:\\Program Files\\ARBS-H\\tools\\sub\\sunshine_display_helper.exe", kOwn));
}

TEST(DisplayHelperProcessMatch, CaseIsIgnored) {
  EXPECT_TRUE(match::same_image_path(L"c:\\PROGRAM FILES\\arbs-h\\TOOLS\\Sunshine_Display_Helper.EXE", kOwn));
  EXPECT_TRUE(match::same_image_path(L"C:\\게임\\\u00C9\\a.exe", L"c:\\게임\\\u00E9\\A.EXE"));
}

TEST(DisplayHelperProcessMatch, SeparatorsAndPrefixesAreTheSamePath) {
  EXPECT_TRUE(match::same_image_path(L"C:/Program Files/ARBS-H/tools/sunshine_display_helper.exe", kOwn));
  EXPECT_TRUE(match::same_image_path(L"C:\\Program Files\\\\ARBS-H\\tools\\\\sunshine_display_helper.exe", kOwn));
  EXPECT_TRUE(match::same_image_path(L"C:\\Program Files\\ARBS-H\\.\\tools\\x\\..\\sunshine_display_helper.exe", kOwn));
  EXPECT_TRUE(match::same_image_path(L"\\\\?\\C:\\Program Files\\ARBS-H\\tools\\sunshine_display_helper.exe", kOwn));
}

TEST(DisplayHelperProcessMatch, UnusablePathsNeverMatch) {
  for (const wchar_t *path : {
         L"",
         L"sunshine_display_helper.exe",
         L"tools\\sunshine_display_helper.exe",
         L"C:sunshine_display_helper.exe",
         L"\\Program Files\\ARBS-H\\tools\\sunshine_display_helper.exe",
         L"\\??\\C:\\Program Files\\ARBS-H\\tools\\sunshine_display_helper.exe",
         L"\\\\.\\C:\\Program Files\\ARBS-H\\tools\\sunshine_display_helper.exe",
         L"\\\\host\\share\\ARBS-H\\tools\\sunshine_display_helper.exe",
         L"\\\\?\\UNC\\host\\share\\ARBS-H\\tools\\sunshine_display_helper.exe",
         L"C:\\Program Files\\ARBS-H\\tools\\",
       }) {
    EXPECT_FALSE(match::normalize_image_path(path).has_value());
    EXPECT_FALSE(match::same_image_path(path, path));
    EXPECT_FALSE(match::should_terminate(kOther, kSelf, std::wstring(path), kOwn));
  }
  EXPECT_FALSE(match::normalize_image_path(std::wstring(match::kMaxPathChars, L'a')).has_value());
}

TEST(DisplayHelperProcessMatch, PathLookupFailureMeansNotEnded) {
  EXPECT_FALSE(match::should_terminate(kOther, kSelf, std::nullopt, kOwn));
  EXPECT_FALSE(match::query_process_image_path(nullptr).has_value());
  EXPECT_FALSE(match::should_terminate(kOther, kSelf, match::query_process_image_path(nullptr), kOwn));
}

TEST(DisplayHelperProcessMatch, ThisProcessIsNeverEnded) {
  EXPECT_FALSE(match::should_terminate(kSelf, kSelf, kOwn, kOwn));
}

TEST(DisplayHelperProcessMatch, HelperPathComesFromTheProgramFolder) {
  const auto helper = match::helper_path_for_module(L"C:/Program Files/ARBS-H/sunshine.exe");
  ASSERT_TRUE(helper.has_value());
  EXPECT_EQ(*helper, kOwn);
  EXPECT_FALSE(match::helper_path_for_module(L"sunshine.exe").has_value());
  EXPECT_FALSE(match::helper_path_for_module(L"").has_value());
}

TEST(DisplayHelperProcessMatch, RealQueryReadsThisProcessOnly) {
  const auto image = match::query_process_image_path(GetCurrentProcess());
  ASSERT_TRUE(image.has_value());
  wchar_t module[MAX_PATH] = {};
  ASSERT_GT(GetModuleFileNameW(nullptr, module, MAX_PATH), 0u);
  EXPECT_TRUE(match::same_image_path(*image, module));
  const auto helper = match::current_helper_path();
  ASSERT_TRUE(helper.has_value());
  EXPECT_TRUE(helper->ends_with(L"\\tools\\sunshine_display_helper.exe"));
}

TEST(DisplayHelperProcessMatch, MutexNamesAreArbsHOnly) {
  const std::wstring_view names[] = {ARBS_H_DISPLAY_HELPER_MUTEX_GLOBAL_W, ARBS_H_DISPLAY_HELPER_MUTEX_LOCAL_W, ARBS_H_DISPLAY_HELPER_MUTATION_MUTEX_W};
  for (const auto name : names) {
    EXPECT_NE(name.find(L"ARBS-H"), std::wstring_view::npos);
    EXPECT_EQ(name.find(L"Sunshine"), std::wstring_view::npos);
    EXPECT_EQ(name.find(L"Vibepollo"), std::wstring_view::npos);
    EXPECT_EQ(name.find(L"Apollo"), std::wstring_view::npos);
  }
  EXPECT_TRUE(names[0].starts_with(L"Global\\"));
  EXPECT_TRUE(names[1].starts_with(L"Local\\"));
  EXPECT_TRUE(names[2].starts_with(L"Global\\"));
  EXPECT_NE(names[0].substr(7), names[2].substr(7));
}
