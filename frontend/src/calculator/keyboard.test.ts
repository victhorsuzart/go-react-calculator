// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { keyFromEvent, type KeyEventLike } from './keyboard'
import type { KeyId } from './types'

function event(key: string, extra: Partial<KeyEventLike> = {}): KeyEventLike {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    isComposing: false,
    repeat: false,
    ...extra,
  }
}

// SPEC Appendix B.6. Shift has no field: it is never checked.
describe('B.6 keyboard mapping', () => {
  it.each<[string, KeyEventLike, KeyId | null]>([
    ['"7"', event('7'), '7'],
    ['","', event(','), 'decimal'],
    ['"*" with Shift', event('*'), 'multiply'],
    ['"R"', event('R'), 'sqrt'],
    ['"Enter"', event('Enter'), 'equals'],
    ['"Escape"', event('Escape'), 'clear'],
    ['"Delete"', event('Delete'), 'clear'],
    ['"5" with repeat', event('5', { repeat: true }), '5'],
    [
      '"Backspace" with repeat',
      event('Backspace', { repeat: true }),
      'backspace',
    ],
    ['"." with repeat (kind digit)', event('.', { repeat: true }), 'decimal'],
    ['"=" with repeat', event('=', { repeat: true }), null],
    ['"r" with Ctrl', event('r', { ctrlKey: true }), null],
    ['"x"', event('x'), null],
    ['any key with isComposing', event('7', { isComposing: true }), null],
  ])('%s', (_, e, want) => {
    expect(keyFromEvent(e)).toBe(want)
  })

  it.each([
    ['Meta', { metaKey: true }],
    ['Alt', { altKey: true }],
  ] as const)('"7" with %s is ignored', (_, extra) => {
    expect(keyFromEvent(event('7', extra))).toBeNull()
  })
})
