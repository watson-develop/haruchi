# 2학년 2학기 계획 구현 Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 2학기 계획 스펙의 코드 변경(문장제 소재 문형 4개 + 등장인물 개편 + 스트릭 용서 폭)과 문서 산출물을 배포 가능한 5개 커밋으로 만든다.

**Architecture:** 엔진 순수 함수만 건드린다 — `src/engine/word.ts`(문형 카탈로그와 등장인물)와 `src/engine/streak.ts`(상수 하나). 화면·저장소·타입은 무접촉이고, 파생값을 저장하지 않는 이 레포의 원칙 덕에 마이그레이션이 없다. 각 태스크는 그 자체로 배포 가능한 단독 커밋이다.

**Tech Stack:** TypeScript(프레임워크 없음), vitest, prettier. 실행 코드 의존성 0개 유지.

**Spec:** `docs/superpowers/specs/2026-08-26-semester2-plan-design.md`

## Global Constraints

- **모든 npm 명령 전에** `export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"` — 에이전트 셸은 로그인 셸이 아니라 mise를 타지 않는다.
- **`git add .`을 쓰지 않는다.** 명시 경로만 add한다(동시 세션이 있을 수 있다).
- **docs를 커밋하기 전에 반드시 `npm run format`을 돌린다.** `.prettierignore`가 없어 CI가 마크다운까지 검사하고, 문서 포맷 흠 하나로 배포 전체가 막힌다.
- **테스트는 `src/engine/`에만 둔다.** DOM·화면 테스트는 하지 않는다.
- **변이 검증을 습관으로 둘 것**: 구현을 일부러 틀리게 바꿔 그 테스트만 빨개지는지 확인하고 원복한다. 이 레포에서 반복 검출된 결함이 "테스트가 자기가 검사한다고 주장하는 것을 실제로는 검사하지 못함"이다.
- **단일 출처를 복제하지 않는다.** 등장인물 이름은 `word.ts`의 `WORD_NAMES`, 식 id는 `facts.ts`가 유일한 주인이다.
- 커밋 메시지는 `feat:`·`fix:`·`docs:` 규격. main 직접 커밋(각 태스크가 단독 배포 가능).
- 각 태스크 종료 전 `npx prettier --check .` · `npm test` · `npm run build` 세 가지가 모두 통과해야 한다.

---

### Task 1: 스트릭 용서 폭을 이틀로

**Files:**

- Modify: `src/engine/streak.ts:4-5`(상수와 그 주석), `src/engine/streak.ts:17-18`(독스트링)
- Test: `src/engine/streak.test.ts:34-42`(기존 경계 테스트 재작성), 같은 파일에 신규 경계 2개

**Interfaces:**

- Consumes: 없음(이 태스크가 첫 번째다)
- Produces: `sprintStreak(days: Day[], today: string): number`의 동작 변경 — 연속 공백 2일까지 용서, 3일째 리셋. 시그니처는 그대로다.

**배경(스펙 §2-3):** §3 루틴이 토·일 스프린트를 "자유(강요 없음)"로 두는데, 현행 `FORGIVEN_GAPS = 1`이면 주말 이틀을 쉰 아이가 월요일 홈에서 🔥 18일 → 0~1일 리셋을 본다. 스펙 §0의 "부정 신호 금지" 원칙과 충돌한다. 스트릭은 로그에서 매번 재계산되므로 상수만 바꾸면 과거 기록도 소급 재해석된다.

- [ ] **Step 1: 기존 경계 테스트를 새 계약으로 재작성하고, 신규 경계 테스트를 추가한다**

`src/engine/streak.test.ts`의 34~42행에 있는 기존 테스트를 통째로 아래로 바꾼다. 기존 테스트는 이 변경으로 반드시 빨개지므로 재작성이 필수다(남겨 두면 위양성).

바꾸기 전(삭제 대상):

```ts
it('이틀 연속 빠지면 거기서 끊는다', () => {
  const days = [
    day('2026-08-01', true),
    day('2026-08-02', true),
    day('2026-08-09', true),
    day('2026-08-10', true),
  ]
  expect(sprintStreak(days, '2026-08-10')).toBe(2)
})
```

바꾼 뒤(위 블록 자리에 그대로 넣는다):

```ts
it('이틀 연속 빠진 것은 봐준다 — 주말 이틀을 쉬어도 불꽃이 안 꺼진다', () => {
  // 금(07)까지 하고 토·일(08·09) 쉬고 월(10)에 복귀. 공백 2일은 용서 범위다.
  const days = [day('2026-08-06', true), day('2026-08-07', true), day('2026-08-10', true)]
  expect(sprintStreak(days, '2026-08-10')).toBe(3)
})

it('사흘 연속 빠지면 거기서 끊는다', () => {
  const days = [
    day('2026-08-01', true),
    day('2026-08-02', true),
    day('2026-08-09', true),
    day('2026-08-10', true),
  ]
  expect(sprintStreak(days, '2026-08-10')).toBe(2)
})

it('주말에 인접한 평일 병결까지 겹치면 끊긴다 — 수용된 잔여 리스크(스펙 §2-3)', () => {
  // 목(06)까지 하고 금(07) 병결 + 토·일(08·09) 쉼 = 공백 3일. 월(10)에 복귀하면 1이다.
  const days = [day('2026-08-05', true), day('2026-08-06', true), day('2026-08-10', true)]
  expect(sprintStreak(days, '2026-08-10')).toBe(1)
})
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH" && npx vitest run src/engine/streak.test.ts`

Expected: FAIL 2건 — 「이틀 연속 빠진 것은 봐준다」가 `expected 3, received 1`, 「주말에 인접한 평일 병결까지 겹치면 끊긴다」가 `expected 1, received 1`로 통과할 수도 있으니 주의해서 볼 것(현행 상수 1에서도 공백 3은 끊기므로 세 번째 테스트는 원래 통과한다 — 이것은 정상이다. 첫 번째 테스트의 실패만이 이 단계의 신호다). 「사흘 연속 빠지면」은 현행에서도 통과한다.

- [ ] **Step 3: 상수와 두 곳의 문구를 고친다**

`src/engine/streak.ts` 4~5행:

```ts
/** 연속이 끊기기 전까지 봐주는 결석 일수. */
const FORGIVEN_GAPS = 1
```

를 아래로 바꾼다:

```ts
/**
 * 연속이 끊기기 전까지 봐주는 결석 일수.
 *
 * 2로 둔 이유는 주말이다 — 2학기 루틴(스펙 `2026-08-26-semester2-plan-design.md` §3)이
 * 토·일 스프린트를 "자유"로 두므로, 1이면 주말을 쉰 아이가 월요일마다 불꽃이 꺼진 홈을
 * 본다. 주말에 인접한 평일 병결(금 또는 월)까지 겹치면 공백 3일이 되어 여전히 끊기는데,
 * 그 잔여 리스크는 수용된 결정이다(같은 스펙 §2-3) — 실사용에서 아프면 3으로 올린다.
 */
const FORGIVEN_GAPS = 2
```

같은 파일 17~18행의 독스트링 문장:

```ts
 * 하루 빠진 것은 봐준다 — 아픈 날은 한 달에 한두 번 반드시 생기고, 그때마다 0이 되면
 * 다시 쌓을 의욕을 잃는다. 이틀 연속 빠지면 끊는다.
```

를 아래로 바꾼다:

```ts
 * 이틀까지 빠진 것은 봐준다 — 아픈 날은 한 달에 한두 번 반드시 생기고, 그때마다 0이 되면
 * 다시 쌓을 의욕을 잃는다. 주말 이틀을 쉬는 루틴도 여기에 기댄다. 사흘 연속 빠지면 끊는다.
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

Run: `export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH" && npx vitest run src/engine/streak.test.ts`

Expected: PASS — 이 파일의 모든 테스트(기존 5 + 신규 3 = 8개)가 초록.

- [ ] **Step 5: 변이 검증**

`FORGIVEN_GAPS`를 잠시 `3`으로 바꾸고 위 명령을 다시 돌린다. Expected: 「사흘 연속 빠지면 거기서 끊는다」와 「주말에 인접한 평일 병결까지 겹치면 끊긴다」 2건이 FAIL. 확인했으면 **반드시 `2`로 원복**하고 다시 돌려 전부 초록인지 본다. 실패가 나지 않으면 테스트가 상수를 실제로 검사하지 못하는 것이므로 보고할 것.

- [ ] **Step 6: 전체 검사와 커밋**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npx prettier --check . && npm test && npm run build
git add src/engine/streak.ts src/engine/streak.test.ts
git commit -m "fix: 스트릭 용서를 이틀로 — 주말 쉬는 루틴이 불꽃을 끄지 않게"
```

---

### Task 2: 등장인물 개편 — 딸 이름 제거와 친구 풀 확장

**Files:**

- Modify: `src/engine/word.ts:16-24`(주석과 `WORD_NAMES`)
- Modify: `src/engine/word.test.ts:12-14`(낡는 주석)
- Test: `src/engine/word.test.ts` 하단에 받침 조사 회귀 1개 추가

**Interfaces:**

- Consumes: Task 1과 무관(독립)
- Produces: `WORD_NAMES: WordNames = { child: '유나', friends: ['지호', '민아', '서연', '도윤'] }` — Task 3·4의 새 문형이 이 인물 풀 위에서 렌더된다.

**배경(스펙 §2-2):** 딸이 자기 이름 노출 제거를 요청했다. `child`를 가상 이름 '유나'로 바꾸고, friends 풀에 **받침 있는 이름**(서연·도윤)을 넣어 `personJosa`·`personStem`의 받침 분기가 프로덕션에서 실사용되게 한다 — 지금까지 그 분기는 테스트 주입으로만 돌았다.

**이름 선정 제약(다른 이름으로 바꾸더라도 지킬 것):** 보통명사 동음이의어 금지 — '하루'(1일)·'지우'(지우개) 유형은 "민아는 하루의 3배만큼"처럼 오독을 만든다. 마스코트 지니의 이름은 쓰지 않는다(보상 캐릭터라 문장제 일상 인물과 세계관이 섞인다).

- [ ] **Step 1: 받침 있는 프로덕션 이름의 조사 출력 회귀 테스트를 추가한다**

`src/engine/word.test.ts` 맨 끝(177행 이후)에 아래를 덧붙인다:

```ts
describe('WORD_NAMES — 받침 있는 친구 이름의 조사(프로덕션 풀)', () => {
  it('서연·도윤은 언제나 이름+이+조사 형태로만 나온다', () => {
    // 주입 이름이 아니라 프로덕션 WORD_NAMES로 돈다 — 받침 있는 이름이 실제 카탈로그에
    // 들어왔으므로, 여기서 깨지면 아이가 받는 종이가 깨진 것이다.
    for (let seed = 1; seed <= 200; seed++) {
      for (const it of composeWordItems({ names: WORD_NAMES, rand: lcg(seed), seen: new Set() })) {
        expect(it.text, `seed ${seed}: ${it.text}`).not.toMatch(/서연(?!이(가|는|를|의))/)
        expect(it.text, `seed ${seed}: ${it.text}`).not.toMatch(/도윤(?!이(가|는|를|의))/)
      }
    }
  })

  it('받침 있는 친구가 실제로 등장한다 — 위 검사가 공허하지 않다는 증거', () => {
    const seen: string[] = []
    for (let seed = 1; seed <= 200; seed++) {
      for (const it of composeWordItems({ names: WORD_NAMES, rand: lcg(seed), seen: new Set() })) {
        if (it.text.includes('서연') || it.text.includes('도윤')) seen.push(it.text)
      }
    }
    expect(seen.length, '200시드에서 받침 있는 친구가 한 번도 안 나왔다').toBeGreaterThan(0)
  })
})
```

두 번째 테스트가 필요한 이유: 첫 번째는 "서연이 안 나오면" 자동으로 통과하는 부정형이라 그것만으로는 항진명제가 될 수 있다.

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH" && npx vitest run src/engine/word.test.ts`

Expected: FAIL — 「받침 있는 친구가 실제로 등장한다」가 `200시드에서 받침 있는 친구가 한 번도 안 나왔다`로 실패한다(현재 friends는 지호·민아뿐). 첫 번째 테스트는 아직 초록이다(등장하지 않으니 위반도 없다).

- [ ] **Step 3: `WORD_NAMES`와 그 주석을 고친다**

`src/engine/word.ts` 16~24행의 주석 마지막 문단과 상수를 아래로 바꾼다. 바꾸기 전:

```ts
 * 이름은 상수가 아니라 `composeWordItems`의 인자로 흐른다. 받침 있는 이름의
 * 조사 활용(`서연이가`)은 받침 없는 `서아`로는 검사할 수 없어, 테스트가 다른
 * 이름을 주입할 수 있어야 하기 때문이다(word.test.ts의 출력 수준 회귀 테스트).
 */
export const WORD_NAMES: WordNames = { child: '서아', friends: ['지호', '민아'] }
```

바꾼 뒤:

```ts
 * 이름은 상수가 아니라 `composeWordItems`의 인자로 흐른다 — 테스트가 다른 이름을
 * 주입할 수 있어야 하기 때문이다(word.test.ts의 출력 수준 회귀 테스트).
 *
 * child는 실제 아이 이름이 아닌 **가상 이름**이다(2026-08-26, 아이 본인 요청으로 실명을
 * 뺐다). friends에 받침 있는 이름을 넣은 것도 의도다 — personJosa·personStem의 받침
 * 분기가 프로덕션에서 실사용된다. 이름을 고칠 때 지킬 제약 둘: ⓐ 보통명사 동음이의어
 * 금지('하루'는 1일, '지우'는 지우개로 읽혀 "민아는 하루의 3배만큼"이 오독된다),
 * ⓑ 마스코트 지니의 이름을 쓰지 않는다(보상 캐릭터라 일상 인물과 세계관이 섞인다).
 */
export const WORD_NAMES: WordNames = {
  child: '유나',
  friends: ['지호', '민아', '서연', '도윤'],
}
```

- [ ] **Step 4: 낡은 테스트 주석을 고친다**

`src/engine/word.test.ts` 12~14행:

```ts
// 일부러 프로덕션 이름(WORD_NAMES.child = '서아')이 아니라 **받침 있는** 이름을 쓴다 —
// 아래 "서연이+조사" 출력 회귀 테스트는 받침 없는 이름으로는 아무것도 검사하지 못한다.
// 이름이 인자인 이유가 이것이다(word.ts의 WORD_NAMES 주석).
```

를 아래로 바꾼다:

```ts
// 주입 이름을 따로 두는 이유: 아래 "서연이+조사" 출력 회귀 테스트는 받침 없는 이름으로는
// 아무것도 검사하지 못하는데, child 슬롯이 받침 있는 이름인 상황도 함께 지켜야 한다
// (프로덕션 child '유나'는 받침이 없다). 이름이 인자인 이유가 이것이다.
```

- [ ] **Step 5: 테스트를 돌려 통과를 확인한다**

Run: `export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH" && npx vitest run src/engine/word.test.ts`

Expected: PASS — 신규 2개 포함 전부 초록. 특히 기존 「WORD_NAMES — 프로덕션 이름」 테스트가 '유나'로도 통과해야 한다(받침 없는 이름이라 접미사 없이 그대로 들어간다).

- [ ] **Step 6: 변이 검증**

`WORD_NAMES.friends`에서 `'서연', '도윤'`을 잠시 지우고 위 명령을 다시 돌린다. Expected: 「받침 있는 친구가 실제로 등장한다」가 FAIL. 확인 후 **원복**하고 다시 초록을 확인한다.

- [ ] **Step 7: 실명 잔존 확인**

Run: `grep -rn "서아" src/ docs/PRD.md`

Expected: 출력 없음(exit 1). 남아 있으면 그 자리도 이 커밋에서 정리한다. `docs/superpowers/`의 과거 스펙·HANDOFF는 시점 고정 기록이므로 **고치지 않는다**.

- [ ] **Step 8: 전체 검사와 커밋**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npx prettier --check . && npm test && npm run build
git add src/engine/word.ts src/engine/word.test.ts
git commit -m "feat: 문장제 등장인물 개편 — 실명 제거하고 받침 있는 친구 이름 추가"
```

---

### Task 3: 묶어 세기 문형에 길이·시간 소재 편입

**Files:**

- Modify: `src/engine/word.ts:108-121`(`GroupTpl` 타입에 `unit?` 추가), `src/engine/word.ts:122-156`(`GROUP_TEMPLATES`에 문형 2개 추가), `src/engine/word.ts:257`(생성부의 unit 결정)
- Test: `src/engine/word.test.ts` 하단에 신규 describe 1개

**Interfaces:**

- Consumes: Task 2의 `WORD_NAMES`(친구 풀 4명)
- Produces: `GroupTpl`에 `unit?(g: Goods): string` 옵셔널 메서드. Task 4는 이 타입을 건드리지 않고 `TimesTpl`만 다룬다.

**배경(스펙 §2-1):** 2-2 단원 중 길이(cm)·시간(분)을 문장제의 **옷**으로 편입한다. 수학은 여전히 b×a(b·a∈2~9)라 아이가 그 단원을 아직 안 배웠어도 풀 수 있다. GOODS 행 추가가 아니라 **소재 내장형 문형**으로 넣는데, 소재 내장 전례는 `TIMES_TEMPLATES`에만 있다 — `GroupTpl`에는 unit 필드가 없고 group 문항의 단위는 뽑힌 GOODS 행(`g.unit`)에서 나오므로, 오버라이드 없이 넣으면 길이 문항의 답 칸이 "몇 개"로 인쇄된다.

- [ ] **Step 1: 새 문형의 계약을 검사하는 테스트를 추가한다**

먼저 파일 상단 import에 `WordItem` 타입을 더한다(3행 `import type { WordNames } from './word'` 아래):

```ts
import type { WordItem } from '../data/types'
```

그다음 `src/engine/word.test.ts` 맨 끝에 아래를 덧붙인다:

```ts
describe('묶어 세기 — 길이·시간 소재(스펙 §2-1)', () => {
  // 200시드를 돌며 새 문형이 실제로 나오는지(존재성)와, 나온 것이 규칙을 지키는지(전칭)를
  // 함께 본다. 존재성이 없으면 전칭 검사는 항진명제가 된다.
  function groupItems(): WordItem[] {
    const out: WordItem[] = []
    for (let seed = 1; seed <= 200; seed++) {
      const [g] = composeWordItems({ names: WORD_NAMES, rand: lcg(seed), seen: new Set() })
      out.push(g!)
    }
    return out
  }

  it('cm 문항의 답 칸 단위는 cm다 — GOODS의 개·장·자루가 새지 않는다', () => {
    const cmItems = groupItems().filter((it) => it.text.includes('cm'))
    expect(cmItems.length, '200시드에서 길이 문형이 한 번도 안 나왔다').toBeGreaterThan(0)
    for (const it of cmItems) {
      expect(it.unit, it.text).toBe('cm')
    }
  })

  it('분 문항의 답 칸 단위는 분이다', () => {
    const minItems = groupItems().filter((it) => /\d분씩/.test(it.text))
    expect(minItems.length, '200시드에서 시간 문형이 한 번도 안 나왔다').toBeGreaterThan(0)
    for (const it of minItems) {
      expect(it.unit, it.text).toBe('분')
    }
  })

  it('기존 사물 문항의 단위는 그대로 GOODS에서 온다', () => {
    const goodsUnits = new Set(['개', '자루', '장'])
    const others = groupItems().filter((it) => it.unit !== 'cm' && it.unit !== '분')
    expect(others.length).toBeGreaterThan(0)
    for (const it of others) {
      expect(goodsUnits.has(it.unit), `${it.unit}: ${it.text}`).toBe(true)
    }
  })

  it('expression과 answer는 새 문형에서도 일치한다', () => {
    for (const it of groupItems()) {
      const m = /^([2-9])×([2-9])$/.exec(it.expression)
      expect(m, it.expression).not.toBeNull()
      expect(Number(m![1]) * Number(m![2])).toBe(it.answer)
    }
  })
})
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH" && npx vitest run src/engine/word.test.ts -t "묶어 세기 — 길이"`

Expected: FAIL 2건 — 「cm 문항의 답 칸 단위는 cm다」와 「분 문항의 답 칸 단위는 분이다」가 각각 `200시드에서 … 한 번도 안 나왔다`로 실패.

- [ ] **Step 3: `GroupTpl`에 unit 오버라이드를 연다**

`src/engine/word.ts` 108~110행 부근, `GroupTpl` 타입의 `key` 바로 아래에 한 줄을 추가한다:

```ts
type GroupTpl = {
  text(p: string, g: Goods, a: number, b: number): string
  key(g: Goods): string
  /**
   * 답 칸 단위를 문형이 직접 정한다(소재 내장형 문형용). 없으면 뽑힌 GOODS 행의
   * `g.unit`을 쓴다 — 기존 4문형이 그 경우다. 길이·시간 문형은 GOODS를 쓰지 않으므로
   * 이 오버라이드가 없으면 답 칸이 "몇 개"로 인쇄된다.
   */
  unit?(g: Goods): string
  eligible?(g: Goods): boolean
```

(`eligible`·`hasPerson`과 그 주석은 그대로 둔다.)

- [ ] **Step 4: 생성부가 오버라이드를 쓰게 한다**

`src/engine/word.ts` 257행:

```ts
      unit: g.unit,
```

를 아래로 바꾼다:

```ts
      unit: tpl.unit?.(g) ?? g.unit,
```

- [ ] **Step 5: 문형 2개를 추가한다**

`src/engine/word.ts`의 `GROUP_TEMPLATES` 배열 마지막 원소(`eligible: (g) => g.edible`인 '먹어요' 문형) 뒤, 배열을 닫는 `]` 앞에 아래 두 원소를 넣는다:

```ts
  {
    // 길이(2-2 3단원). 소재 내장형이라 GOODS를 쓰지 않는다 — key·unit을 문형이 직접 낸다.
    // 인물이 텍스트에 없으므로 hasPerson: false가 반드시 필요하다(없으면 뽑히기만 하고
    // 안 쓰인 유령 인물이 seen을 오염시켜 문항2의 강제 분기를 매번 충돌시킨다).
    key: () => '리본',
    unit: () => 'cm',
    hasPerson: false,
    text: (_p, _g, a, b) =>
      `길이가 ${b}cm인 리본 조각이 ${a}개 있어요. 한 줄로 이어 붙이면 모두 몇 cm일까요?`,
  },
  {
    // 시간(2-2 4단원). '먹어요' 문형과 같은 골격이고 부사만 다르다.
    key: () => '동화책',
    unit: () => '분',
    text: (p, _g, a, b) =>
      `${personJosa(p, '은/는')} 동화책을 매일 ${b}분씩 읽어요. ${a}일 동안 모두 몇 분 읽을까요?`,
  },
```

- [ ] **Step 6: 테스트를 돌려 통과를 확인한다**

Run: `export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH" && npx vitest run src/engine/word.test.ts`

Expected: PASS — 신규 4개와 기존 전부 초록. 특히 기존 「하루 두 문항 중 하나엔 반드시 딸 이름이 들어간다」와 「WORD_NAMES — 프로덕션 이름」이 계속 초록이어야 한다(무인물 문형이 뽑힌 날에는 문항2가 child를 강제한다).

- [ ] **Step 7: 변이 검증 2회**

① 4단계에서 고친 줄을 잠시 `unit: g.unit,`으로 되돌리고 돌린다. Expected: 「cm 문항의 답 칸 단위는 cm다」 FAIL. 원복.
② 길이 문형의 `hasPerson: false`를 잠시 지우고 돌린다. Expected: 문장제 조합 실패나 딸 이름 불변식 테스트가 FAIL(어느 쪽이 터지든 hasPerson이 실제로 일하고 있다는 증거다). 원복 후 전부 초록 확인.

②에서 아무것도 빨개지지 않으면 그 사실을 보고할 것 — 유령 인물 경로를 지키는 테스트가 실제로는 없다는 뜻이다.

- [ ] **Step 8: 눈검사**

이 레포에는 `vite-node`·`tsx`가 없으므로(실측) 스크립트가 아니라 **임시 테스트 파일**로 본다. `src/engine/peek.test.ts`를 만들고:

```ts
import { it } from 'vitest'
import { composeWordItems, WORD_NAMES } from './word'

function lcg(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}

it('눈검사 — 새 묶어 세기 문형 출력', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const [g] = composeWordItems({ names: WORD_NAMES, rand: lcg(seed), seen: new Set() })
    if (g!.text.includes('cm') || /\d분씩/.test(g!.text)) console.log(`[${g!.unit}] ${g!.text}`)
  }
})
```

Run: `export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH" && npx vitest run src/engine/peek.test.ts`

확인할 것: 조사가 자연스러운가("유나는 동화책을 매일 5분씩"), 답 칸 단위가 문장과 맞는가, 어색한 수(1cm짜리 조각 등)가 없는가. 어색한 출력이 있으면 고치고 Step 6부터 다시 돈다.

**확인이 끝나면 반드시 지운다**: `rm src/engine/peek.test.ts` — 남기면 커밋에 섞이고 테스트 수가 늘어난다.

- [ ] **Step 9: 전체 검사와 커밋**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npx prettier --check . && npm test && npm run build
git add src/engine/word.ts src/engine/word.test.ts
git commit -m "feat: 묶어 세기 문장제에 길이·시간 소재 편입"
```

---

### Task 4: 몇 배 문형에 길이·시간 소재 편입

**Files:**

- Modify: `src/engine/word.ts:163-193`(`TIMES_TEMPLATES`에 문형 2개 추가)
- Test: `src/engine/word.test.ts` 하단에 신규 describe 1개

**Interfaces:**

- Consumes: Task 2의 `WORD_NAMES`, Task 3이 추가한 GROUP 길이 문형(같은 `key: '리본'`을 공유해 하루 안의 중복이 차단된다)
- Produces: 없음(마지막 코드 태스크)

**배경(스펙 §2-1):** `TimesTpl`은 이미 `unit(g)`·`key(g)`를 문형이 직접 내는 구조라(종이배·줄넘기 전례) 타입 변경이 없다. 계사는 `copula('cm')`를 **태우지 않는다** — `hasBatchim('cm')`은 비한글이라 받침 있음으로 판정해 '이에요'를 내는데, 발음(센티미터, 모음 끝) 기준 표준은 '예요'다. 시간 문형의 소재를 줄넘기가 아닌 '그림'으로 두는 이유는 기존 TIMES 문형에 이미 줄넘기가 있어 6문형 중 2개가 같은 소재가 되기 때문이다.

- [ ] **Step 1: 새 문형의 계약을 검사하는 테스트를 추가한다**

`src/engine/word.test.ts` 맨 끝에 아래를 덧붙인다. `WordItem` import는 Task 3에서 이미 추가돼 있다 — 없으면 상단에 `import type { WordItem } from '../data/types'`를 먼저 넣는다.

```ts
describe('몇 배 — 길이·시간 소재(스펙 §2-1)', () => {
  function timesItems(): WordItem[] {
    const out: WordItem[] = []
    for (let seed = 1; seed <= 200; seed++) {
      const [, t] = composeWordItems({ names: WORD_NAMES, rand: lcg(seed), seen: new Set() })
      out.push(t!)
    }
    return out
  }

  it('cm 문항의 계사는 예요다 — copula의 이에요가 새지 않는다', () => {
    const cmItems = timesItems().filter((it) => it.text.includes('cm'))
    expect(cmItems.length, '200시드에서 길이 몇 배 문형이 한 번도 안 나왔다').toBeGreaterThan(0)
    for (const it of cmItems) {
      expect(it.text, it.text).not.toMatch(/cm이에요/)
      expect(it.unit, it.text).toBe('cm')
    }
  })

  it('그림 문항의 단위는 분이다', () => {
    const drawItems = timesItems().filter((it) => it.text.includes('그림을'))
    expect(drawItems.length, '200시드에서 그림 문형이 한 번도 안 나왔다').toBeGreaterThan(0)
    for (const it of drawItems) {
      expect(it.unit, it.text).toBe('분')
    }
  })

  it('expression과 answer는 새 문형에서도 일치하고 배수는 2~5다', () => {
    for (const it of timesItems()) {
      const m = /^([2-9])×([2-5])$/.exec(it.expression)
      expect(m, it.expression).not.toBeNull()
      expect(Number(m![1]) * Number(m![2])).toBe(it.answer)
    }
  })
})
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH" && npx vitest run src/engine/word.test.ts -t "몇 배 — 길이"`

Expected: FAIL 2건 — 「cm 문항의 계사는 예요다」와 「그림 문항의 단위는 분이다」가 각각 `200시드에서 … 한 번도 안 나왔다`로 실패.

- [ ] **Step 3: 문형 2개를 추가한다**

`src/engine/word.ts`의 `TIMES_TEMPLATES` 배열 마지막 원소(`copula(g.unit)`을 쓰는 '모은' 문형) 뒤, 배열을 닫는 `]` 앞에 아래 두 원소를 넣는다:

```ts
  {
    // 길이(2-2 3단원). key를 GROUP 길이 문형과 같은 '리본'으로 두어, 하루 안에 리본이
    // 두 번 나오는 것을 w-goods 중복 방지가 차단하게 한다.
    key: () => '리본',
    unit: () => 'cm',
    // copula를 태우지 않고 '예요'를 리터럴로 박는다 — hasBatchim('cm')은 비한글이라
    // 받침 있음으로 판정해 '이에요'를 내는데, 발음(센티미터)은 모음으로 끝나 '예요'가 맞다.
    text: (p, f, _g, a, b) =>
      `${personStem(f)}의 리본은 ${b}cm예요. ${personStem(p)}의 리본은 ${personStem(f)}의 ${a}배예요. ${personStem(p)}의 리본은 몇 cm일까요?`,
  },
  {
    // 시간(2-2 4단원). 소재를 줄넘기로 하면 위 문형과 겹쳐 6문형 중 2개가 줄넘기가 된다.
    key: () => '그림',
    unit: () => '분',
    text: (p, f, _g, a, b) =>
      `${personJosa(f, '은/는')} 그림을 ${b}분 그렸어요. ${personJosa(p, '은/는')} ${personStem(f)}의 ${a}배만큼 그렸어요. ${personJosa(p, '은/는')} 몇 분 그렸을까요?`,
  },
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

Run: `export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH" && npx vitest run src/engine/word.test.ts`

Expected: PASS — 이 파일 전부 초록. 특히 기존 「생성된 텍스트 어디에도 개·자루·번 뒤에 이에요가 붙지 않는다」와 받침 조사 회귀가 계속 초록이어야 한다.

- [ ] **Step 5: 변이 검증**

길이 문형의 `${b}cm예요`를 잠시 `${b}cm${copula('cm')}`로 바꾸고 돌린다. Expected: 「cm 문항의 계사는 예요다」 FAIL. 원복 후 초록 확인.

- [ ] **Step 6: 눈검사**

Task 3과 같은 방식으로 임시 테스트 파일을 쓴다. `src/engine/peek.test.ts`를 만들고:

```ts
import { it } from 'vitest'
import { composeWordItems, WORD_NAMES } from './word'

function lcg(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}

it('눈검사 — 새 몇 배 문형 출력', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const [, t] = composeWordItems({ names: WORD_NAMES, rand: lcg(seed), seen: new Set() })
    if (t!.text.includes('cm') || t!.text.includes('그림을')) console.log(`[${t!.unit}] ${t!.text}`)
  }
})
```

Run: `export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH" && npx vitest run src/engine/peek.test.ts`

확인할 것: 소유격이 한 문장 안에서 일관된가("서연이의 리본은 … 서연이의 4배예요"), 받침 있는 친구 이름이 자연스러운가, "3cm예요"가 맞게 나오는가.

**확인이 끝나면 반드시 지운다**: `rm src/engine/peek.test.ts`.

- [ ] **Step 7: 전체 검사와 커밋**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npx prettier --check . && npm test && npm run build
git add src/engine/word.ts src/engine/word.test.ts
git commit -m "feat: 몇 배 문장제에 길이·시간 소재 편입"
```

---

### Task 5: 운영 루틴 문서와 참조 문서 갱신

**Files:**

- Create: `docs/semester2-routine.md`
- Modify: `docs/reference/integrated-arithmetic-ladder.md`(§7 구간 B·C 아래, §8 표 아래에 포인터 삽입)
- Modify: `docs/superpowers/HANDOFF.md`(19행 이후, "지금 상태" 표 바로 아래 문단 자리에 새 항목)
- Modify: `docs/PRD.md`(§9 색인 표 마지막 행 뒤)

**Interfaces:**

- Consumes: Task 1~4가 만든 코드 사실(스트릭 2일, 문형 4개, 등장인물)
- Produces: 없음(마지막 태스크)

**배경(스펙 §3·§4):** 루틴 문서의 독자는 **아빠 한 사람**이다. 딸에게는 각 활동이 규칙이 아니라 "오늘 아빠가 꺼낸 놀이"로 보여야 하므로, 루틴의 강제력은 아빠에게만 걸린다. PRD 본문은 갱신하지 않는다 — 문제지 구성·화면 소속·역할이 안 바뀌기 때문이고, 색인에 새 문서 행만 더한다.

- [ ] **Step 1: 운영 루틴 문서를 만든다**

`docs/semester2-routine.md`를 아래 내용으로 새로 만든다:

```markdown
# 2학기 주간 루틴 (2026년 9월 ~ 12월)

**이 문서의 독자는 아빠다.** 딸에게 이 표를 규칙으로 공지하지 않는다 — 각 활동은
아이에게 "오늘 아빠가 꺼낸 놀이"로 보여야 한다. 강제력은 아빠에게만 걸린다.

근거와 결정 경위: `docs/superpowers/specs/2026-08-26-semester2-plan-design.md`.
살아있는 문서다 — 학교 진도가 밀리거나 게임이 안 먹히면 여기를 고친다.

## 주간 고정 루틴

| 요일  | 종이(12분)    | 아이패드(3분)   | 앱 밖                                            |
| ----- | ------------- | --------------- | ------------------------------------------------ |
| 월~금 | 문제지 14문항 | 스프린트        | 익힘책 ★ 확인(학교 진도 따라, 아빠 1분)          |
| 수    | 〃            | 〃              | +보드게임 1판(20분)                              |
| 토    | 쉼            | 자유(강요 없음) | 수학동화책 1권(딸이 고름)                        |
| 일    | 쉼            | 〃              | 주간 리포트 인쇄·냉장고 + 생활수학(시계·돈·길이) |

주말을 쉬어도 🔥 연속일수는 꺼지지 않는다(용서 이틀, `src/engine/streak.ts`).
다만 주말에 붙은 평일 병결까지 겹치면 사흘 공백이라 끊긴다 — 수용된 한계다.

문제지가 월~금뿐이라, 일요일에 채점을 저장하면 리포트로 자동 전환되던 동작은
타지 않는다. 일요일 리포트는 위 표대로 직접 열어 인쇄한다.

## 원칙 셋

1. **앱이 내린 분량 하향은 사람이 뒤집지 않는다.** 😫가 세 번 이어지면 세로셈이
   8문항에서 6문항으로 줄어든다 — 그날 "그래도 더 풀자"고 하지 않는다.
2. **채점할 때 전략 문항 하나는 말로 설명시킨다.** 막히면 개념 구멍인지 문장을
   못 읽은 것인지 구분한다 — 앱이 못 재는 신호가 이것 하나다. 30초면 된다.
3. **앱 밖 활동은 강요하지 않는다.** 책도 게임도 싫다면 그 주는 건너뛴다.

## 단원 달력 (개략)

| 시기    | 학교 진도        | 집에서 볼 것                          |
| ------- | ---------------- | ------------------------------------- |
| 9월     | 네 자리 수       | 돈 세기(1000원·10000원), 익힘책 ★     |
| 9·10월  | 곱셈구구         | 스프린트가 주력 — 별도로 더 하지 않음 |
| 10·11월 | 길이 재기(m·cm)  | 줄자로 키·책상 재기, 문장제에도 등장  |
| 11월    | 시각과 시간      | 아날로그 시계 읽기, "몇 분 걸렸지?"   |
| 12월    | 표와 그래프·규칙 | 주간 리포트를 같이 읽기               |

앱의 구구단 도입 순서는 학교 진도와 맞추지 않는다(무작위) — 진도 정렬은 학교와
EBS의 몫이고, 앱은 속도만 맡는다.

## 보드게임 후보

루미큐브(수 조합) · 우봉고 · 펜토미노(도형 감각) · 메이크텐(연산).
한두 개로 시작한다 — 목록을 다 채우는 것이 목적이 아니다.
```

- [ ] **Step 2: 사다리 문서에 포인터를 삽입한다**

`docs/reference/integrated-arithmetic-ladder.md`의 `### 구간 B — 2026년 9월 ~ 12월 (2학년 2학기)` 표 바로 아래(다음 `### 구간 C` 헤딩 앞)에 아래 문단을 넣는다:

```markdown
> **2026-08-26 개정**: 이 구간의 목표치와 개발 트리거가 바뀌었다 —
> 실측(지도 42/72, 🔥 18일)이 원 계획을 크게 앞질러, 12월 완주를 목표로 올리고
> 역인출 개발 트리거를 날짜(2027-01)에서 상태(72/72 도달)로 옮겼다.
> 현행 계획은 `docs/superpowers/specs/2026-08-26-semester2-plan-design.md` §1이다.
```

같은 파일 `## 8. 하루치 앱 확장 데드라인` 표 아래의 `[해석]`으로 시작하는 문단 바로 앞에 아래를 넣는다:

```markdown
> **2026-08-26 개정**: 표의 `2027-01` 행은 이제 날짜가 아니라 **지도 72/72 도달**을
> 트리거로 읽는다(`specs/2026-08-26-semester2-plan-design.md` §1). 나머지 행은 그대로다.
```

- [ ] **Step 3: HANDOFF에 항목을 추가한다**

`docs/superpowers/HANDOFF.md`에서 "지금 상태" 표 아래 첫 문단(`2026-08-04: 세로셈 교차 제약…`으로 시작하는 줄) **바로 앞**에 아래를 넣는다:

```markdown
2026-08-26: 2학년 2학기 계획(스펙 `specs/2026-08-26-semester2-plan-design.md`). 코드 변경 셋 — ⓐ 문장제에 길이(cm)·시각(분) 소재 문형 4개를 넣었다(`GroupTpl`에 `unit?` 오버라이드를 열어 답 칸 단위가 GOODS에서 새지 않게 했다), ⓑ 등장인물에서 딸 실명을 빼고 가상 이름으로 바꾸면서 friends에 받침 있는 이름을 넣어 `personJosa` 받침 분기가 프로덕션에서 실사용되게 했다, ⓒ `FORGIVEN_GAPS`를 1→2로 올려 주말 이틀을 쉬어도 🔥가 안 꺼지게 했다(주말에 붙은 평일 병결까지 겹치면 여전히 끊긴다 — 수용한 한계). 2-2의 나머지 단원(네 자리 수·표와 그래프·규칙 찾기)은 앱이 먹지 않고 운영 문서 `docs/semester2-routine.md`가 맡는다. **적대적 리뷰 3라운드에서 17건이 나왔고 그중 Critical 1건이 "소재 내장형 GROUP 문형은 unit을 낼 방법이 없다"였다** — 스펙이 인용한 "종이배·줄넘기 전례"가 실은 `TIMES_TEMPLATES`에만 있는 메커니즘이어서, 그대로 구현했으면 "12cm"가 "12개"로 인쇄될 뻔했다. 스펙이 코드를 인용할 때 그 인용이 어느 타입의 것인지까지 확인할 것.
```

- [ ] **Step 4: PRD 색인에 행을 추가한다**

`docs/PRD.md` §9 색인 표의 마지막 행(`| EBS 강좌 매핑 | … |`) 뒤에 아래 행을 덧붙인다:

```markdown
| 2학기 운영 루틴 | `docs/semester2-routine.md` |
```

- [ ] **Step 5: 포맷과 전체 검사**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npm run format
npx prettier --check . && npm test && npm run build
```

Expected: 셋 다 통과. `npm run format`을 건너뛰면 CI의 `prettier --check .`가 마크다운에서 걸려 배포 전체가 막힌다.

- [ ] **Step 6: 커밋**

```bash
git add docs/semester2-routine.md docs/reference/integrated-arithmetic-ladder.md docs/superpowers/HANDOFF.md docs/PRD.md
git commit -m "docs: 2학기 운영 루틴 문서와 참조 갱신"
```

- [ ] **Step 7: 배포**

```bash
git push
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
gh run watch
```

Expected: prettier → test → build → Pages 배포가 전부 초록. 실패하면 그 로그를 보고하고 멈춘다 — main의 실패는 곧 배포 실패다.

---

## 실행 후 확인

전부 끝나면 아래를 사람이 확인한다(코드가 대신할 수 없는 것들):

- 아이패드에서 오늘 문제지를 새로 만들어(채점 전이라면 「다시 만들기」) 문장제 두 문항의 인물 이름과 단위를 눈으로 본다
- 새 문형이 나온 날의 인쇄본에서 답 칸 단위(`cm`·`분`)가 문장과 맞는지 본다
- `docs/semester2-routine.md`를 A4로 인쇄해 붙일지 결정한다
