import { describe, it, expect } from 'vitest'
import { escapeHtml } from './ui'

describe('escapeHtml', () => {
  it('꺾쇠괄호를 엔티티로 바꾼다', () => {
    expect(escapeHtml('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('앰퍼샌드를 엔티티로 바꾼다', () => {
    expect(escapeHtml('A & B')).toBe('A &amp; B')
  })

  it('따옴표를 엔티티로 바꾼다', () => {
    expect(escapeHtml(`"double" and 'single'`)).toBe('&quot;double&quot; and &#39;single&#39;')
  })

  it('&를 먼저 치환해 이중 이스케이프를 만들지 않는다', () => {
    // <, >를 먼저 치환한 뒤 &를 치환하면, 방금 만든 &lt;·&gt;의 &까지 다시 걸려
    // &amp;lt;가 되어 브라우저에 "&lt;"라는 글자 그대로 노출된다(이중 이스케이프).
    // &를 가장 먼저 치환해야 <div>가 정확히 &lt;div&gt; 하나로만 이스케이프된다.
    expect(escapeHtml('<div>')).toBe('&lt;div&gt;')
  })

  it('평범한 문자열은 그대로 둔다', () => {
    expect(escapeHtml('7×8=56')).toBe('7×8=56')
  })
})
