import { useCallback, useEffect, useReducer, useRef } from 'react'
import { calculate } from '../api/client'
import { initialState, reducer } from './reducer'
import type { CalcResult, KeyId, State } from './types'

const TIMEOUT_MS = 5000
const LOADING_DELAY_MS = 300

const TIMED_OUT: CalcResult = {
  ok: false,
  error: { kind: 'system', reason: 'timeout' },
}
const NETWORK: CalcResult = {
  ok: false,
  error: { kind: 'system', reason: 'network' },
}
const UNKNOWN: CalcResult = {
  ok: false,
  error: { kind: 'system', reason: 'unknown' },
}

/**
 * The calculator state plus the one effect that performs its requests
 * (SPEC §6.1). `state.loading` turns on once a run of back-to-back requests
 * has lasted 300 ms.
 */
export function useCalculator(): {
  state: State
  press: (key: KeyId) => void
} {
  const [state, dispatch] = useReducer(reducer, initialState)
  const run = useRef<{ id: number; start: number } | null>(null)
  const { pending } = state

  // The reducer keeps the same pending object while a request is in flight,
  // so this runs once per request. AC or unmount aborts it through cleanup.
  useEffect(() => {
    if (!pending) return
    const controller = new AbortController()
    const timeout = AbortSignal.timeout(TIMEOUT_MS)
    const signal = AbortSignal.any([timeout, controller.signal])
    const settle = (res: CalcResult) =>
      dispatch(
        res.ok
          ? { type: 'RESOLVED', id: pending.id, result: res.result }
          : { type: 'FAILED', id: pending.id, error: res.error },
      )
    calculate(pending.op, pending.a, pending.b, signal)
      .then((res) => {
        // An abort we didn't cause is the timeout if it fired (some engines
        // report it as a plain AbortError); otherwise the browser cut it off.
        const foreignAbort =
          !res.ok && res.error.kind === 'aborted' && !controller.signal.aborted
        if (!foreignAbort) settle(res)
        else settle(timeout.aborted ? TIMED_OUT : NETWORK)
      })
      // calculate() never rejects; this only guarantees the request clears.
      .catch(() => settle(UNKNOWN))

    // The 300 ms count runs from the start of the run, not of this request.
    if (run.current?.id !== pending.runId) {
      run.current = { id: pending.runId, start: Date.now() }
    }
    const elapsed = Date.now() - run.current.start
    const timer = setTimeout(
      () => dispatch({ type: 'LOADING', runId: pending.runId }),
      Math.max(0, LOADING_DELAY_MS - elapsed),
    )
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [pending])

  const press = useCallback((key: KeyId) => dispatch({ type: 'KEY', key }), [])

  return { state, press }
}
