/**
 * 用户交互轨迹脱敏测试（§interaction trace）
 * 路由：无
 * API：验证元素摘要、输入脱敏和日志格式。
 */

import { describe, expect, it, vi } from 'vitest'
import {
  createInteractionEntry,
  formatInteractionLine,
  summarizeInteractionTarget,
  type InteractionTargetLike,
} from '../src/interaction'

function target(props: Partial<InteractionTargetLike> & { attrs?: Record<string, string> }): InteractionTargetLike {
  const attrs = props.attrs ?? {}
  return {
    tagName: props.tagName,
    id: props.id,
    className: props.className,
    textContent: props.textContent,
    getAttribute(name: string) {
      return attrs[name] ?? null
    },
  }
}

describe('summarizeInteractionTarget', () => {
  it('prefers test id and includes short visible text', () => {
    const summary = summarizeInteractionTarget(
      target({
        tagName: 'button',
        textContent: '保存项目',
        attrs: { 'data-testid': 'save-project' },
      }),
    )

    expect(summary).toBe('button[data-testid=save-project] "保存项目"')
  })

  it('summarizes form fields without values', () => {
    const summary = summarizeInteractionTarget(
      target({
        tagName: 'input',
        attrs: { name: 'email', type: 'email' },
      }),
    )

    expect(summary).toBe('input[name=email][type=email]')
  })

  it('falls back to simplified classes when no stable attributes exist', () => {
    const summary = summarizeInteractionTarget(
      target({
        tagName: 'div',
        className: 'panel active highlighted overflow',
      }),
    )

    expect(summary).toBe('div.panel.active.highlighted')
  })
})

describe('createInteractionEntry', () => {
  it('redacts input values and records page path', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-28T12:00:00.000Z'))

    const entry = createInteractionEntry('input', target({ tagName: 'input', attrs: { name: 'password' } }), {
      pagePath: '/login',
    })

    expect(entry).toEqual({
      kind: 'input',
      at: '2026-06-28T12:00:00.000Z',
      page_path: '/login',
      target: 'input[name=password]',
      value: '<redacted>',
    })
  })

  it('records route changes without target', () => {
    const entry = createInteractionEntry('route', undefined, {
      from: '/login',
      to: '/dashboard',
      now: new Date('2026-06-28T12:01:00.000Z'),
    })

    expect(entry).toEqual({
      kind: 'route',
      at: '2026-06-28T12:01:00.000Z',
      from: '/login',
      to: '/dashboard',
    })
  })
})

describe('formatInteractionLine', () => {
  it('formats click and redacted input entries for interaction.log', () => {
    expect(
      formatInteractionLine({
        kind: 'click',
        at: '2026-06-28T12:00:00.000Z',
        page_path: '/dashboard',
        target: 'button "保存"',
      }),
    ).toBe('[2026-06-28T12:00:00.000Z] [click] /dashboard button "保存"')

    expect(
      formatInteractionLine({
        kind: 'input',
        at: '2026-06-28T12:00:01.000Z',
        target: 'input[name=password]',
        value: '<redacted>',
      }),
    ).toBe('[2026-06-28T12:00:01.000Z] [input] input[name=password] <redacted>')
  })
})
