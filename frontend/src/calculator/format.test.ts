// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { formatNumber } from './format'

// SPEC Appendix B.5.
describe('B.5 display formatting', () => {
  it.each([
    ['123', '123'],
    ['1234', '1,234'],
    ['-1234.50', '-1,234.50'],
    ['1000.', '1,000.'],
    ['999999999999999', '999,999,999,999,999'],
    ['0.000001', '0.000001'],
    ['1.21932631112635e+17', '1.21932631112635e+17'],
    ['-0', '-0'],
  ])('%s → %s', (entry, shown) => {
    expect(formatNumber(entry)).toBe(shown)
  })
})
