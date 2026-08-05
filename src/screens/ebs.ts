import type { FactState, TypeState } from '../data/types'
import { getAllDays, getMeta } from '../data/db'
import { deriveTypes } from '../engine/derive'
import {
  EBS_COURSES,
  EBS_TOPICS,
  courseUrl,
  ebsBadge,
  ebsProgress,
  fmtLectures,
  type EbsTopic,
} from '../engine/ebs'
import { deriveFacts } from '../engine/facts'
import { el, navigate, showError } from '../ui'

const KIND_LABEL = { drill: '계산 연습', concept: '개념' } as const

/**
 * 주제 카드 하나. 템플릿에 들어가는 값은 전부 카탈로그 리터럴과 엔진이 계산한
 * 숫자뿐이라 escapeHtml이 필요 없다 — 외부 문자열을 넣게 되면 그때는 거칠 것.
 */
function topicHtml(
  topic: EbsTopic,
  facts: Record<string, FactState>,
  types: Record<string, TypeState>,
): string {
  const p = ebsProgress(topic, facts)
  const done = p !== null && p.fluent === p.total
  const flag = done
    ? ' <span class="ebs-flag">🎉 다 뗐어요!</span>'
    : ebsBadge(topic, types)
      ? ' <span class="ebs-active seed-badge__root seed-badge__root--size_medium seed-badge__root--tone_neutral-variant_weak">문제지에 나와요</span>'
      : ''
  const sub = topic.subtitle ? ` <small>${topic.subtitle}</small>` : ''
  const links = topic.refs
    .map((ref) => {
      const c = EBS_COURSES[ref.course]
      return `<a class="ebs-link" href="${courseUrl(ref.course)}" target="_blank" rel="noopener"><b>${fmtLectures(ref.from, ref.to)}</b> ${c.name} <i>${KIND_LABEL[c.kind]}</i></a>`
    })
    .join('')
  const progress =
    p === null || done
      ? ''
      : `<div class="ebs-bar"><i style="width:${Math.round((p.fluent / p.total) * 100)}%"></i></div>
         <div class="ebs-count">정복 ${p.fluent}/${p.total}칸</div>`
  return `
    <section class="ebs-topic">
      <h3>${topic.title}${sub}${flag}</h3>
      <div class="ebs-links">${links}</div>
      ${progress}
    </section>`
}

/**
 * EBS 강의 서가 — 주제 축으로 강의를 고르는 화면(아이·부모 공용, 소속은 아이).
 *
 * 주제↔강 매핑은 engine/ebs.ts 카탈로그가 단일 출처이고, 그 카탈로그의 원본은
 * docs/reference/ebs-manjeomwang-lecture-mapping.md §2다. EBS에는 강 단위
 * 딥링크가 없어(2026-08-04 실측) 링크는 강좌 페이지까지만 가고, 아이는 카드의
 * 강 번호를 EBS 목록의 같은 번호와 맞춰 찾는다.
 *
 * 여기의 navigate()는 '← 홈'(#/) 하나뿐이어야 한다 — 아이 소속 화면이므로
 * 부모 화면으로 가는 경로를 만들지 않는다(CLAUDE.md 불변식). 하단의 '아빠 참고'
 * 접힘 구역은 텍스트만 담는다 — 링크·버튼을 넣게 되면 이 불변식을 다시 볼 것.
 */
export async function renderEbs(root: HTMLElement): Promise<void> {
  try {
    const meta = await getMeta()
    const days = await getAllDays()
    const facts = deriveFacts(days, meta.settings.fluentMs)
    const types = deriveTypes(days)
    const group = (g: EbsTopic['group']) =>
      EBS_TOPICS.filter((t) => t.group === g)
        .map((t) => topicHtml(t, facts, types))
        .join('')

    root.replaceChildren(
      el(`
        <div>
          <h1>EBS 강의 보기</h1>
          <div class="date">보고 싶은 것을 골라서 눌러 보세요</div>
          <h2 class="ebs-group">구구단</h2>
          ${group('gugudan')}
          <h2 class="ebs-group">더 나아가기</h2>
          ${group('ahead')}
          <h2 class="ebs-group">복습하고 싶을 때</h2>
          ${group('review')}
          <details class="ebs-parent">
            <summary>아빠 참고 — 로드맵과 주의사항</summary>
            <ul>
              <li><b>2026년 8월~12월 (2-2 학기)</b> 학교 진도에 맞춰 연산 4단계를 한 묶음씩. 여름방학엔 2·5단(+도입했다면 3·6단)까지만 — 81식 전면 진도는 금지</li>
              <li><b>2026년 11월</b> 7단·9단 정체는 정상 — 강의 재시청 용도로 쓰기</li>
              <li><b>2027년 1~2월 (겨울방학) ★</b> 곱셈구구 완성(15·16번) + 역인출 훈련(앱 담당). 연산 5단계 나눗셈은 미리 열지 않기 — 역인출이 먼저다</li>
              <li><b>2027년 3월~ (3학년)</b> 학교보다 반 박자 늦게, 강의 단위로. 3-2는 절차 부하 정점 — 분량 조절이 관건</li>
              <li>원본: docs/reference/ebs-manjeomwang-lecture-mapping.md §4 (조사일 2026-08-03)</li>
            </ul>
          </details>
          <button class="step" id="back">← 홈</button>
        </div>
      `),
    )
    root.querySelector('#back')!.addEventListener('click', () => navigate('#/'))
  } catch (e) {
    showError('강의 목록을 열지 못했어요.', e)
    root.replaceChildren(el(`<div><button class="step" id="back">← 홈</button></div>`))
    root.querySelector('#back')!.addEventListener('click', () => navigate('#/'))
  }
}
