// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { KEYS } from './keys'

describe('keys', () => {
  it('has the 22 keys of SPEC §1.1, each once', () => {
    const ids = KEYS.map((k) => k.id)
    expect(ids).toHaveLength(22)
    expect(new Set(ids).size).toBe(22)
  })

  it('follows the §7.3 grid in visual order', () => {
    expect(KEYS.map((k) => k.label).join(' ')).toBe(
      'AC ⌫ % ÷ √ xʸ ± × 7 8 9 − 4 5 6 + 1 2 3 = 0 .',
    )
    const cells = KEYS.flatMap((k) =>
      Array.from({ length: k.rowSpan ?? 1 }, (_, r) =>
        Array.from(
          { length: k.colSpan ?? 1 },
          (_, c) => `${k.row + r},${k.col + c}`,
        ),
      ).flat(),
    )
    expect(cells).toHaveLength(24) // 6 rows × 4 columns, no overlap
    expect(new Set(cells).size).toBe(24)
  })

  it('has every §5.1 shortcut exactly once', () => {
    const shortcuts = KEYS.flatMap((k) => k.shortcuts).sort()
    expect(shortcuts).toEqual(
      [
        ...'0123456789'.split(''),
        '.',
        ',',
        '+',
        '-',
        '*',
        '/',
        '^',
        'r',
        '%',
        'n',
        'Backspace',
        'Escape',
        'Delete',
        'Enter',
        '=',
      ].sort(),
    )
  })
})
