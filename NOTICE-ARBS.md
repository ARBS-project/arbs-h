# NOTICE — ARBS-H

ARBS-H is a modified version of Vibepollo, distributed under the **GNU General Public License v3.0**.
The original [LICENSE](LICENSE) and [NOTICE](NOTICE) files are kept unchanged.

## Upstream chain

| Work | Source | License |
|---|---|---|
| Vibepollo | `Nonary/Vibepollo`, base commit `c286d08628ea059d013e94c65869e4260576d2d0` (2.18.9) | GPL-3.0 |
| Apollo (upstream of Vibepollo) | `ClassicOldSong/Apollo` | GPL-3.0 |
| Sunshine (upstream of Apollo) | `LizardByte/Sunshine` | GPL-3.0 |
| Bundled third-party code | `third-party/` and the upstream `NOTICE` file | their own licenses |

## ApexSenseBridge

The ARBS project refers to [ApexSenseBridge](https://github.com/ReynArts/ApexSenseBridge) (commit `d831575`) for protocol
facts only (APEX HID byte layouts, used in the clients and ARBS Core). **No ApexSenseBridge source code is copied** into
this repository. License note: its `LICENSE` file is GPL-3.0-or-later while its README badge says MIT.

## ARBS modifications

ARBS changes are the commits after the base commit (`git log c286d0862..HEAD`). Files changed by ARBS:

- `src/arbs_haptics_timing.h`, `src/arbs_trigger_status.h` (new)
- `src/config.cpp`, `src/config.h`, `src/network.cpp`, `src/stream.cpp`, `src/update.cpp`, `src/platform/windows/input.cpp`,
  `src/platform/windows/dualsense_usbip_gamepad.cpp`, `src/platform/windows/dualsense_usbip_gamepad.h`
- `src_assets/common/assets/web/public/assets/locale/en.json`, `src_assets/common/assets/web/configs/extendedSettings.ts`,
  `src_assets/common/assets/web/components/layout/UpdateNotice.vue`, `src_assets/common/assets/web-legacy/stores/config.ts`,
  `src_assets/common/assets/web-legacy/views/DashboardView.vue`
- `cmake/targets/windows.cmake`, `cmake/packaging/windows.cmake`, `cmake/packaging/windows_portable.cmake`,
  `.github/workflows/ci-windows.yml`, `docs/configuration.md`
- `tests/CMakeLists.txt`, `tests/unit/test_arbs_haptics_timing.cpp`, `tests/unit/test_arbs_trigger_status.cpp` (new),
  `tests/unit/platform/windows/test_dualsense_usbip_gamepad.cpp`, `tests/integration/test_windows_portable_packaging.py`
- Publication files: `README.md` (new), `README.upstream.md` (original README), `NOTICE-ARBS.md`, `.gitignore` (ARBS block)

Outside this repository, the ARBS-H build applies a patch to the ENet copy inside the `moonlight-common-c` submodule
(precise time). The patch and build scripts are in the `arbs` repository (`build/`).

## Bundled driver: SudoVDA

The installer bundles the SudoVDA virtual display driver (`drivers\sudovda`).

- Project: https://github.com/SudoMaker/SudoVDA. Its README states the license as "MIT and CC0 or Public Domain" for the
  author's changes and refers to Microsoft for the Microsoft code. The repository has no top-level LICENSE file.
- Microsoft code it is based on: https://github.com/microsoft/Windows-driver-samples (Microsoft Public License, MS-PL).
- Binary origin: used unchanged as bundled in Vibepollo 2.18.9 (base commit `c286d086`). Signer: the SudoVDA author, as named
  by the file signature (self-signed certificate, subject a `sudovda` address at the SudoMaker domain `su.mk`, SHA-1
  thumbprint `3C918FC73525AD8B1521B6DB26B71F694277CC49`). The source commit of this binary is not confirmed.

The installer carries the exact statement and the full MS-PL text in its `licenses` folder.

## Bundled tool: nefcon

`drivers\sudovda\nefconc.exe` is nefcon 1.14.0.0 by Nefarius Software Solutions e.U., used by the SudoVDA driver install
script. Source: https://github.com/nefarius/nefcon (release https://github.com/nefarius/nefcon/releases/tag/v1.14.0).
License: MIT, full text in `licenses\nefcon-LICENSE.txt` in the installer.

## Obligations when distributing (GPL-3.0)

Provide the complete corresponding source under the same license (this repository and the build patch/scripts), keep
copyright and license notices, mark modifications, and add no further restrictions.

ARBS is an unofficial open-source project and is not affiliated with or endorsed by Flydigi, Vibepollo, Apollo, Sunshine or Moonlight.
