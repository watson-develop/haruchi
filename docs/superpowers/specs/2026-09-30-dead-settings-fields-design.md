# 읽지 않는 Settings 필드 정리 — 설계

2026-09-30. 상태: 적대적 리뷰 1라운드 반영(합의 — blocker·major 0, minor 5건 반영). 선행: `2026-09-30-retire-paper-sheet-design.md`.

## 1. 왜

종이 은퇴로 `Settings`의 종이 필드를 읽는 코드가 0이 됐다. 이미 죽어 있던 필드도 있다.
사용자 결정: **읽지 않는 필드 전부**를 **두 단계로** 정리한다.

| 필드            | 원래 용도             | 옛 `validateBackup`이 요구? |
| --------------- | --------------------- | --------------------------- |
| `verticalCount` | 세로셈 문항 수(8/6)   | **예** — 숫자여야 함        |
| `inverseCount`  | □ 채우기 문항 수      | **예**                      |
| `childName`     | 이름(2026-08-04 사망) | **예** — 문자열이어야 함    |
| `friendNames`   | 문장제 이름           | **예** — 문자열 배열        |
| `schemaVersion` | 갱신 안 되는 사본     | 아니오                      |
| `algoVersion`   | 쓰이기만 함           | 아니오                      |

## 2. 호환 제약 — 왜 두 단계인가

- pull은 서버 settings를 `validateBackup`으로 검증하고, 실패하면 적용하지 않고 「읽지 못한
  서버 기록」 알림을 띄운다(`sync.ts` meta pull·스냅샷 복구).
- settings 병합은 객체 통째 LWW다(`merge.ts`의 `mergeMeta`). 네 필드가 없는 settings가 한 번
  이기면 서버 payload에서 그 키가 사라진다.
- PWA는 다시 열어야 업데이트된다. 업데이트 전 기기(옛 검증기)가 키 없는 서버 settings를 받으면
  업데이트될 때까지 settings 동기화를 거부한다.

그래서 **옛 검증기가 요구하는 네 필드는 서버 payload에서 당장 사라지면 안 된다.** 요구하지
않는 두 필드는 이번에 완전히 지워도 된다.

## 3. 1단계(이번 배포)

1. `types.ts`의 `Settings` 타입에서 **여섯 필드 모두 제거.** 앱 코드는 어느 것도 읽지 않는다
2. `DEFAULT_SETTINGS`에서 여섯 필드 제거
3. 옛 검증기용 네 필드는 `types.ts`의 **함수** `legacySettings()`가 매번 새 객체로 돌려준다:
   `{ childName: '', friendNames: [], verticalCount: 8, inverseCount: 2 }`. 상수가 아니라 함수인
   이유: 상수를 스프레드하면 `friendNames` 배열이 모든 기기 메타에 공유된다(지금 `defaultMeta`
   주석이 경고하는 결함). `db.ts`의 `defaultMeta()`가 `{ ...DEFAULT_SETTINGS, ...legacySettings() }`로
   섞는다(런타임 객체에는 있고 타입에는 없다 — 옛 기기 호환 전용이라는 뜻). 타입 `Settings`로
   받는 객체에 스프레드로 여분 키를 넣는 것은 excess-property 검사 대상이 아니라 컴파일된다
4. `validateBackup`에서 네 필드 검사 **삭제**(존재도 형식도 보지 않는다 — 읽는 곳이 없으므로
   형식 검사가 막을 해가 없다). 이로써 새 코드는 키가 있든 없든 받는다. 대신 **통과시킨
   meta의 settings 밑에 `legacySettings()`를 깐다**(`{ ...legacySettings(), ...s }`) — 가져오기
   (`manage.ts` → `replaceAll` → 서버 교체)와 스냅샷 복구가 이 반환값을 그대로 서버로 올리므로,
   손으로 고친 키 없는 파일이 1단계 불변식을 뚫는 구멍을 여기 한 곳에서 막는다. 키가 이미 있으면
   그 값이 이긴다(스프레드 순서)
5. 기존 기기의 IndexedDB·서버 payload에 남은 여섯 키는 **건드리지 않는다.** settings는
   통째로 스프레드되어 저장·push되므로 키가 그대로 실려 다닌다. 마이그레이션 없음
6. `schemaVersion`·`algoVersion`은 새 기기(`defaultMeta`)에서만 사라진다. 옛 검증기가 요구하지
   않으므로 서버 payload에서 빠져도 무해하다

**1단계의 불변식:** 모든 기기의 새 `defaultMeta`와 기존 저장본이 네 레거시 키를 계속 갖는다
→ 서버 payload에 네 키가 항상 있다 → 옛 검증기가 거부하지 않는다.

`meta_guard_stamp` 트리거(settings가 값으로 바뀌는데 `settings_at`이 전진하지 않으면 거부):
기존 기기의 저장본은 키가 그대로라 payload가 바뀌지 않는다. 새 기기·초기화는 원래 새 스탬프로
올라간다. 트리거 충돌 없음.

## 4. 2단계(나중 — 이번 범위 아님)

조건: 모든 등록 기기가 1단계 이상으로 업데이트됐음. 앱 버전을 보고하는 신호가 없으므로
(`devices`에는 `last_seen_at`뿐) 기준은 **`devices`의 모든 활성 행이 1단계 배포 시각 이후의
`last_seen_at`을 가진다**로 둔다(SQL 한 줄로 확인). 그다음 각 기기에서 업데이트 배너를 받았는지
아빠가 한 번 본다. 그러면 `LEGACY_SETTINGS`와 `defaultMeta`의 스프레드를 지운다. 이때도
기존 저장본의 키는 남지만 무해하다(새 검증기는 보지 않는다). HANDOFF에 후속 작업으로 적는다.

## 5. 테스트

- 새 테스트(RED 먼저): `validateBackup`은 settings에 네 필드가 **없어도** 통과한다
- 새 테스트(RED 먼저): 네 필드가 없는 백업을 `validateBackup`에 넣으면 반환 meta의 settings가
  네 키를 갖는다. 있는 키는 원래 값이 이긴다
- 새 테스트: `mergeMeta`가 settings의 모르는 키를 결과에 보존한다(1단계 불변식이 기대는 성질 —
  나중에 누가 "아는 필드만 남기기"를 하면 여기서 빨개진다)
- 새 테스트: `defaultMeta()`를 두 번 부르면 `friendNames` 배열이 서로 다르다(`db.test.ts` ~205 확장)
- 새 테스트: `defaultMeta()`의 settings가 네 레거시 키를 갖고, 옛 검증 규칙(네 필드 형식)을
  만족한다 — 1단계 불변식의 기계 검사. 옛 규칙을 테스트 안에 한 번 적어 둔다
- 삭제: `backup.test.ts`의 `verticalCount가 숫자가 아니면` 거부 케이스
- 수정: `db.test.ts`가 settings LWW를 검사하려고 `childName`을 임의 필드로 쓰는 곳은
  `sprintCount`로 바꾼다. `friendNames` 공유 배열 테스트는 `LEGACY_SETTINGS`의 새 배열
  보장으로 옮긴다. `merge.test.ts`의 무작위 settings 생성기, `report.test.ts`·
  `backup.test.ts`의 필드 사용도 정리. `db.test.ts` ~92·~201의 `verticalCount` 단언은 삭제
- 주석: `types.ts` ~130의 「`validateBackup`이 형식을 검사하므로」, `sync.ts` ~885의 「`validateBackup`이
  부재를 거부한다」(`lastExportedAt`에 대해서는 여전히 참 — 문장이 그 필드만 말하는지 확인)
- 변이 검증: `defaultMeta`에서 `LEGACY_SETTINGS` 스프레드를 빼면 불변식 테스트만 빨개지는지

## 6. 문서

- CLAUDE.md: 「`Settings.childName`·`friendNames`와 종이 설정들은 읽지 않는 죽은 필드」 문장을
  「`Settings`에 없다 — 옛 기기 호환용 레거시 키만 `LEGACY_SETTINGS`로 쓴다(2단계에서 제거)」로.
  「`Settings.schemaVersion`은 읽지 않는 죽은 필드다」 문장은 「없어졌다 — 버전의 주인은
  backup.ts」로
- HANDOFF: 2단계를 후속 작업에 추가
- PRD: 사용자 정책 변화 없음 — 갱신하지 않는다

## 7. 배포

main 직접, 커밋 하나(단독 배포 가능).
