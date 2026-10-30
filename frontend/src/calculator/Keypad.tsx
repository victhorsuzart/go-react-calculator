import { Key } from './Key'
import { KEYS } from './keys'
import type { KeyId } from './types'
import styles from './Keypad.module.css'

type Props = {
  flashing: KeyId | null
  onPress: (key: KeyId) => void
}

/** The keypad, generated from keys.ts in visual and tab order (SPEC §7.3). */
export function Keypad({ flashing, onPress }: Props) {
  return (
    <div role="group" aria-label="Keypad" className={styles.keypad}>
      {KEYS.map((def) => (
        <Key
          key={def.id}
          def={def}
          flashing={def.id === flashing}
          onPress={onPress}
        />
      ))}
    </div>
  )
}
