import { useEffect, useState } from 'react'
import { Display } from './Display'
import { keyFromEvent } from './keyboard'
import { Keypad } from './Keypad'
import { SYSTEM_MESSAGES } from './messages'
import type { KeyId } from './types'
import { useCalculator } from './useCalculator'
import styles from './Calculator.module.css'

const FLASH_MS = 100

export function Calculator() {
  const { state, press } = useCalculator()
  // A new object per key press, so pressing the same key again re-flashes it.
  const [flash, setFlash] = useState<{ key: KeyId } | null>(null)

  // Physical keyboard (SPEC §7.2). The listener never reads the state.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Enter on a button reached with Tab activates that button natively.
      if (
        e.key === 'Enter' &&
        document.activeElement instanceof HTMLButtonElement
      ) {
        return
      }
      const key = keyFromEvent(e)
      if (key === null) return
      e.preventDefault()
      press(key)
      setFlash({ key })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [press])

  useEffect(() => {
    if (!flash) return
    const timer = setTimeout(() => setFlash(null), FLASH_MS)
    return () => clearTimeout(timer)
  }, [flash])

  return (
    <div className={styles.card}>
      <h1 className={styles.visuallyHidden}>Calculator</h1>
      <Display state={state} />
      {state.banner && (
        <p role="alert" className={styles.banner}>
          {SYSTEM_MESSAGES[state.banner]}
        </p>
      )}
      <Keypad flashing={flash?.key ?? null} onPress={press} />
    </div>
  )
}
