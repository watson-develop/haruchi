# 부모 홈의 구구단 지도 입구 제거 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 부모 홈에서 「구구단 지도」 링크를 없애고, 아이 전용이 된 지도 화면의 뒤로가기를 `← 아이 화면`에서 `← 홈`으로 되돌린다.

**Architecture:** 엔진 변경이 없다. 화면 템플릿 두 곳과 리스너 한 줄을 지우고, 문자열 두 개를 바꾸고, 문서 두 곳을 맞춘다. 새 함수·새 타입·새 토큰·새 테스트가 없다. 설계 근거는 `docs/superpowers/specs/2026-08-05-parent-map-entry-removal-design.md`.

**Tech Stack:** 바닐라 DOM + TypeScript, vitest(이 계획은 테스트를 추가하지 않는다), SEED CSS 토큰(이 계획은 CSS를 건드리지 않는다).

## Global Constraints

- 모든 npm 명령 전: `export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"`
- `git add`는 항상 명시 경로. **`git add .` 금지**
- **docs를 커밋하기 전 반드시 `npm run format`** — `.prettierignore`가 없어 CI의 `prettier --check .`가 마크다운까지 검사하고, 문서 포맷 흠 하나가 앱 배포 전체를 막는다
- **작업 경로는 `main` 직접이다.** CLAUDE.md 결정 트리 ③("이 커밋 하나가 그대로 배포돼도 괜찮은가")에 예이고, 이 레포의 지배적 패턴이다(149커밋 중 머지 2개). 다만 **push 전에 Task 3의 사람 확인을 반드시 통과**시킨다 — push = 배포다
- **테스트를 추가하지 않는다.** 화면 변경이고 엔진을 건드리지 않는다(설계 §12). 테스트 수는 **303 그대로**여야 한다
- **새 `navigate()`를 만들지 않는다.** 이 계획은 `navigate()` 호출을 하나 **제거**할 뿐이고, 남는 호출의 목적지는 전부 그대로다
- **아이 소속 화면(`#/`·`#/sprint`·`#/map`·`#/ebs`)에서 부모 소속 화면(`#/parent`·`#/print`·`#/grade`·`#/report`)으로 가는 경로를 만들지 않는다.** `map.ts`의 목적지는 `#/`에서 바뀌지 않는다 — 바뀌는 것은 라벨 문자열뿐이다
- **`#/map` 라우트를 없애지 않는다.** `main.ts`의 라우터와 아이 홈의 진입은 그대로다
- `src/styles/` 전체와 `src/engine/` 전체를 건드리지 않는다

---

### Task 1: 화면 — 부모 홈의 지도 입구 제거 + 지도 라벨 되돌리기

**Files:**

- Modify: `src/screens/home-parent.ts` (links 행 1곳, 리스너 1줄)
- Modify: `src/screens/map.ts` (뒤로가기 라벨 2곳)

**Interfaces:**

- Consumes: 없음 (기존 코드만 수정)
- Produces: 없음 (다른 태스크가 의존하는 새 export가 없다)

**배경:** `map.ts`는 아이 소속 화면이라 뒤로가기가 `#/`로 고정돼 있다. 부모 홈에서 지도로 들어가면 돌아올 길이 없다(편도). 그리고 부모는 리포트 안에서 같은 지도를 `newlyFluent` 강조까지 붙은 더 나은 형태로 이미 본다.

- [ ] **Step 1:** `src/screens/home-parent.ts` — links 행에서 지도 버튼과 구분자를 지운다.

찾을 것(현재 69-71줄, **들여쓰기 포함해 파일에 있는 그대로**):

```text
          <div class="links">
            <button id="map">구구단 지도</button><span class="sep">·</span><button id="ebs">EBS 강의</button>
          </div>
```

다음으로 교체(들여쓰기 10칸 유지):

```text
          <div class="links"><button id="ebs">EBS 강의</button></div>
```

`<span class="sep">·</span>`를 함께 지우는 이유: `.sep`은 두 링크 **사이의** 가운뎃점이라(`app.css`의 `.links .sep`은 `margin: 0 8px`) 남기면 EBS 앞에 고아 구분자가 붙는다. 한 줄로 합치는 것은 바로 아래 `<div class="links"><button id="child">← 아이 화면</button></div>` 줄과 형태를 맞추기 위한 것이다.

- [ ] **Step 2:** 같은 파일에서 지도 리스너 한 줄을 지운다.

찾아서 **삭제**할 줄(현재 83줄, 들여쓰기 4칸):

```text
    root.querySelector('#map')!.addEventListener('click', () => navigate('#/map'))
```

위아래의 `#report`·`#ebs` 리스너는 **그대로 둔다.** `querySelector('#map')!`는 non-null 단언이라 버튼만 지우고 리스너를 남기면 런타임에 터진다 — 두 스텝은 반드시 함께 간다.

- [ ] **Step 3:** `src/screens/map.ts` — 뒤로가기 라벨 2곳을 되돌린다.

정상 경로(현재 18줄, 들여쓰기 10칸):

```text
          <button class="step" id="back">← 아이 화면</button>
```

→

```text
          <button class="step" id="back">← 홈</button>
```

오류 경로(현재 25줄, 들여쓰기 4칸):

```text
    root.replaceChildren(el(`<div><button class="step" id="back">← 아이 화면</button></div>`))
```

→

```text
    root.replaceChildren(el(`<div><button class="step" id="back">← 홈</button></div>`))
```

**두 줄의 `navigate('#/')`는 건드리지 않는다.** 목적지는 그대로이고 라벨만 바뀐다.

- [ ] **Step 4:** `src/screens/ebs.ts`는 **아무것도 바꾸지 않는다.** EBS는 부모 홈 입구를 유지하므로 `← 아이 화면`을 계속 쓴다. `ebs.ts:62`의 가드 주석도 EBS 자기 얘기라 그대로 둔다. (확인만 하고 넘어가는 스텝이다 — 편집 금지.)

- [ ] **Step 5:** 검증

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npx prettier --check .
npm test
npm run build
```

기대: prettier 통과, **303 tests passed**, build 성공.

- [ ] **Step 6:** 남은 참조가 없는지 확인

```bash
grep -rn "id=\"map\"\|'#/map'" src/screens/home-parent.ts
```

기대: **출력 없음**(부모 홈에 지도 흔적이 남아 있지 않다).

```bash
grep -rn "← 아이 화면" src/screens/
```

기대: `ebs.ts` 2곳과 `home-parent.ts`의 `id="child"` 버튼만 나온다. `map.ts`는 **나오지 않아야** 한다.

- [ ] **Step 7:** 커밋

```bash
git add src/screens/home-parent.ts src/screens/map.ts
git commit -m "fix: 부모 홈에서 구구단 지도 입구를 없앤다 — 지도는 다시 '← 홈'"
```

---

### Task 2: 문서 — 용어 사전과 결정 기록 갱신

**Files:**

- Modify: `docs/design/brand.md` (용어 사전 「뒤로 가기」 행 1줄)
- Modify: `docs/design/ux-review-2026-08-05.md` (결정 기록 절에 1줄 추가)

**Interfaces:**

- Consumes: Task 1이 만든 실제 라벨 상태(지도 = `← 홈`, EBS = `← 아이 화면`)
- Produces: 없음

**중요:** `brand.md` §6은 이 제품 언어의 **단일 출처**다. 코드와 어긋난 표는 표가 없느니만 못하다 — Task 1이 라벨을 바꿨으므로 이 표도 같은 커밋 묶음에서 따라와야 한다.

- [ ] **Step 1:** `docs/design/brand.md` — 용어 사전의 「뒤로 가기」 행을 교체한다.

찾을 것(현재 111줄):

```markdown
| 뒤로 가기 | **← 아이 화면 / ← 홈** | 뒤로, 돌아가기 | 지도·EBS(두 홈 모두에서 오는 화면)는 ← 아이 화면, 스프린트(아이 전용 흐름)는 ← 홈(리뷰 P2-8) |
```

다음으로 교체(한 줄):

```markdown
| 뒤로 가기 | **← 아이 화면 / ← 홈** | 뒤로, 돌아가기 | EBS(부모 홈에서도 들어오는 화면)는 ← 아이 화면, 지도·스프린트(아이 전용)는 ← 홈. 지도는 부모 입구를 없애며 되돌렸다(specs/2026-08-05-parent-map-entry-removal-design.md) |
```

열 정렬은 신경 쓰지 않아도 된다 — `npm run format`이 표를 다시 정렬한다. **열 개수(4개)만 맞추면 된다.**

- [ ] **Step 2:** `docs/design/ux-review-2026-08-05.md` — 결정 기록 절 **맨 끝**에 한 줄 더한다.

현재 파일 끝은 이 줄이다:

```markdown
- P2-8: 지도·EBS만 "← 아이 화면"으로, 스프린트 "← 홈"은 유지(아이 전용 흐름)
```

**이 줄을 지우지 말고 그대로 둔 채**, 바로 아래에 다음을 더한다:

```markdown
- P2-8 갱신(2026-08-05): 부모 홈의 지도 입구를 없애면서 지도는 "← 홈"으로 되돌렸다 — 위 결정의 근거였던 "두 홈 모두에서 오는 화면"이라는 전제가 사라졌기 때문이다. `← 아이 화면`은 EBS에만 남는다(specs/2026-08-05-parent-map-entry-removal-design.md)
```

결정 로그는 이력이므로 **덮어쓰지 않는다.** 뒤집힌 사실과 뒤집힌 이유를 함께 남겨야 몇 달 뒤에 같은 왕복을 하지 않는다.

- [ ] **Step 3:** 포맷과 검증

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npm run format
npx prettier --check .
npm test
```

기대: prettier 통과, **303 tests passed**. `npm run format`이 위 두 문서 외의 파일을 바꿨다면 **커밋하지 말고 보고할 것.**

- [ ] **Step 4:** 커밋

```bash
git add docs/design/brand.md docs/design/ux-review-2026-08-05.md
git commit -m "docs: 지도 뒤로가기 되돌림을 용어 사전과 결정 기록에 반영한다"
```

---

### Task 3: 사람 확인 후 배포

**Files:** 없음 (검증과 push만)

**이 태스크는 사람이 눈으로 보기 전에는 끝나지 않는다.** 이 레포에는 DOM 테스트가 없어서(설계 §12) 화면이 어긋나는 결함을 자동으로 잡을 수단이 없다. `main`에 push하면 그것이 곧 배포다.

- [ ] **Step 1:** 전체 검사

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npx prettier --check . && npm test && npm run build
```

기대: 전부 통과, 303 tests.

- [ ] **Step 2:** 불변식 훑기

```bash
grep -rn "navigate(" src/screens/map.ts src/screens/ebs.ts src/screens/home-child.ts src/screens/sprint.ts
```

기대: 목적지가 전부 `#/`이거나 아이 소속 해시(`#/sprint`·`#/map`·`#/ebs`). 부모 해시(`#/parent`·`#/print`·`#/grade`·`#/report`)는 `home-child.ts`의 기존 `부모 →` 버튼(`#/parent`) 하나뿐이어야 하고, 그것은 이 계획 이전부터 있던 것이다.

- [ ] **Step 3:** dev 서버로 사람 확인

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npm run dev
```

`http://localhost:5173/haruchi/`에서 네 가지를 본다:

1. **부모 홈** — 링크 행에 「EBS 강의」만 있고, 그 앞에 고아 `·`가 없는지
2. **아이 홈 → 구구단 지도** — 뒤로가기가 `← 홈`이고, 눌렀을 때 아이 홈으로 가는지
3. **부모 홈 → EBS 강의** — 뒤로가기가 여전히 `← 아이 화면`인지(안 바뀌었어야 한다)
4. **리포트** — 안에 실린 지도가 이전과 똑같은지

- [ ] **Step 4:** push = 배포

**Step 3의 네 항목을 사람이 확인한 뒤에만 실행한다.**

```bash
git push
gh run watch --exit-status
```

기대: `prettier --check` → `npm test` → `npm run build` → Pages 배포가 전부 초록.

---

## Self-Review 결과

- **스펙 커버리지:** 설계 문서의 「범위」 표 4행이 전부 태스크에 배정됐다 — `home-parent.ts`(T1 S1·S2), `map.ts`(T1 S3), `brand.md`(T2 S1), `ux-review-2026-08-05.md`(T2 S2). 「하지 않는 것」 5항목은 T1 S4(ebs.ts 무변경)와 Global Constraints(테스트 무추가·`#/map` 라우트 유지·CSS 무변경)로 명시됐고, 「리포트 sub 라벨을 고치지 않는다」는 어떤 태스크에도 그 파일이 없으므로 자동으로 지켜진다. 「검증」 4항목은 T3 S3에 그대로 옮겼다
- **플레이스홀더:** 없다. 모든 편집 스텝이 찾을 문자열과 교체할 문자열을 실제 내용으로 담고 있다
- **타입 일관성:** 새 함수·타입·시그니처가 없다. 태스크 간 인터페이스 의존이 없으므로 이름 불일치가 생길 자리가 없다
- **위험 지점 하나:** T1 S1과 S2는 반드시 함께 간다 — `querySelector('#map')!`가 non-null 단언이라 버튼만 지우고 리스너를 남기면 부모 홈이 런타임에 터진다. 그래서 두 스텝을 한 태스크·한 커밋에 묶었다
