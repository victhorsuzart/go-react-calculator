import { KEYS } from './keys'
import type { KeyId } from './types'

/** The parts of a KeyboardEvent the mapping looks at. */
export type KeyEventLike = {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  isComposing: boolean
  repeat: boolean
}

const byShortcut = new Map<string, KeyId>(
  KEYS.flatMap((k) => k.shortcuts.map((s) => [s, k.id] as const)),
)

// event.repeat is accepted only for digit keys and Backspace (SPEC §7.2).
const repeatable = new Set<KeyId>(
  KEYS.filter((k) => k.kind === 'digit' || k.id === 'backspace').map(
    (k) => k.id,
  ),
)

/**
 * Maps a keydown event to a calculator key (SPEC §7.2), or null when the
 * event is not handled. Letters are case-insensitive and Shift is accepted.
 */
export function keyFromEvent(e: KeyEventLike): KeyId | null {
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return null
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
  const id = byShortcut.get(key)
  if (id === undefined) return null
  if (e.repeat && !repeatable.has(id)) return null
  return id
}
