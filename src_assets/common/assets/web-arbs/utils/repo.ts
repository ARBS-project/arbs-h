// Copied from ../web/utils/repo.ts (ARBS-H UI1b).
// ARBS-H R1a (D-R1a-11): one place for the GitHub repository the web UI links to and checks for updates.
// Public repository, so no token is needed. Update checks only notify and link to the release page.
export const REPO_OWNER = 'arbs-project';
export const REPO_NAME = 'arbs-h';
export const REPO_PAGE = `https://github.com/${REPO_OWNER}/${REPO_NAME}`;
export const RELEASES_PAGE = `${REPO_PAGE}/releases`;
export const RELEASES_LATEST_PAGE = `${RELEASES_PAGE}/latest`;
export const ISSUES_NEW_PAGE = `${REPO_PAGE}/issues/new/choose`;
export const RELEASES_API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases`;
export const PRODUCT_NAME = 'ARBS-H';
export const ARBS_UPSTREAM_BASE = 'based on Vibepollo 2.18.9 (Nonary) · GPL-3.0';

/** Windows installer asset name for a release tag (leading "v" removed). */
export function windowsSetupAsset(tag: string): string {
  return `arbs-h-${tag.replace(/^v/, '')}-setup.exe`;
}

/** True only for an ARBS-H release page URL. The organization part is compared case-insensitively. */
export function isReleasePageUrl(url: unknown): url is string {
  return typeof url === 'string' && url.toLowerCase().startsWith(`${RELEASES_PAGE.toLowerCase()}/`);
}
