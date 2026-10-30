import type { DomainCode, SystemReason } from './types'

// User-facing messages (SPEC §6.2). The backend's detail is never shown.

/** Shown on the main line. */
export const DOMAIN_MESSAGES: Record<DomainCode, string> = {
  DIVISION_BY_ZERO: 'Cannot divide by zero',
  UNDEFINED_RESULT: 'Not a real number',
  RESULT_OUT_OF_RANGE: 'Out of range',
}

/** Shown in the banner below the display. */
export const SYSTEM_MESSAGES: Record<SystemReason, string> = {
  timeout: 'The server took too long. Try again.',
  network: "Can't reach the server. Try again.",
  unknown: 'Something went wrong. Try again.',
}
