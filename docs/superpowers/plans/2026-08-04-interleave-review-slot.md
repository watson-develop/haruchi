# 세로셈 교차 제약 + 복습 슬롯 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `composeSheet`의 세로셈 조립에 (1) 인접 동일 유형 금지(교차연습), (2) 마스터 유형 3일 복습 슬롯(분산연습)을 배선한다.

**Architecture:** 전부 `engine/`의 순수 함수 확장이다. `derive.ts`에 파생 함수 하나(`deriveLastSeen`)를 더하고, `compose.ts`의 세로셈 루프에 리롤 조건과 v1 분기를 넣는다. 저장 스키마 무변경, 마이그레이션 없음. 스펙: `docs/superpowers/specs/2026-08-04-interleave-review-slot-design.md`.

**Tech Stack:** TypeScript(바닐라, 프레임워크 없음), vitest.

## Global Constraints

- 모든 npm 명령 전에: `export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"`
- 커밋은 identity 플래그로: `git -c user.name="이성호" -c user.email="watson@daangnpay.com" commit …`
- 테스트는 `src/engine/`에만. DOM·화면 테스트는 만들지 않는다.
- 파생값을 저장하는 코드를 만들지 않는다 — `Meta.derived`는 죽은 필드다.
- 엔진에서 `new Date()`를 부르지 않는다 — 날짜는 입력으로 주입.
- 재인쇄 불변식: `sheet`는 저장 후 재생성되지 않는다 (이 계획은 조립만 고치므로 자동 준수).
- 커밋 전 `npm run format` — CI의 `prettier --check .`가 마크다운까지 검사한다.
- main push는 곧 배포다. **push는 사용자가 결정한다 — 계획에 포함하지 않는다.**

---

### Task 1: 배선 — `deriveLastSeen` + `everMastered` 공개 + `composeSheet` 시그니처

동작 변화가 없는 순수 배선이다. 새 입력을 **필수**로 만들어 컴파일러가 모든 호출부를 잡게 한다(이 레포는 화면 테스트가 없어 구조로 막는 것이 원칙이다).

**Files:**

- Modify: `src/engine/derive.ts` (deriveLastSeen 추가, everMastered에 export)
- Modify: `src/engine/compose.ts:76` (composeSheet 입력 확장)
- Modify: `src/engine/compose.test.ts` (17곳 호출부 + TODAY 상수)
- Modify: `src/engine/simulation.test.ts:90` (호출부 1곳)
- Modify: `src/screens/print-sheet.ts:108-115` (buildSheet 주입)
- Test: `src/engine/derive.test.ts`

**Interfaces:**

- Consumes: `Day`(`data/types.ts:86`), `diffDays(from, to)`(`dates.ts:32`)
- Produces: `deriveLastSeen(days: Day[]): Record<string, string>` — tag → 마지막으로 sheet에 실린 날짜(YYYY-MM-DD). `everMastered(state?: TypeState): boolean` export. `composeSheet` 입력에 `lastSeen: Record<string, string>`·`today: string` 필수 필드. Task 3이 셋 다 쓴다.

- [ ] **Step 1: derive.test.ts에 실패 테스트 작성**

기존 derive.test.ts의 describe들 옆에 추가한다. 파일 상단 type import(`Day, TypeState, VerticalItem, StrategyId`)에 `VerticalTag`를 추가한다.

```ts
import { deriveLastSeen } from './derive' // 기존 import 줄에 합친다

/** 세로셈 tag들로 하루를 만든다. graded=false면 채점 전 날 — 그래도 세어야 한다. */
const vday = (date: string, tags: VerticalTag[], graded: boolean): Day => ({
  date,
  kind: 'normal',
  sheet: tags.map((tag, i) => ({
    kind: 'vertical' as const,
    id: `v${i + 1}`,
    tag,
    a: 11,
    b: 22,
    op: '+' as const,
    answer: 33,
  })),
  ...(graded ? { grades: {} } : {}),
})

describe('deriveLastSeen', () => {
  it('채점 안 된 날도 센다', () => {
    const days = [vday('2026-08-01', ['add2-nocarry'], false)]
    expect(deriveLastSeen(days)).toEqual({ 'add2-nocarry': '2026-08-01' })
  })

  it('마지막 날짜가 이긴다', () => {
    const days = [
      vday('2026-08-01', ['add2-nocarry'], true),
      vday('2026-08-03', ['add2-nocarry', 'sub2-noborrow'], false),
    ]
    expect(deriveLastSeen(days)).toEqual({
      'add2-nocarry': '2026-08-03',
      'sub2-noborrow': '2026-08-03',
    })
  })

  it('세로셈 외 문항은 세지 않는다', () => {
    const day: Day = {
      date: '2026-08-02',
      kind: 'normal',
      sheet: [
        {
          kind: 'inverse',
          id: 'inv1',
          tag: 'inverse-add',
          template: 'a+?=c',
          a: 3,
          c: 10,
          answer: 7,
        },
      ],
    }
    expect(deriveLastSeen([day])).toEqual({})
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/engine/derive.test.ts`
Expected: FAIL — `deriveLastSeen`이 export되지 않음.

- [ ] **Step 3: derive.ts 구현**

`deriveStrategies` 아래에 추가:

```ts
/**
 * tag → 마지막으로 sheet에 실린 날짜. 복습 슬롯(compose.ts)이 "얼마나 오래 안
 * 나왔나"를 재는 데 쓴다. deriveTypes와 달리 **채점 안 된 날도 센다** —
 * deriveStrategies의 appearances와 같은 원칙으로, 채점이 밀려도 복습 페이스가
 * 멈추면 안 된다. days는 날짜 오름차순 전제 — 마지막 기록이 이긴다.
 * 세로셈만 본다 — 슬롯은 세로셈 유형에만 있다.
 */
export function deriveLastSeen(days: Day[]): Record<string, string> {
  const lastSeen: Record<string, string> = {}
  for (const day of days) {
    for (const item of day.sheet) {
      if (item.kind !== 'vertical') continue
      lastSeen[item.tag] = day.date
    }
  }
  return lastSeen
}
```

그리고 `function everMastered(` → `export function everMastered(` (의미 변경 없음, 주석 그대로).

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/engine/derive.test.ts`
Expected: PASS

- [ ] **Step 5: composeSheet 입력 확장**

`compose.ts:76`의 input 타입에 두 필드 추가 (이 Task에서는 받기만 하고 쓰지 않는다):

```ts
export function composeSheet(input: {
  settings: Settings
  types: Record<string, TypeState>
  strategies: Record<string, StrategyState>
  facts: Record<string, FactState>
  /** deriveLastSeen(days). 복습 슬롯이 간격을 재는 데 쓴다(Task 3). */
  lastSeen: Record<string, string>
  /** 오늘의 dayKey. 엔진은 new Date()를 부르지 않는다. */
  today: string
  rand?: () => number
}): SheetItem[] {
```

- [ ] **Step 6: 컴파일 에러를 따라 호출부 전부 갱신**

Run: `npm run build` — tsc가 빠진 호출부를 전부 나열한다. 세 파일이다:

`compose.test.ts` — 파일 상단에 상수 추가 후 17곳 모두에 두 필드 추가:

```ts
const TODAY = '2026-08-04'
```

```ts
// 예 — 모든 호출이 같은 꼴이다:
const sheet = composeSheet({
  settings: DEFAULT_SETTINGS,
  types: {},
  strategies: {},
  facts: {},
  lastSeen: {},
  today: TODAY,
})
```

`simulation.test.ts:90` — 시뮬레이션은 화면과 같은 순서를 재현하므로 진짜 파생값을 넣는다 (`deriveLastSeen` import 추가):

```ts
const sheet: SheetItem[] = composeSheet({
  settings: DEFAULT_SETTINGS,
  types,
  strategies,
  facts,
  lastSeen: deriveLastSeen(log),
  today: dateKey(d),
  rand,
})
```

`print-sheet.ts` buildSheet — `deriveLastSeen` import 추가(`derive` import 줄에 합침), `dayKey`는 이미 import돼 있다:

```ts
async function buildSheet(): Promise<Day['sheet']> {
  const meta = await getMeta()
  const days = await getAllDays()
  const types = deriveTypes(days)
  const strategies = deriveStrategies(days)
  const facts = deriveFacts(days, meta.settings.fluentMs)
  return composeSheet({
    settings: meta.settings,
    types,
    strategies,
    facts,
    lastSeen: deriveLastSeen(days),
    today: dayKey(new Date()),
  })
}
```

- [ ] **Step 7: 전체 검증**

Run: `npm run build && npm test`
Expected: 빌드 통과, 전체 테스트 통과 (동작 무변경이므로 기존 테스트가 전부 그대로 초록).

- [ ] **Step 8: 커밋**

```bash
npm run format
git add src/engine/derive.ts src/engine/derive.test.ts src/engine/compose.ts \
  src/engine/compose.test.ts src/engine/simulation.test.ts src/screens/print-sheet.ts
git -c user.name="이성호" -c user.email="watson@daangnpay.com" commit -m "feat: composeSheet에 lastSeen·today 배선 — 복습 슬롯의 재료

deriveLastSeen(인쇄 기준, 채점 무관)과 everMastered 공개. 동작 무변경 —
새 입력을 필수로 만들어 컴파일러가 호출부를 강제한다.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 교차 제약 — 인접 세로셈 동일 유형 금지

**Files:**

- Modify: `src/engine/compose.ts:89-107` (세로셈 루프)
- Test: `src/engine/compose.test.ts`

**Interfaces:**

- Consumes: Task 1의 시그니처 (`lastSeen`·`today`는 아직 안 씀), 기존 `DEDUP_ATTEMPTS`·`generateWithFallback`·`pickWeighted`
- Produces: 루프에 `prevTag: VerticalTag | null` 변수 — Task 3의 v1 분기가 이 변수를 갱신해야 한다.

- [ ] **Step 1: 실패 테스트 작성**

compose.test.ts에 추가. 마스터 2유형이면 `openTags`가 세 번째(`add2-carry`)까지 열고 거기에 도입 가산점이 붙어(가중치 약 0.1 : 0.1 : 1.7) 인접 중복이 흔하다 — 구현 전에는 확실히 빨갛다.

```ts
it('인접한 세로셈 두 문항은 유형이 다르다 (열린 유형 2개 이상, 1000회)', () => {
  const types = { 'add2-nocarry': mastered(), 'sub2-noborrow': mastered() }
  const rand = lcg(7)
  for (let n = 0; n < 1000; n++) {
    const verticals = composeSheet({
      settings: DEFAULT_SETTINGS,
      types,
      strategies: {},
      facts: {},
      lastSeen: {},
      today: TODAY,
      rand,
    }).filter((i) => i.kind === 'vertical')
    for (let k = 1; k < verticals.length; k++) {
      expect(verticals[k]!.tag).not.toBe(verticals[k - 1]!.tag)
    }
  }
})
```

열린 유형 1개일 때의 정상 생성은 기존 '설정된 문항 수대로 만든다'·'열린 유형만 출제한다' 테스트가 이미 보증한다 — 새 테스트 불필요.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/engine/compose.test.ts -t "인접한"`
Expected: FAIL — 인접 중복 발견.

- [ ] **Step 3: 구현**

세로셈 루프를 다음으로 교체 (`VerticalTag` import는 이미 있다):

```ts
let prevTag: VerticalTag | null = null
for (let i = 0; i < input.settings.verticalCount; i++) {
  let made: Omit<VerticalItem, 'id'> | null = null
  for (let attempt = 0; attempt < DEDUP_ATTEMPTS; attempt++) {
    const candidate = generateWithFallback(pickWeighted(tags, weights, rand), rand)
    const key = `${candidate.a}${candidate.op}${candidate.b}`
    if (seen.has(key)) continue
    // 교차연습(스펙 §2): 직전 세로셈과 같은 유형이면 리롤. 추첨된 tag가 아니라
    // **생성된 문항의 tag**를 본다 — 폴백이 유형을 바꿀 수 있다. seen.add보다
    // 먼저 검사해 쓰지 않은 수식으로 seen을 오염시키지 않는다.
    if (tags.length >= 2 && candidate.tag === prevTag) continue
    seen.add(key)
    made = candidate
    break
  }
  if (!made) {
    // 예산 소진 — 빈 자리를 두지 않기 위해 중복·인접 동일을 허용한다.
    made = generateWithFallback(tags[0]!, rand)
  }
  items.push({ ...made, id: `v${i + 1}` })
  prevTag = made.tag
}
```

- [ ] **Step 4: 통과 + 회귀 확인**

Run: `npm test`
Expected: 전체 PASS — 기존 속성(수식 중복 없음·문항 수·id·유형 정의 만족)도 그대로.

- [ ] **Step 5: 변이 검증**

`if (tags.length >= 2 && candidate.tag === prevTag) continue` 줄을 주석 처리 → `npx vitest run src/engine/compose.test.ts` → "인접한" 테스트**만** 빨간지 확인 → 원복 → 다시 초록 확인.

- [ ] **Step 6: 커밋**

```bash
npm run format
git add src/engine/compose.ts src/engine/compose.test.ts
git -c user.name="이성호" -c user.email="watson@daangnpay.com" commit -m "feat: 세로셈 인접 동일 유형 금지 — 교차연습(Rohrer 2020, d=0.83)

리롤 조건 하나. 열린 유형 1개면 비활성, 예산 소진 시 허용(빈 자리 금지 원칙).
근거: docs/reference/learning-science-evidence.md §2

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 복습 슬롯 — 오래 안 본 마스터 유형을 v1에

**Files:**

- Modify: `src/engine/compose.ts` (REVIEW_GAP_DAYS·pickReviewTag·v1 분기)
- Test: `src/engine/compose.test.ts`

**Interfaces:**

- Consumes: Task 1의 `lastSeen`·`today`·`everMastered`, Task 2의 `prevTag`, `diffDays`(`dates.ts:32`)
- Produces: 없음 — `REVIEW_GAP_DAYS`·`pickReviewTag`는 compose.ts 내부 비공개다(테스트는 공개 API인 `composeSheet`로만 검증).

- [ ] **Step 1: 실패 테스트 작성**

```ts
describe('복습 슬롯', () => {
  // 두 유형 모두 마스터 → openTags는 add2-carry까지 3개를 연다.
  const twoMastered = () => ({ 'add2-nocarry': mastered(), 'sub2-noborrow': mastered() })

  it('3일 이상 안 나온 마스터 유형 중 가장 오래된 것이 v1에 온다', () => {
    // add2-nocarry는 1일 전(간격 미달), sub2-noborrow는 7일 전 → 슬롯은 sub2-noborrow
    const lastSeen = { 'add2-nocarry': '2026-08-09', 'sub2-noborrow': '2026-08-03' }
    for (let n = 0; n < 50; n++) {
      const v1 = composeSheet({
        settings: DEFAULT_SETTINGS,
        types: twoMastered(),
        strategies: {},
        facts: {},
        lastSeen,
        today: '2026-08-10',
      }).find((i) => i.id === 'v1')!
      expect(v1.kind).toBe('vertical')
      if (v1.kind === 'vertical') expect(v1.tag).toBe('sub2-noborrow')
    }
  })

  it('기록이 없는 마스터 유형은 가장 오래된 것으로 취급, 동률은 VERTICAL_ORDER 앞쪽', () => {
    const v1 = composeSheet({
      settings: DEFAULT_SETTINGS,
      types: twoMastered(),
      strategies: {},
      facts: {},
      lastSeen: {},
      today: '2026-08-10',
    }).find((i) => i.id === 'v1')!
    if (v1.kind === 'vertical') expect(v1.tag).toBe('add2-nocarry')
  })

  it('전부 3일 미만이면 미발동 — v1이 한 유형에 고정되지 않는다', () => {
    const lastSeen = { 'add2-nocarry': '2026-08-09', 'sub2-noborrow': '2026-08-08' }
    const rand = lcg(11)
    const v1tags = new Set<string>()
    for (let n = 0; n < 200; n++) {
      const v1 = composeSheet({
        settings: DEFAULT_SETTINGS,
        types: twoMastered(),
        strategies: {},
        facts: {},
        lastSeen,
        today: '2026-08-10',
        rand,
      }).find((i) => i.id === 'v1')!
      if (v1.kind === 'vertical') v1tags.add(v1.tag)
    }
    expect(v1tags.size).toBeGreaterThan(1)
  })

  it('마스터 유형이 없으면 미발동 — 정상 생성', () => {
    const sheet = composeSheet({
      settings: DEFAULT_SETTINGS,
      types: {},
      strategies: {},
      facts: {},
      lastSeen: {},
      today: '2026-08-10',
    })
    expect(sheet.filter((i) => i.kind === 'vertical')).toHaveLength(8)
  })
})
```

시드 고정 LCG라 세 번째 테스트도 결정적이다 — 통과를 확인했으면 시드를 바꾸지 않는다.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/engine/compose.test.ts -t "복습 슬롯"`
Expected: 첫 두 테스트 FAIL (v1이 슬롯 유형이 아님). 뒤 두 테스트는 우연히 초록일 수 있다 — 첫 둘이 빨가면 충분하다.

- [ ] **Step 3: 구현**

compose.ts에 추가 (`everMastered`는 derive import 줄에, `diffDays`는 `./dates`에서):

```ts
/** 복습 슬롯 최소 간격(일). 구구단 사다리(1→3→7→14)의 두 번째 칸과 맞춘다 — 스펙 §0. */
const REVIEW_GAP_DAYS = 3

/**
 * 복습 슬롯(v1)에 낼 유형. 마스터한 열린 유형 중 마지막 인쇄 후 REVIEW_GAP_DAYS
 * 이상 지난 것이 없으면 null — 그날은 슬롯 없이 전부 가중 추첨이다(기회형, 스펙 §3).
 * lastSeen에 없는 유형은 가장 오래된 것으로 취급한다('' < 모든 날짜).
 * tags는 VERTICAL_ORDER 순이므로 "strictly 더 오래됨"일 때만 교체하면 동률은
 * 앞쪽이 이긴다.
 */
function pickReviewTag(
  tags: VerticalTag[],
  types: Record<string, TypeState>,
  lastSeen: Record<string, string>,
  today: string,
): VerticalTag | null {
  if (tags.length < 2) return null
  let best: VerticalTag | null = null
  let bestSeen = ''
  for (const tag of tags) {
    if (!everMastered(types[tag])) continue
    const seenAt = lastSeen[tag] ?? ''
    if (seenAt !== '' && diffDays(seenAt, today) < REVIEW_GAP_DAYS) continue
    if (best === null || seenAt < bestSeen) {
      best = tag
      bestSeen = seenAt
    }
  }
  return best
}
```

세로셈 루프는 최종적으로 다음 전체 모양이 된다 (Task 2의 리롤 루프 포함 — 새로 들어가는 것은 `reviewTag` 계산과 `i === 0` 분기뿐이다):

```ts
const reviewTag = pickReviewTag(tags, input.types, input.lastSeen, input.today)

let prevTag: VerticalTag | null = null
for (let i = 0; i < input.settings.verticalCount; i++) {
  if (i === 0 && reviewTag !== null) {
    // 복습 슬롯(스펙 §3): 슬롯을 먼저 확정해야 교차 제약이 "v2가 슬롯 tag를
    // 피한다"로 순방향으로 풀린다. 위치를 바꾸려면 이 분기를 다른 i로 옮기고
    // prevTag 갱신을 함께 옮긴다 — 파생·저장에는 위치 가정이 없다.
    const made = generateWithFallback(reviewTag, rand)
    seen.add(`${made.a}${made.op}${made.b}`)
    items.push({ ...made, id: 'v1' })
    prevTag = made.tag
    continue
  }
  let made: Omit<VerticalItem, 'id'> | null = null
  for (let attempt = 0; attempt < DEDUP_ATTEMPTS; attempt++) {
    const candidate = generateWithFallback(pickWeighted(tags, weights, rand), rand)
    const key = `${candidate.a}${candidate.op}${candidate.b}`
    if (seen.has(key)) continue
    // 교차연습(스펙 §2): 직전 세로셈과 같은 유형이면 리롤. 추첨된 tag가 아니라
    // **생성된 문항의 tag**를 본다 — 폴백이 유형을 바꿀 수 있다. seen.add보다
    // 먼저 검사해 쓰지 않은 수식으로 seen을 오염시키지 않는다.
    if (tags.length >= 2 && candidate.tag === prevTag) continue
    seen.add(key)
    made = candidate
    break
  }
  if (!made) {
    // 예산 소진 — 빈 자리를 두지 않기 위해 중복·인접 동일을 허용한다.
    made = generateWithFallback(tags[0]!, rand)
  }
  items.push({ ...made, id: `v${i + 1}` })
  prevTag = made.tag
}
```

- [ ] **Step 4: 통과 + 회귀 확인**

Run: `npm test`
Expected: 전체 PASS. 기존 테스트 중 마스터 유형 + `lastSeen: {}`로 부르는 것들은 이제 v1이 슬롯이 되지만, 기존 단언(문항 수·중복 없음·유형 정의·"섞여 나온다")은 슬롯과 양립한다 — 빨개지면 단언을 완화하지 말고 원인을 파악할 것.

- [ ] **Step 5: 변이 검증**

`pickReviewTag` 본문 첫 줄에 `return null` 삽입 → "복습 슬롯" describe의 첫 두 테스트**만** 빨간지 확인 → 원복 → 초록 확인.

- [ ] **Step 6: 커밋**

```bash
npm run format
git add src/engine/compose.ts src/engine/compose.test.ts
git -c user.name="이성호" -c user.email="watson@daangnpay.com" commit -m "feat: v1 복습 슬롯 — 3일 이상 안 본 마스터 유형을 설계된 분산연습으로

기회형: 해당 유형이 없으면 그날은 전부 가중 추첨. 우연 복습(weight 0.1)을
대체하지 않고 보장만 더한다. 근거: learning-science-evidence.md §2

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: 마무리 — 전체 검증 + HANDOFF 갱신

**Files:**

- Modify: `docs/superpowers/HANDOFF.md`

**Interfaces:**

- Consumes: Task 1–3 완료 상태
- Produces: 없음 (검증·문서만)

- [ ] **Step 1: 전체 검증**

Run: `npm run format && npx prettier --check . && npm test && npm run build`
Expected: 넷 다 통과. 하나라도 실패하면 커밋하지 않고 원인부터.

- [ ] **Step 2: HANDOFF.md 갱신**

현재 상태 절에 한 단락 추가 — 형식은 파일의 기존 단락을 따른다:

> 2026-08-04: 세로셈 교차 제약(인접 동일 유형 금지)과 v1 복습 슬롯(마스터 유형, 3일 간격, 기회형) 배선. 스펙 `specs/2026-08-04-interleave-review-slot-design.md`, 근거 `docs/reference/learning-science-evidence.md`. 슬롯 위치(v1)는 재량 결정 — 되돌리기 지점은 스펙 §3.

- [ ] **Step 3: 커밋**

```bash
git add docs/superpowers/HANDOFF.md
git -c user.name="이성호" -c user.email="watson@daangnpay.com" commit -m "docs: HANDOFF에 교차 제약·복습 슬롯 반영

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

push 여부는 사용자 결정(main push = 배포).
