// ARBS-H UI1b: tier-1 scope (docs/UI1_DECISIONS.md "1차 (77)") mapped to ARBS WebUI cards.
// Source: docs/analysis/UI1b.md §2-3. Every ID here must appear as data-feature="<ID>" in the
// card's view (or a shared component); scripts/features.test.ts checks this both ways.
// Tier 2, advanced and excluded items are NOT part of this UI (they stay in the classic UI),
// except the ones promoted by a later decision (PROMOTED below, e.g. H021 statistics).

export type CardId = 'S' | 'D' | 'C' | 'V' | 'A' | 'T' | 'U' | 'X' | 'M';

export interface FeatureEntry {
  id: string;
  card: CardId;
  /** Source files (relative to web-arbs) that carry data-feature="<id>". */
  files: string[];
  /** Short description of where it is on screen (Korean, for the evidence table). */
  place: string;
  /** Set when the ID was moved into this UI later from another tier (decision record). */
  promoted?: string;
}

export const CARD_LABELS: Record<CardId, string> = {
  S: '상태',
  D: '기기 연결',
  C: 'ARBS 컨트롤러',
  V: '화면(디스플레이)',
  A: '앱',
  T: '문제 해결',
  U: '계정·화면 모양',
  X: '공통',
  M: '통계',
};

const S = 'views/StatusView.vue';
const D = 'views/DevicesView.vue';
const P = 'views/PairView.vue';
const C = 'views/ControllerView.vue';
const V = 'views/DisplayView.vue';
const A = 'views/AppsView.vue';
const T = 'views/TroubleshootView.vue';
const U = 'views/AccountView.vue';
const SHELL = 'App.vue';
const NAV = 'components/NavMenu.vue';
const NAVDATA = 'logic/nav.ts';
const M = 'views/StatsView.vue';
/** H021 (EA-H021-R-02 / R-03): statistics moved from UI1 tier 2 (and 2 advanced items) to this UI. */
const H021 = 'EA-H021-R-02';
const TOP = 'components/TopBar.vue';
const SAVE = 'components/SaveBar.vue';
const LOGIN = 'components/LoginOverlay.vue';
const OFF = 'components/OfflineOverlay.vue';
const FOOT = 'components/FooterNotice.vue';

export const FEATURES: FeatureEntry[] = [
  { id: 'H-NAV-01', card: 'S', files: [NAVDATA], place: '메뉴 "상태" → /arbs/' },
  { id: 'H-NAV-02', card: 'A', files: [NAVDATA], place: '메뉴 "앱" → /arbs/apps' },
  { id: 'H-NAV-03', card: 'D', files: [NAVDATA], place: '메뉴 "기기 연결" → /arbs/devices' },
  { id: 'H-NAV-06', card: 'X', files: [TOP], place: '상단 "전체 설정(기존 화면)" 링크 /settings' },
  { id: 'H-NAV-07', card: 'T', files: [NAVDATA], place: '메뉴 "문제 해결" → /arbs/troubleshoot' },
  { id: 'H-NAV-08', card: 'U', files: [U], place: '계정 카드 "로그아웃" 버튼' },
  { id: 'H-NAV-10', card: 'X', files: [SAVE], place: '저장 막대 상태(저장 중·저장됨·지연·다시 시작 필요)' },
  { id: 'H-NAV-11', card: 'U', files: [U, TOP], place: '상단 고정 테마 버튼 + 계정 카드 화면 모양' },
  { id: 'H-NAV-12', card: 'U', files: [LOGIN], place: '로그인 덮개' },
  { id: 'H-NAV-13', card: 'X', files: [OFF], place: '연결 끊김 덮개(하트비트 /api/configLocale)' },
  { id: 'H-HOME-04', card: 'X', files: [TOP], place: '상단 "기존 화면" /?ui=classic · "v2 화면" /v2/' },
  { id: 'H-HOME-05', card: 'V', files: [V], place: '화면 카드 "가상 디스플레이 끝내기(복구)"' },
  { id: 'H-HOME-07', card: 'S', files: [S], place: '상태 카드 현재 버전' },
  { id: 'H-HOME-08', card: 'S', files: [S], place: '상태 카드 "업데이트 확인"·새 버전 있음' },
  { id: 'H-HOME-09', card: 'S', files: [S], place: '새 버전 배너 "숨기기"' },
  { id: 'H-HOME-11', card: 'S', files: [S], place: '시작 오류(Fatal) 줄 → 문제 해결 로그' },
  { id: 'H-HOME-17', card: 'X', files: [FOOT], place: '바닥 "링크·자료"' },
  { id: 'H-APP-01', card: 'A', files: [A], place: '앱 목록·개수' },
  { id: 'H-APP-02', card: 'A', files: [A], place: '"앱 추가" 버튼' },
  { id: 'H-APP-05', card: 'A', files: [A], place: '앱 행(이름·표지·배지·실행·닫기·순서)' },
  { id: 'H-APP-08', card: 'A', files: [A], place: '"편집"·"삭제" 버튼' },
  { id: 'H-APP-09', card: 'A', files: [A], place: '편집칸 "이름"' },
  { id: 'H-APP-10', card: 'A', files: [A], place: '편집칸 "명령"' },
  { id: 'H-APP-22', card: 'A', files: [A, C], place: '편집칸 "DualSense HD 햅틱"(컨트롤러 카드에서 링크)' },
  { id: 'H-CLI-03', card: 'D', files: [P], place: '새 기기 연결(PIN·이름)' },
  { id: 'H-CLI-06', card: 'D', files: [D], place: '기기 목록 연결됨/오프라인·끊기·편집·지우기' },
  { id: 'H-CLI-08', card: 'D', files: [D], place: '선택한 기기 "권한"' },
  { id: 'H-STAT-05', card: 'S', files: [S, M], place: '활성 스트리밍 세션(상태 카드) + 통계 "지금 스트리밍"' },
  { id: 'H-SET-002', card: 'V', files: [V], place: '"가상 디스플레이 모드" 선택' },
  { id: 'H-SET-003', card: 'V', files: [V], place: '"해상도 맞추기" 선택' },
  { id: 'H-SET-065', card: 'C', files: [C], place: '"게임패드 입력" 스위치' },
  { id: 'H-SET-067', card: 'C', files: [C], place: '"진동 전달" 스위치' },
  { id: 'H-SET-069', card: 'C', files: [C], place: '"가상 게임패드 종류" + usbip_ds5 아니면 경고' },
  { id: 'H-SET-071', card: 'C', files: [C], place: '"HD 햅틱 세기" 0.0~4.0' },
  { id: 'H-SET-203', card: 'C', files: [C], place: '"고급" 접힘 안 "정밀 ENet 시계" 스위치' },
  { id: 'H-SET-204', card: 'C', files: [C], place: '"트리거 상태" h2b/enabled/disabled' },
  { id: 'H-SET-205', card: 'C', files: [C], place: '게임패드 종류 칸의 DualSense(usbip_ds5) 선택지' },
  { id: 'H-SET-208', card: 'X', files: [SAVE], place: '저장 막대 안내(명시 저장·적용·다시 시작)' },
  { id: 'H-SET-209', card: 'X', files: [SAVE], place: '저장 막대 설정 찾기·다시 불러오기·되돌리기·저장·다시 시작 필요' },
  { id: 'H-TRBL-01', card: 'T', files: [T], place: '"강제 종료"' },
  { id: 'H-TRBL-02', card: 'T', files: [T], place: '"ARBS-H 다시 시작"' },
  { id: 'H-TRBL-04', card: 'T', files: [T], place: '"로그 내보내기"' },
  { id: 'H-TRBL-07', card: 'T', files: [T], place: '로그 보기(찾기·최신으로)' },
  { id: 'H-AUTH-01', card: 'U', files: [LOGIN], place: '로그인(이름·암호·로그인 유지)' },
  { id: 'H-AUTH-02', card: 'U', files: [LOGIN], place: '첫 계정 만들기' },
  { id: 'H-V2NAV-01', card: 'X', files: [NAV], place: '메뉴 묶음(Browser stream 없음)' },
  { id: 'H-V2NAV-04', card: 'S', files: [S], place: '"호스트 상태 새로 고침" 버튼' },
  { id: 'H-V2NAV-05', card: 'U', files: [U], place: '화면 모양 밝게/어둡게/시스템' },
  { id: 'H-V2NAV-06', card: 'X', files: [TOP], place: '상단 "기존 화면" /?ui=classic' },
  { id: 'H-V2NAV-07', card: 'U', files: [U], place: '로그아웃(H-NAV-08과 한 버튼)' },
  { id: 'H-V2NAV-09', card: 'S', files: [S], place: '"{version} 있음" 알림' },
  { id: 'H-V2OV-02', card: 'S', files: [S], place: '스트리밍 준비됨/확인 필요/스트리밍 중' },
  { id: 'H-V2OV-04', card: 'S', files: [S], place: '경고(앱 실행 중·인코더 확인 실패·부하·데이터 없음)' },
  { id: 'H-V2OV-09', card: 'S', files: [S], place: '설치 버전·버그 신고·업데이트 확인 링크' },
  { id: 'H-V2OV-10', card: 'X', files: [FOOT], place: '바닥 고지 ARBS-H · based on Vibepollo 2.18.9 · GPL-3.0 + 제3자 고지' },
  { id: 'H-V2LIB-03', card: 'A', files: [A], place: '편집·삭제·더 보기·n개 중 m개·기본 앱 되살리기' },
  { id: 'H-V2APP-01', card: 'A', files: [A], place: '앱 추가·저장·목록으로' },
  { id: 'H-V2APP-03', card: 'A', files: [A], place: '명령·표지 경로·표지 고르기·관리자 권한 실행' },
  { id: 'H-V2APP-11', card: 'A', files: [A], place: 'DualSense HD 햅틱(H-APP-22와 한 칸)' },
  { id: 'H-V2DEV-03', card: 'D', files: [D], place: '상태 스트리밍/차단/활성/본 적 없음 + 끊기·지우기·편집' },
  { id: 'H-V2DEV-04', card: 'D', files: [D], place: '기기 이름·절전 허용·권한' },
  { id: 'H-V2PAIR-01', card: 'D', files: [P], place: '기기 연결 화면·"기기 목록으로"' },
  { id: 'H-V2PAIR-03', card: 'D', files: [P], place: '이름·PIN(4자리, 앞 0 보정)·"승인"' },
  { id: 'H-V2PAIR-04', card: 'D', files: [P], place: '연결됨/실패·기기 보기·하나 더' },
  { id: 'H-V2STAT-04', card: 'S', files: [S, M], place: '활성 세션 목록 + "스트림 중지"(상태 카드), 통계 "지금 스트리밍" 숫자' },
  { id: 'H-V2LOG-01', card: 'T', files: [T], place: '실시간 따라가기·멈춤·새로 고침' },
  { id: 'H-V2LOG-02', card: 'T', files: [T], place: '출처·심각도·검색·이전/다음 일치' },
  { id: 'H-V2LOG-03', card: 'T', files: [T], place: '요약(오류·경고·줄 수)·보이는 줄 복사·묶음 받기' },
  { id: 'H-V2SET-01', card: 'X', files: [SAVE], place: '저장 막대(H-SET-209와 하나)' },
  { id: 'H-V2SET-04', card: 'V', files: [V], place: '가상 디스플레이 드라이버 상태 + 디스플레이 상태 초기화' },
  { id: 'H-V2MNT-02', card: 'S', files: [S], place: '펼침 "버전 정보"(버전·플랫폼·브랜치·커밋·출시일·릴리스 노트)' },
  { id: 'H-V2MNT-03', card: 'T', files: [T], place: '로그 묶음·크래시 묶음 받기' },
  { id: 'H-V2MNT-05', card: 'V', files: [V], place: '스냅숏 만들기·바꾸기·지우기, 가상 디스플레이 끝내기' },
  { id: 'H-V2MNT-07', card: 'U', files: [U], place: '비밀번호 바꾸기' },
  { id: 'H-V2MNT-08', card: 'T', files: [T], place: 'Windows와 함께 시작·서비스 시작 방식·"ARBS-H 다시 시작"' },
  { id: 'H-V2AUTH-01', card: 'U', files: [LOGIN], place: '로그인(H-AUTH-01과 하나)' },
  { id: 'H-V2AUTH-02', card: 'U', files: [LOGIN], place: '첫 계정 만들기(H-AUTH-02와 하나)' },
  { id: 'H-STAT-06', card: 'M', files: [M], place: '통계 "최근 세션" 표·"자세히"(샘플 평균·최대)', promoted: H021 },
  { id: 'H-V2STAT-05', card: 'M', files: [M], place: '최근 세션·자세히(H-STAT-06과 한 카드, 차트·내보내기·삭제 없음)', promoted: H021 },
  { id: 'H-STAT-03', card: 'M', files: [M], place: '통계 "호스트 사용량" CPU·GPU·인코더 %', promoted: H021 },
  { id: 'H-V2STAT-02', card: 'M', files: [M], place: '호스트 사용량(H-STAT-03과 한 카드)', promoted: H021 },
  { id: 'H-STAT-02', card: 'M', files: [M], place: '호스트 사용량 수집 꺼짐 안내 한 줄(켜기 버튼 없음)', promoted: H021 },
  { id: 'H-SET-173', card: 'M', files: [M], place: '통계 "기록 설정(고급)" 세션 기록 저장', promoted: H021 },
  { id: 'H-SET-174', card: 'M', files: [M], place: '통계 "기록 설정(고급)" 기록 보관 일수', promoted: H021 },
];

/** Tier-1 IDs of docs/UI1_DECISIONS.md (77); the others were promoted later. */
export const TIER1_FEATURES = FEATURES.filter((f) => !f.promoted);
export const PROMOTED_FEATURES = FEATURES.filter((f) => f.promoted);

/** Card totals from docs/analysis/UI1b.md §2-3 (H-NAV-11 counted under U). */
export const EXPECTED_CARD_COUNTS: Record<CardId, number> = {
  S: 13,
  D: 9,
  C: 7,
  V: 5,
  A: 12,
  T: 10,
  U: 10,
  X: 11,
  M: 7,
};

export const SHELL_FILE = SHELL;
