import { formatNumber } from './format'
import { mainLine, upperLine } from './reducer'
import type { State } from './types'
import styles from './Display.module.css'

/** The class for the first limit the length fits under, else the last class. */
function step(
  length: number,
  limits: readonly number[],
  classes: readonly (string | undefined)[],
): string | undefined {
  const index = limits.findIndex((limit) => length <= limit)
  return classes[index === -1 ? limits.length : index]
}

// Main line: ≤ 9, 10–13, ≥ 14 characters (SPEC §7.1).
const MAIN_LIMITS = [9, 13]
const MAIN_CLASSES = [styles.large, styles.medium, styles.small]
// The upper line steps the same way for its longer text, up to "R × R =" with
// two 23-character operands (51 characters, plus the loading indicator).
const UPPER_LIMITS = [24, 34, 44]
const UPPER_CLASSES = [
  styles.upperLarge,
  styles.upperMedium,
  styles.upperSmall,
  styles.upperTiny,
]
const INDICATOR = '…'

export function Display({ state }: { state: State }) {
  const main = mainLine(state)
  const mainText = main.kind === 'number' ? formatNumber(main.text) : main.text
  const upperText = upperLine(state, formatNumber)
  // The indicator and its gap count as two characters of the upper line.
  const upperLength = upperText.length + (state.loading ? 2 : 0)
  return (
    <div
      role="group"
      aria-label="Display"
      aria-busy={state.loading}
      className={styles.display}
    >
      {/* The upper line is outside the live region (SPEC §7.3). */}
      <p
        className={`${styles.upper} ${step(upperLength, UPPER_LIMITS, UPPER_CLASSES)}`}
      >
        {upperText}
        {state.loading && (
          <span aria-hidden="true" className={styles.loading}>
            {INDICATOR}
          </span>
        )}
      </p>
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className={`${styles.main} ${step(mainText.length, MAIN_LIMITS, MAIN_CLASSES)}`}
      >
        {mainText}
      </div>
    </div>
  )
}
