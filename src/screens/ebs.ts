import { el, navigate } from '../ui'

// 이 화면의 내용은 docs/reference/ebs-manjeomwang-lecture-mapping.md §4(로드맵 구간별
// 시청 배정)를 모바일에 맞게 추린 것이다. 매핑 문서가 갱신되면(EBS 연도판 개편,
// 구간 전환) 여기 상수도 함께 고친다 — 문서가 원본이고 이 화면은 사본이다.
const courseUrl = (id: number) => `https://primary.ebs.co.kr/course/view?courseId=${id}`

const COURSE = {
  yeonsan4: { name: '연산 4단계', id: 100004642 },
  yeonsan5: { name: '연산 5단계', id: 100006155 },
  yeonsan6: { name: '연산 6단계', id: 100006156 },
  suhak22: { name: '수학 2-2', id: 100005136 },
  suhak31: { name: '수학 3-1', id: 100006149 },
  suhak32: { name: '수학 3-2', id: 100006220 },
} as const

type CourseKey = keyof typeof COURSE

interface Segment {
  title: string
  period: string
  goal: string
  /** 각 항목: 강좌 링크(course가 있으면)와 강 범위·설명 */
  items: { course?: CourseKey; text: string }[]
  caution?: string
}

const SEGMENTS: Segment[] = [
  {
    title: '구간 A',
    period: '2026년 8월 (여름방학)',
    goal: '곱셈구구 2단·5단 유창까지 — 3·6단은 도입만',
    items: [
      { course: 'yeonsan4', text: '01~02강 (2단, 5단)' },
      { text: '3·6단을 도입하면 03~04강까지' },
    ],
    caution: '05강 이후는 보류 — 81식 전면 진도는 금지',
  },
  {
    title: '구간 B',
    period: '2026년 9월 ~ 12월 (2학년 2학기)',
    goal: '학교 진도(2→5→3·6→4·8→7·9)에 맞춰 따라가기',
    items: [
      { course: 'yeonsan4', text: '03~14강 — 학교 진도에 맞춰 한 묶음씩' },
      { course: 'suhak22', text: '10~21강 (곱셈구구 단원) — 묶어세기·배 개념 보강' },
    ],
    caution: '11월 7단·9단 정체는 정상 — 강의 재시청 용도로 쓰기',
  },
  {
    title: '구간 C ★',
    period: '2027년 1월 ~ 2월 (겨울방학)',
    goal: '81식 유창 마무리 + 역인출 훈련(앱 담당)',
    items: [
      { course: 'yeonsan4', text: '15~16강 (곱셈구구의 완성)' },
      { course: 'yeonsan4', text: '13~14강 (1단·0의 곱·곱셈표) — 필요시 재시청' },
    ],
    caution: '연산 5단계 나눗셈 강의는 미리 열지 않기 — 역인출이 먼저다',
  },
  {
    title: '구간 D',
    period: '2027년 3월 ~ 2028년 2월 (3학년)',
    goal: '학교보다 반 박자 늦게, 강의 단위로 따라가기',
    items: [
      { course: 'suhak31', text: '01~10강 덧뺄 · 18~24강 나눗셈 · 25~33강 곱셈 · 42~51강 분수와 소수' },
      { course: 'yeonsan5', text: '01~11강 덧뺄 · 12~17강 나눗셈 · 18~25강 곱셈' },
      { course: 'suhak32', text: '01~17강 곱셈·나눗셈 · 25~33강 분수 (9월~)' },
      { course: 'yeonsan6', text: '01~19강 곱셈·나눗셈 · 20~24강 분수 (9월~)' },
    ],
    caution: '3-2는 절차 부하 정점 — 분량 조절이 관건',
  },
]

function itemHtml(item: Segment['items'][number]): string {
  if (!item.course) return `<li>${item.text}</li>`
  const c = COURSE[item.course]
  return `<li><a href="${courseUrl(c.id)}" target="_blank" rel="noopener">${c.name}</a> ${item.text}</li>`
}

function segmentHtml(s: Segment): string {
  return `
    <section class="ebs-segment">
      <h2>${s.title} <span class="ebs-period">${s.period}</span></h2>
      <p class="ebs-goal">${s.goal}</p>
      <ul>${s.items.map(itemHtml).join('')}</ul>
      ${s.caution ? `<p class="ebs-caution">⚠️ ${s.caution}</p>` : ''}
    </section>
  `
}

/** EBS 만점왕 강의 참조 화면. 정적 상수만 렌더하므로 DB를 읽지 않는다. */
export function renderEbs(root: HTMLElement): void {
  root.replaceChildren(
    el(`
      <div>
        <h1>EBS 강의 보기</h1>
        <div class="date">로드맵 구간별 만점왕 시청 목록 · 조사일 2026-08-03</div>
        ${SEGMENTS.map(segmentHtml).join('')}
        <button class="step" id="back">← 홈</button>
      </div>
    `),
  )
  root.querySelector('#back')!.addEventListener('click', () => navigate('#/'))
}
