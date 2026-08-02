import { getDay, getMeta, putDay, getAllDays } from '../data/db'
import { dayKey } from '../engine/dates'
import { deriveTypes } from '../engine/derive'
import { composeSheet } from '../engine/compose'
import type { Day, InverseItem, VerticalItem } from '../data/types'
import { el, formatDate, navigate, showError } from '../ui'

function digits(n: number): string {
  return String(n)
    .padStart(3, ' ')
    .split('')
    .map((c) => `<i>${c === ' ' ? '' : c}</i>`)
    .join('')
}

function verticalHtml(item: VerticalItem, index: number): string {
  const marks = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭'
  return `
    <div class="vprob">
      <span class="vnum">${marks[index] ?? index + 1}</span>
      <div class="vcalc">
        <div class="vcarry"></div>
        <div class="vline"><b></b>${digits(item.a)}</div>
        <div class="vline"><b>${item.op}</b>${digits(item.b)}</div>
        <div class="vrule"></div>
        <div class="vans"></div>
      </div>
    </div>`
}

function inverseHtml(item: InverseItem, index: number): string {
  const marks = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭'
  const box = '<span class="inv-box"></span>'
  const eq =
    item.template === 'a+?=c'
      ? `${item.a} + ${box} = ${item.c}`
      : item.template === '?+b=c'
        ? `${box} + ${item.b} = ${item.c}`
        : item.template === 'a-?=c'
          ? `${item.a} − ${box} = ${item.c}`
          : `${box} − ${item.b} = ${item.c}`
  return `
    <div class="inv">
      <div class="inv-eq"><span class="n">${marks[index] ?? index + 1}</span>${eq}</div>
      ${item.hint ? `<div class="inv-hint">${item.hint}</div>` : ''}
    </div>`
}

/**
 * 오늘 문제지를 연다.
 * 이미 만들어진 날이면 저장된 sheet를 그대로 렌더한다 — 재인쇄 시 문제가 달라지면
 * 채점 화면이 어느 종이 기준인지 알 수 없게 된다.
 */
export async function renderPrint(root: HTMLElement): Promise<void> {
  const today = dayKey(new Date())
  let day = await getDay(today)

  // sheet가 빈 채로 저장된 날(예: 아직 채우지 않은 checkup day)도 새로 만든 적 없는
  // 날과 똑같이 취급한다 — 빈 문제지를 내지 않기 위함. 이미 채워진 sheet는 여기서
  // 절대 다시 만들지 않는다(재인쇄 시 채점 화면과 어긋나지 않도록).
  if (!day || day.sheet.length === 0) {
    try {
      const meta = await getMeta()
      const types = deriveTypes(await getAllDays())
      const sheet = composeSheet({ settings: meta.settings, types })
      day = { date: today, kind: 'normal', sheet } satisfies Day
      await putDay(day)
    } catch (e) {
      showError(`문제지를 만들지 못했어요: ${(e as Error).message}`)
      root.replaceChildren(
        el(`
          <div>
            <button class="step" id="back" style="margin:0">← 홈</button>
          </div>
        `)
      )
      root.querySelector('#back')!.addEventListener('click', () => navigate('#/'))
      return
    }
  }

  const verticals = day.sheet.filter((i): i is VerticalItem => i.kind === 'vertical')
  const inverses = day.sheet.filter((i): i is InverseItem => i.kind === 'inverse')

  root.replaceChildren(
    el(`
      <div>
        <div class="no-print" style="display:flex;gap:8px;margin-bottom:16px">
          <button class="step" id="back" style="margin:0">← 홈</button>
          <button class="step" id="print" style="margin:0">인쇄하기</button>
        </div>
        <div class="sheet">
          <div class="sheet-head">
            <div>
              <div class="sheet-title">하루치</div>
              <div class="sheet-date">${formatDate(today, true)}</div>
            </div>
            <div class="sheet-name">이름 <u></u></div>
          </div>
          <div class="sheet-sec">1. 계산해 보세요.</div>
          <div class="vgrid">${verticals.map((v, i) => verticalHtml(v, i)).join('')}</div>
          <div class="sheet-sec" style="margin-top:14px">2. □ 안에 알맞은 수를 써넣으세요.</div>
          ${inverses.map((v, i) => inverseHtml(v, verticals.length + i)).join('')}
        </div>
      </div>
    `)
  )

  root.querySelector('#back')!.addEventListener('click', () => navigate('#/'))
  root.querySelector('#print')!.addEventListener('click', () => window.print())
}
