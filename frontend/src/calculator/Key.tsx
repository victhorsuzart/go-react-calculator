import { isRepeatable } from './keyboard'
import type { KeyDef } from './keys'
import type { KeyId } from './types'
import styles from './Key.module.css'

/** A shortcut as shown to people: letters in upper case. */
function shortcutLabel(shortcut: string): string {
  return shortcut.length === 1 ? shortcut.toUpperCase() : shortcut
}

/**
 * A shortcut in aria-keyshortcuts syntax, where "+" separates modifiers, so
 * the plus key itself is named "Plus".
 */
function ariaShortcut(shortcut: string): string {
  return shortcut === '+' ? 'Plus' : shortcutLabel(shortcut)
}

/** e.g. "Square root (R)", "All clear (Escape or Delete)". */
function title(def: KeyDef): string {
  const name = def.name.charAt(0).toUpperCase() + def.name.slice(1)
  return `${name} (${def.shortcuts.map(shortcutLabel).join(' or ')})`
}

type Props = {
  def: KeyDef
  flashing: boolean
  onPress: (key: KeyId) => void
}

export function Key({ def, flashing, onPress }: Props) {
  const className = [
    styles.key,
    styles[def.kind],
    (def.rowSpan ?? def.colSpan) && styles.spanning,
    flashing && styles.flash,
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <button
      type="button"
      className={className}
      aria-label={def.name}
      title={title(def)}
      aria-keyshortcuts={def.shortcuts.map(ariaShortcut).join(' ')}
      // Grid coordinates come from keys.ts; all styling is in Key.module.css.
      style={{
        gridRow: `${def.row} / span ${def.rowSpan ?? 1}`,
        gridColumn: `${def.col} / span ${def.colSpan ?? 1}`,
      }}
      // A click must not focus the button, and it drops focus from a key reached
      // with Tab, so Enter means "=" again after mouse input (SPEC §7.2).
      onMouseDown={(e) => {
        e.preventDefault()
        if (document.activeElement instanceof HTMLButtonElement) {
          document.activeElement.blur()
        }
      }}
      // Holding Enter on a key reached with Tab repeats its native click; only
      // digits and Backspace may repeat (SPEC §7.2).
      onKeyDown={(e) => {
        if (e.repeat && !isRepeatable(def.id)) e.preventDefault()
      }}
      onClick={() => onPress(def.id)}
    >
      {def.label}
    </button>
  )
}
