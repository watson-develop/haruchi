import type { WordItem } from '../data/types'
import { randInt } from './rand'

/**
 * 문장제(설계 §6.5, 스펙 §4). 텍스트는 생성 시점에 완성되어 sheet에 박제된다 —
 * 이름을 나중에 바꿔도 이미 만든 날의 문제지는 변하지 않는다(재인쇄 불변식).
 */

export type WordNames = { child: string; friends: string[] }

/**
 * 등장인물 이름 — **코드가 유일한 출처다. 이름을 바꾸려면 여기를 고친다.**
 *
 * 2026-08-04에 이름 입력 화면이 제거되면서(설계 §6.5) `Settings.childName`·
 * `friendNames`를 쓸 수 있는 UI가 사라졌다. 그래서 그 두 필드는 읽지 않는다 —
 * 제거된 화면이 남긴 값이 기기에 그대로 남아 있고 고칠 방법이 없기 때문이다
 * (실제로 한 기기에 `'○○'`이 저장돼 문장제가 `○○이가`로 나왔다). 두 필드는
 * 백업 스키마 호환으로만 남는다 — `Meta.derived`와 같은 취급이다.
 *
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

/**
 * 한글 음절의 받침 유무. 한글 완성형(가~힣) 범위 밖이면(로마자·기호 등) 받침 있음으로
 * 취급한다. josa 안에 박혀 있던 계산을 뽑아냈다 — 사람용 personJosa와 계사 copula가
 * 같은 판정을 그대로 재사용한다(리뷰 Important 발견 1·사용자 결정 이후 정리).
 */
function hasBatchim(word: string): boolean {
  const code = word.charCodeAt(word.length - 1)
  const isHangul = code >= 0xac00 && code <= 0xd7a3
  return !isHangul || (code - 0xac00) % 28 !== 0
}

/** 사물 조사. 받침 유무로 고른다. 기존 계약(word.test.ts, josa('서연','은/는')==='서연은')은
 *  사람에게도 그대로 쓰이던 걸 personJosa로 분리했을 뿐 — 이 함수 자체 동작은 안 바꿨다. */
export function josa(word: string, pair: '이/가' | '은/는' | '을/를'): string {
  const [w, wo] = pair.split('/') as [string, string]
  return word + (hasBatchim(word) ? w : wo)
}

/**
 * 이름에 접미사 '이'를 필요한 만큼만 붙인 어간(받침 있으면 `이름+이`, 없으면 그대로).
 *
 * personJosa가 조사(이/가·은/는·을/를)를 고르기 전에 쓰는 공통 어간인데, 소유격
 * `~의`처럼 그 세 조사 밖의 자리에도 같은 접미사 규칙을 적용해야 해서 따로 뽑았다
 * (재리뷰 라운드 2, "함께 고칠 것 A" — `${f}의`가 이 규칙을 안 타서 한 문제 안에
 * `서연이가`·`서연의`가 섞이는 문제가 있었다).
 */
function personStem(name: string): string {
  return hasBatchim(name) ? `${name}이` : name
}

/**
 * 사람 이름 전용 조사(사용자 결정, 2026-08-03: "접미사 '이' 붙이기").
 *
 * josa를 사람에게 그대로 쓰면 받침 있는 이름이 `서연은`처럼 격식체로만 나온다.
 * 초등 학습지 관례는 받침 있는 이름 뒤에 '이'를 끼워 넣은 뒤 받침-없음 분기의
 * 조사를 붙인다 — `서연이가`/`서연이는`/`서연이를`. 받침 없는 이름(민아·지호)은
 * '이'를 끼울 필요가 없어 josa와 동일하다.
 *
 * '나'는 추가 예외: 주격만 불규칙 활용이라 규칙대로 하면 '나가'(동사 "나가다"로
 * 오독됨)가 된다. 표준형 '내가'로 대체한다. 은/는·을/를은 원래도 규칙적이므로
 * ('나는'·'나를') 그대로 둔다. child가 빈 문자열이면 '나' 폴백이 이 분기를 탄다.
 */
export function personJosa(name: string, pair: '이/가' | '은/는' | '을/를'): string {
  if (name === '나' && pair === '이/가') return '내가'
  if (!hasBatchim(name)) return josa(name, pair)
  const [, wo] = pair.split('/') as [string, string]
  return `${personStem(name)}${wo}`
}

/**
 * 계사 예요/이에요. 단위 명사(개·자루·장 등)의 받침 유무로 정해진다.
 * TIMES_TEMPLATES[1]의 '개'는 항상 받침이 없어 고정해도 안전하지만, [3]은 g.unit이
 * 가변(개/자루/장)이라 고정 '이에요'를 쓰면 '7개이에요'가 나온다(리뷰 Important 발견 1).
 */
export function copula(unit: string): '예요' | '이에요' {
  return hasBatchim(unit) ? '이에요' : '예요'
}

// edible: "하루에 ~을 먹어요" 문형이 고를 수 있는 소재인지. 눈검사(Step 5)에서
// "색종이를 먹어요"·"구슬을 먹어요"가 나온 것을 잡았다 — 문형은 소재를 가리지 않는데
// 먹는 동사만 소재를 가린다. false인 소재는 그 문형에서 제외한다(아래 GROUP_TEMPLATES).
//
// container: pack이 실제 그릇인지(봉지·주머니·필통·접시·상자) 아니면 세는 단위 자체인지
// (묶음·줄). "한 개에 담다/들어 있다" 문형은 그릇에만 성립한다 — 묶음·줄에 쓰면
// "줄에 담다"처럼 줄을 그릇처럼 취급해 버린다(재리뷰 라운드 2, 발견 2 잔여분·1800문장
// 렌더로 실증됨). 색종이·스티커(둘 다 container:false)는 이 두 문형에서만 빠지고
// GROUP[2]·[3]·TIMES 전 문형엔 그대로 남는다 — 소재가 굶지 않는다.
type Goods = { n: string; unit: string; pack: string; edible: boolean; container: boolean }
const GOODS: Goods[] = [
  { n: '사탕', unit: '개', pack: '봉지', edible: true, container: true },
  { n: '구슬', unit: '개', pack: '주머니', edible: false, container: true },
  { n: '연필', unit: '자루', pack: '필통', edible: false, container: true },
  { n: '딸기', unit: '개', pack: '접시', edible: true, container: true },
  { n: '색종이', unit: '장', pack: '묶음', edible: false, container: false },
  { n: '쿠키', unit: '개', pack: '상자', edible: true, container: true },
  { n: '귤', unit: '개', pack: '봉지', edible: true, container: true },
  { n: '스티커', unit: '장', pack: '줄', edible: false, container: false },
]

// 소재 슬롯형은 (인물, 소재, 묶음수 a, 낱개수 b)를 받는다. 수사+단위 직결 금지 —
// "봉지 3개" 형태로만 쓴다(시뮬레이션이 "3봉지"의 부자연을 잡았다).
// eligible이 없으면 모든 소재가 맞는다(담다·나누다는 소재를 안 가린다) — 먹다만 가린다.
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
  /**
   * 문형이 실제로 텍스트에 인물을 싣는지. 기본은 true(4개 중 3개가 person을 쓴다) —
   * GROUP_TEMPLATES[1]만 false로 표시한다. 이 표시가 없으면 "뽑히기만 하고 텍스트엔
   * 한 번도 안 실린 인물"을 마치 문항1의 주인공인 것처럼 취급해 버린다(딸 이름 불변식
   * 회귀 테스트가 실제로 이 결함을 잡았다 — seed 28: GROUP[1]이 뽑히고, 우연히 person이
   * child와 같은 이름으로 뽑힌 날. 텍스트엔 그 이름이 전혀 없는데 childRequired가
   * 거짓이 되어 문항2도 아이를 강제하지 않았다).
   */
  hasPerson?: boolean
}
const GROUP_TEMPLATES: GroupTpl[] = [
  {
    key: (g) => g.n,
    // "한 봉지에 담다"는 어순을 바꿔도(재리뷰 라운드 2 이전 수정) "담다"라는 동사 자체가
    // 그릇에만 성립한다 — "한 줄에 담았더니"는 여전히 줄을 그릇처럼 취급한다(재리뷰
    // 라운드 2, 발견 2 잔여분). eligible: container로 묶음·줄(색종이·스티커)을 이
    // 문형에서 아예 뺐다 — 남는 6종(봉지·주머니·필통·접시·상자)은 전부 실제 그릇이라
    // "담다"가 그대로 성립한다.
    eligible: (g) => g.container,
    text: (p, g, a, b) =>
      `${personJosa(p, '이/가')} ${josa(g.n, '을/를')} 한 ${g.pack}에 ${b}${g.unit}씩 담았더니 ${g.pack} ${a}개가 되었어요. ${josa(g.n, '은/는')} 모두 몇 ${g.unit}일까요?`,
  },
  {
    key: (g) => g.n,
    // "들어 있다"도 같은 이유로 그릇 전용이다 — "줄에 들어 있다"는 여전히 어색하다.
    // 이 문형엔 애초에 인물이 없어(p 미사용, 브리프 원문 그대로 — 손대지 않기로 한
    // Minor) 조사 변경 대상도 없다 — hasPerson: false로 그 사실을 명시한다.
    hasPerson: false,
    eligible: (g) => g.container,
    text: (p, g, a, b) =>
      `${g.n} 한 ${g.pack}에 ${b}${g.unit}씩 들어 있어요. ${g.pack} ${a}개에는 모두 몇 ${g.unit} 들어 있을까요?`,
  },
  {
    key: (g) => g.n,
    text: (p, g, a, b) =>
      `${personJosa(p, '이/가')} 친구들에게 ${josa(g.n, '을/를')} ${b}${g.unit}씩 나누어 주려고 해요. 친구가 ${a}명이라면 ${josa(g.n, '이/가')} 모두 몇 ${g.unit} 필요할까요?`,
  },
  {
    key: (g) => g.n,
    eligible: (g) => g.edible,
    text: (p, g, a, b) =>
      `${personJosa(p, '은/는')} 하루에 ${josa(g.n, '을/를')} ${b}${g.unit}씩 먹어요. ${a}일 동안 모두 몇 ${g.unit} 먹을까요?`,
  },
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
]

// 몇 배: (주인공 p, 비교 대상 f, 소재, 배수 a, 기준량 b). 활동형은 소재가 문형에 내장.
type TimesTpl = {
  text(p: string, f: string, g: Goods, a: number, b: number): string
  key(g: Goods): string
  unit(g: Goods): string
}
const TIMES_TEMPLATES: TimesTpl[] = [
  {
    key: (g) => g.n,
    unit: (g) => g.unit,
    // ${f}의 — 소유격은 이/가·은/는·을/를 세 조사 밖이라 personJosa가 못 다룬다.
    // personStem(f)로 같은 접미사 규칙을 적용한다(재리뷰 라운드 2, "함께 고칠 것 A") —
    // 안 그러면 한 문제 안에서 "서연이는"과 "서연의"가 섞여 나온다.
    text: (p, f, g, a, b) =>
      `${personJosa(f, '은/는')} ${josa(g.n, '을/를')} ${b}${g.unit} 가지고 있어요. ${personJosa(p, '은/는')} ${personStem(f)}의 ${a}배를 가지고 있어요. ${personJosa(p, '은/는')} ${josa(g.n, '을/를')} 몇 ${g.unit} 가지고 있을까요?`,
  },
  {
    key: () => '종이배',
    unit: () => '개',
    text: (p, f, _g, a, b) =>
      `${personJosa(f, '이/가')} 접은 종이배는 ${b}개예요. ${personJosa(p, '이/가')} 접은 종이배는 ${personStem(f)}의 ${a}배예요. ${personJosa(p, '은/는')} 종이배를 몇 개 접었을까요?`,
  },
  {
    key: () => '줄넘기',
    unit: () => '번',
    text: (p, f, _g, a, b) =>
      `${personJosa(f, '은/는')} 줄넘기를 ${b}번 넘었어요. ${personJosa(p, '은/는')} ${personStem(f)}의 ${a}배만큼 넘었어요. ${personJosa(p, '은/는')} 줄넘기를 몇 번 넘었을까요?`,
  },
  {
    key: (g) => g.n,
    unit: (g) => g.unit,
    text: (p, f, g, a, b) =>
      // copula(g.unit) — 개·자루는 예요, 장은 이에요(리뷰 Important 발견 1, 고정 '이에요'였던 버그).
      `${personJosa(f, '이/가')} 모은 ${josa(g.n, '은/는')} ${b}${g.unit}${copula(g.unit)}. ${personJosa(p, '은/는')} ${personStem(f)}의 ${a}배를 모았어요. ${personJosa(p, '이/가')} 모은 ${josa(g.n, '은/는')} 몇 ${g.unit}일까요?`,
  },
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
]

function pick<T>(arr: T[], rand: () => number): T {
  // eligible 필터·people 목록이 빈 배열이 되는 경로는 지금 카탈로그에선 없지만(edible
  // 소재 4종 항상 존재, people은 child 최소 1명), 방어 없이 두면 randInt(0,-1,rand)가
  // -1을 내고 arr[-1]!이 undefined를 넘겨 호출부 어딘가에서 알 수 없는 TypeError로 샌다
  // (리뷰 Minor A). 여기서 미리 도메인 에러로 시끄럽게 막는다.
  if (arr.length === 0) throw new Error('word.ts: pick — 빈 배열에서 뽑을 수 없다')
  return arr[randInt(0, arr.length - 1, rand)]!
}

const ATTEMPTS = 60

/**
 * 하루 2문항: 묶어 세기(그림 칸) + 몇 배. 규칙 —
 * 두 문항 중 하나엔 반드시 딸 이름(몰입, 설계 §6.5), 같은 식·소재·주인공을 겹치지
 * 않고 seen(공유 중복 집합)의 수식도 피한다. 몇 배의 배수는 2~5(시뮬레이션에서
 * "8배 줄넘기"의 부자연 확인 — 폭 커버는 스프린트의 몫이다).
 */
export function composeWordItems(input: {
  names: WordNames
  rand: () => number
  seen: Set<string>
}): WordItem[] {
  const { names, rand, seen } = input
  const child = names.child || '나'
  const friends = names.friends.length > 0 ? names.friends : ['친구']
  const people = [child, ...friends]

  // 문항1: 묶어 세기. b개씩 a묶음 → 식은 "b×a"(하나에 든 수 × 묶음 수 — 교과 표기).
  let group: WordItem | null = null
  // 문항1의 실제 주인공을 별도 변수로 들고 있는다. group.text.includes(child)로
  // 판정하면 child가 '나'일 때 문형3의 "나누어 주려고"에 들어 있는 '나'와 우연히
  // 겹쳐 childRequired가 항상 거짓으로 오판된다(리뷰 Important 발견 4, 300일 중 23일
  // 재현됨). 부분 문자열이 아니라 정체(변수)로 비교하면 이 취약성 자체가 사라진다.
  let groupPerson: string | null = null
  for (let i = 0; i < ATTEMPTS && !group; i++) {
    const a = randInt(2, 9, rand)
    const b = randInt(2, 9, rand)
    const expr = `${b}×${a}`
    if (seen.has(expr)) continue
    // 문형을 먼저 뽑고, 그 문형이 받을 수 있는 소재로만 좁혀서 뽑는다(먹다 문형은
    // 식용 소재만 — 순서를 바꾸면 "구슬을 먹어요"가 다시 나올 수 있다).
    const tpl = pick(GROUP_TEMPLATES, rand)
    const pool = GOODS.filter((x) => !tpl.eligible || tpl.eligible(x))
    const g = pick(pool, rand)
    const person = pick(people, rand)
    seen.add(expr)
    seen.add(`w-goods:${tpl.key(g)}`)
    // hasPerson이 false인 문형(GROUP[1])은 person을 뽑아 두긴 하지만 텍스트에 싣지
    // 않는다 — 그런 날은 groupPerson을 null로 남겨 "문항1에 아무도 안 나왔다"를
    // 정확히 표현하고, seen에도 등록하지 않는다(위 GroupTpl.hasPerson 주석 참고).
    // 등록해 버리면 뽑히기만 하고 안 쓰인 유령 인물이 seen을 오염시켜, 그 인물이
    // 우연히 child와 같을 때 문항2의 강제 분기(person=child, 재표집 없음)가 매번
    // `w-person:child` 충돌에 걸려 ATTEMPTS를 전부 소진하고 던진다 — 실제로 재현됨
    // (테스트에서 "composeWordItems: 문장제 조합을 찾지 못했다"로 실패).
    if (tpl.hasPerson !== false) seen.add(`w-person:${person}`)
    groupPerson = tpl.hasPerson === false ? null : person
    group = {
      id: 'w1',
      kind: 'word',
      tag: 'mul-group',
      text: tpl.text(person, g, a, b),
      needsDrawing: true,
      expression: expr,
      unit: tpl.unit?.(g) ?? g.unit,
      answer: a * b,
    }
  }

  // 문항2: 몇 배. 기준량 b(2~9) × 배수 a(2~5). 문항1에 딸이 없었으면 주인공은 딸이다.
  let times: WordItem | null = null
  for (let i = 0; i < ATTEMPTS && !times; i++) {
    const a = randInt(2, 5, rand)
    const b = randInt(2, 9, rand)
    const expr = `${b}×${a}`
    if (seen.has(expr)) continue
    const g = pick(GOODS, rand)
    const tpl = pick(TIMES_TEMPLATES, rand)
    if (seen.has(`w-goods:${tpl.key(g)}`)) continue
    const childRequired = !group || groupPerson !== child
    const person = childRequired ? child : pick(people, rand)
    // w-goods와 대칭으로 완성한다: 두 문항이 같은 주인공을 쓰지 않는다. w-person 키는
    // 브리프가 이음새로 예고했지만(seen docstring) 원래 아무도 읽지 않는 죽은 쓰기였다
    // (리뷰 Minor B) — w-goods처럼 "쓰고 다른 쪽이 읽는" 대칭을 완성해 실제로 소비한다.
    // childRequired가 참이면 person은 항상 child이고, 그 정의상 group의 주인공은 child가
    // 아니므로 이 검사에 걸릴 일이 없다 — 강제 분기는 항상 안전하고, 자유 분기
    // (childRequired 거짓, 즉 문항1 주인공이 이미 child)에서만 실제로 재표집이 일어난다.
    if (seen.has(`w-person:${person}`)) continue
    const others = people.filter((p) => p !== person)
    const friend = pick(others.length > 0 ? others : ['친구'], rand)
    seen.add(expr)
    times = {
      id: 'w2',
      kind: 'word',
      tag: 'mul-times',
      text: tpl.text(person, friend, g, a, b),
      needsDrawing: false,
      expression: expr,
      unit: tpl.unit(g),
      answer: a * b,
    }
  }

  // ATTEMPTS 소진은 seen이 사실상 전 조합을 덮은 경우뿐(하루 sheet에서는 불가능).
  // 그래도 남으면 시끄럽게 실패한다 — 빈 문제지 금지는 호출자(화면 try)가 지킨다.
  if (!group || !times) throw new Error('composeWordItems: 문장제 조합을 찾지 못했다')
  return [group, times]
}
