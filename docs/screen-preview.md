# 화면 미리보기 — 기록을 건드리지 않고 채워진 상태 보기

새 화면이 어떻게 보이는지 확인하려고 **배포된 앱에서 스프린트를 돌리지 말 것.** 그 세션은
딸의 기록에 그대로 들어간다. 2026-09-03 밤 실제로 그렇게 됐다 — 아빠가 폰에서 한 판을
돌렸고, 그 답들이 그날 기록에 섞여 정복 4칸이 늘었다.

무엇이 스스로 풀리고 무엇이 안 풀리는지도 그때 확인했다:

- **풀린다** — 정복 판정은 복습 간격이 1일이라 다음 날 다시 물어보고, 28일 점검이 정복 식
  전부를 한 번 더 거른다. 며칠이면 제자리로 돌아온다("정복은 도장이 아니라 최근 성적").
- **안 풀린다** — **램프 게이지의 최고 기록**(`peakFluent`). 내려가지 않게 만든 값이라,
  아빠가 밀어 올린 숫자는 딸이 진짜로 그 위를 넘길 때까지 남는다.

## 원리 — 주소가 다르면 기록도 다르다

IndexedDB는 **origin별로 격리**된다. 배포본(`https://watson-develop.github.io/haruchi/`)과
로컬 개발 서버(`http://localhost:5173/haruchi/`)는 다른 origin이라 **서로의 기록을 전혀 보지
못한다.** 그래서 개발 서버에서 무엇을 하든 딸의 기록은 안전하다.

같은 이유로 개발 서버는 처음에 **빈 앱**으로 뜬다. 채워진 모습을 보려면 아래처럼 심는다.

## 1. 개발 서버 띄우기

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"   # 터미널에서 직접 할 땐 불필요
npm run dev -- --host
```

```
맥        http://localhost:5173/haruchi/
폰·아이패드  http://<맥의 LAN 주소>:5173/haruchi/    ← 서버가 켜질 때 Network: 줄에 찍힌다
```

## 2. 원하는 상태 심기

**앱을 한 번 연 뒤**(그때 IndexedDB 스토어가 생긴다) 브라우저 콘솔에 붙여넣는다.
맨 위 두 줄만 바꾸면 된다.

```js
const PEAK = 21 // 정복 칸 수 0~72 (72면 램프가 켜진다)
const WISH = null // 트로피를 보려면 '2026-11-03' 같은 날짜 문자열

;(async () => {
  const ids = []
  for (let a = 2; a <= 9; a++) for (let b = 1; b <= 9; b++) ids.push(a + '×' + b)
  // 한 식을 1초에 3번 맞히면 그날 바로 정복이 된다(engine/facts.ts의 판정 그대로).
  const sprint = []
  for (const id of ids.slice(0, PEAK))
    for (let i = 0; i < 3; i++) sprint.push({ fact: id, correct: true, ms: 1000 })
  // 어제 날짜로 심는다 — 오늘 자리를 비워 두고, 28일 점검도 바로 걸리지 않는다.
  const d = new Date(Date.now() - 864e5)
  const p = (n) => String(n).padStart(2, '0')
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`

  const db = await new Promise((ok, no) => {
    const q = indexedDB.open('haruchi', 3)
    q.onsuccess = () => ok(q.result)
    q.onerror = () => no(q.error)
  })
  const cur = await new Promise((ok) => {
    const r = db.transaction('meta').objectStore('meta').get('current')
    r.onsuccess = () => ok(r.result)
  })
  const tx = db.transaction(['days', 'meta'], 'readwrite')
  tx.objectStore('days').clear()
  if (PEAK > 0) tx.objectStore('days').put({ date, kind: 'normal', sheet: [], sprint })
  tx.objectStore('meta').put(
    {
      derived: { facts: {}, types: {}, strategies: {} },
      settings: {
        childName: '',
        friendNames: [],
        verticalCount: 8,
        inverseCount: 2,
        sprintCount: 30,
        fluentMs: 2500,
        lastExportedAt: null,
        schemaVersion: 1,
        algoVersion: 1,
        ...(cur?.settings ?? {}),
        wishGrantedAt: WISH,
      },
    },
    'current',
  )
  await new Promise((ok) => {
    tx.oncomplete = ok
  })
  db.close()
  location.reload()
})()
```

**이 스니펫은 IndexedDB에 직접 쓴다** — `putDay`를 거치지 않으므로 아웃박스 표식이 생기지
않고, 따라서 서버로 올라갈 일이 없다. (애초에 개발 서버 origin은 등록된 기기가 아니라
서버가 받아주지도 않는다. 안전장치가 둘이다.)

## 3. 볼 만한 값

| PEAK   | WISH           | 보이는 것                                                       |
| ------ | -------------- | --------------------------------------------------------------- |
| 0      | `null`         | 실루엣 램프, 지도의 「첫 칸을 채워 볼까?」                      |
| 1      | `null`         | 램프 바닥에 얇은 금색 띠 — 1칸도 보인다는 것을 확인             |
| 21     | `null`         | 지금 딸 수준                                                    |
| 60     | `null`         | 정체 구간 — 게이지가 눈에 띄게 차 있다                          |
| 72     | `null`         | **램프가 켜진다.** 탭하면 지니가 소원을 묻는다                  |
| 72     | `'2026-11-03'` | **트로피.** 램프는 안 빛나고 지니는 소원을 다시 약속하지 않는다 |
| 아무값 | `'2026-11-03'` | 부모 홈 꼬리에 「소원 들어줬어요 · 날짜 · 되돌리기」            |

램프 게이지는 **역대 최고 정복 수**를 본다. 지도 아래 숫자(오늘의 정복 수)와 다를 수 있고,
그것이 의도다 — 점검일에 지도가 줄어도 램프는 그대로다.

## 4. 되돌리기

개발 서버 origin의 기록만 지운다. 배포본과 무관하다.

```js
indexedDB.deleteDatabase('haruchi') // 그 뒤 새로고침
```

## 하지 말 것

- **배포된 앱에서 스프린트를 돌려 보지 않는다.** 기록에 섞인다(이 문서의 이유).
- **등록된 기기에서 조작한 백업을 `#/manage`로 가져오지 않는다.** 가져오기는 서버 스냅샷 뒤
  기록 **전체**를 바꾸고 다른 기기까지 따라온다. 미리보기는 개발 서버에서만.
- 개발 서버를 두 개 띄우면 5173·5174가 다른 origin이라 기록이 또 갈린다 — 두 번째 창이
  비어 보이는 것은 정상이다.
