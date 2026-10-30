/**
 * Adds en-US thousands separators to the integer part of a number shown on
 * the display (SPEC §7.1). The sign, the fraction, the exponent, a trailing
 * "." and typed zeros are kept as they are. Pure text; no number conversion.
 */
export function formatNumber(text: string): string {
  const sign = text.startsWith('-') ? '-' : ''
  const unsigned = text.slice(sign.length)
  const end = unsigned.search(/[.eE]/)
  const integer = end === -1 ? unsigned : unsigned.slice(0, end)
  const rest = end === -1 ? '' : unsigned.slice(end)
  return sign + integer.replace(/\B(?=(\d{3})+$)/g, ',') + rest
}
