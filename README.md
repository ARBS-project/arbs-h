# ARBS-H — Host (APEX Remote Bridge STACKON)

> **Unofficial open-source project.** ARBS is not affiliated with, endorsed by, or sponsored by Flydigi.
> It is also not affiliated with the Vibepollo, Apollo, Sunshine or Moonlight projects.
> All product names and trademarks belong to their respective owners. This repository contains no Flydigi logos or images.

## What is this?

ARBS-H is a fork of [Vibepollo](https://github.com/Nonary/Vibepollo) 2.18.9 (a Windows game-streaming host in the
Apollo / Sunshine family). Together with an ARBS client it lets a **Flydigi APEX 6 Pro** controller connected to the
client feel the host game's DualSense output (standard rumble, adaptive-trigger effects and PCM HD haptics).
ARBS-H is a separate product from Vibepollo.

ARBS consists of four repositories in the `arbs-project` organisation:

| Repository | Role |
|---|---|
| `arbs` | Project overview, user guide, download notes, license notices, ARBS Core sources |
| `arbs-h` | Host (this repository, fork of Vibepollo 2.18.9) |
| `arbs-w` | Windows client (fork of moonlight-qt) |
| `arbs-a` | Android client (fork of moonlight-android) |

## Based on

- `Nonary/Vibepollo` commit `c286d0862` (version 2.18.9). The original history is kept; ARBS commits follow it.
- The original README is kept as [README.upstream.md](README.upstream.md); the original `LICENSE` and `NOTICE` files are unchanged.

## Changes from upstream (summary)

- DualSense over USB/IP: haptics timing summary and trigger-status bytes for the client (`src/arbs_haptics_timing.h`,
  `src/arbs_trigger_status.h`, `src/platform/windows/dualsense_usbip_gamepad.*`, `src/stream.cpp`).
- New settings keys `arbs_trigger_status` (default `h2b`) and `arbs_enet_precise_time` (see `docs/configuration.md`).
- Update check off by default (`update_check_interval` 0) and not run at stream start when disabled.
- The legacy process-local haptics tools (`vibepollo_dualsense_haptics.exe`, `vibepollo_dualsense_audio.dll`) are not built
  or packaged by default (CMake option `ARBS_H_LEGACY_HAPTICS_TOOLS`, default `OFF`).
- The ARBS-H build also applies a small patch to the bundled ENet (precise time). That patch and the build scripts will be
  published in the `arbs` repository (`build/`) before any binary release.

The full list of changed files is in [NOTICE-ARBS.md](NOTICE-ARBS.md).

## Caution

ARBS-H is a streaming host: it can install a Windows service and drivers in the same way as Vibepollo. Do not install it
over, or run it at the same time as, an official Vibepollo/Apollo/Sunshine installation unless you know how to switch back.
The portable package runs without installing a service.

Status: **experimental**. What has actually been confirmed on real devices is listed in the `arbs` repository README.

## License

GPL-3.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE). ARBS notices: [NOTICE-ARBS.md](NOTICE-ARBS.md).
Security issues: please use the private reporting described in the `arbs` repository `SECURITY.md`.

---

## 한국어 요약

ARBS-H는 Vibepollo 2.18.9(커밋 `c286d0862`)를 바탕으로 한 호스트 포크이며 Vibepollo와 별개 제품입니다. ARBS 클라이언트와 함께
클라이언트에 연결한 Flydigi APEX 6 Pro에서 호스트 게임의 DualSense 출력(일반 진동·트리거 효과·PCM HD 햅틱)을 느끼게 합니다.
주요 변경: USB/IP DualSense 햅틱 타이밍·트리거 상태 바이트, 설정 키 `arbs_trigger_status`(기본 h2b)·`arbs_enet_precise_time`,
업데이트 확인 기본 꺼짐, 구형 프로세스 로컬 햅틱 도구 기본 제외. 공식 Vibepollo 설치본과 겹쳐 설치·동시 실행하지 마세요.
라이선스 GPL-3.0. 상태: 실험적. **Flydigi와 관련 없는 비공식 오픈소스 프로젝트**이며 Vibepollo·Apollo·Sunshine·Moonlight 프로젝트와도 관련이 없습니다.
