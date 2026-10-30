import { act, renderHook } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  describeRequest,
  fakeTimeoutSignals,
  installFakeFetch,
  type FakeRequest,
} from '../test/fakeFetch'
import { mainLine } from './reducer'
import type { KeyId } from './types'
import { useCalculator } from './useCalculator'

let requests: FakeRequest[]
let timeoutSpy: ReturnType<typeof fakeTimeoutSignals>

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  timeoutSpy = fakeTimeoutSignals()
  requests = installFakeFetch()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function press(
  result: { current: ReturnType<typeof useCalculator> },
  keys: KeyId[],
) {
  for (const key of keys) act(() => result.current.press(key))
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setImmediate(resolve))
    }
  })
}

describe('useCalculator', () => {
  it('makes one request, with a 5 s timeout, however many keys are queued', async () => {
    const { result } = renderHook(useCalculator)
    press(result, ['2', 'add', '3', 'equals', '4', '5', '6'])
    expect(requests.map(describeRequest)).toEqual(['add 2 3'])
    expect(timeoutSpy).toHaveBeenCalledTimes(1)
    expect(timeoutSpy).toHaveBeenCalledWith(5000)

    requests[0]!.respond(200, { result: '5' })
    await settle()
    expect(mainLine(result.current.state).text).toBe('456')
  })

  it('reports loading after 300 ms and clears it with the response', async () => {
    const { result } = renderHook(useCalculator)
    press(result, ['2', 'add', '3', 'equals'])
    await act(() => vi.advanceTimersByTimeAsync(299))
    expect(result.current.state.loading).toBe(false)
    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(result.current.state.loading).toBe(true)
    requests[0]!.respond(200, { result: '5' })
    await settle()
    expect(result.current.state.loading).toBe(false)
  })

  it('keeps loading on while a queued key starts the next request', async () => {
    const { result } = renderHook(useCalculator)
    press(result, ['2', 'add', '3', 'add', '4', 'equals'])
    await act(() => vi.advanceTimersByTimeAsync(300))
    expect(result.current.state.loading).toBe(true)
    requests[0]!.respond(200, { result: '5' })
    await settle()
    expect(requests.map(describeRequest)).toEqual(['add 2 3', 'add 5 4'])
    expect(result.current.state.loading).toBe(true)
    requests[1]!.respond(200, { result: '9' })
    await settle()
    expect(result.current.state.loading).toBe(false)
  })

  it('treats a plain AbortError after the 5 s timeout as a timeout', async () => {
    // Some engines reject with a generic AbortError instead of the reason.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal!.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            )
          }),
      ),
    )
    const { result } = renderHook(useCalculator)
    press(result, ['2', 'add', '3', 'equals'])
    await act(() => vi.advanceTimersByTimeAsync(5000))
    await settle()
    expect(result.current.state.banner).toBe('timeout')
    expect(result.current.state.pending).toBeNull()
  })

  it('treats an AbortError before the timeout that it did not cause as network', async () => {
    const { result } = renderHook(useCalculator)
    press(result, ['2', 'add', '3', 'equals'])
    requests[0]!.fail(new DOMException('aborted', 'AbortError'))
    await settle()
    expect(result.current.state.banner).toBe('network')
    expect(result.current.state.pending).toBeNull()
  })

  it('shows loading once a run of short chained requests reaches 300 ms', async () => {
    const { result } = renderHook(useCalculator)
    press(result, ['2', 'add', '3', 'add', '4', 'add', '5', 'equals'])
    await act(() => vi.advanceTimersByTimeAsync(250))
    requests[0]!.respond(200, { result: '5' })
    await settle()
    expect(result.current.state.loading).toBe(false)
    await act(() => vi.advanceTimersByTimeAsync(50))
    expect(requests.map(describeRequest)).toEqual(['add 2 3', 'add 5 4'])
    expect(result.current.state.loading).toBe(true)
  })

  it('clears the request even if the client rejects', async () => {
    // A response whose status read throws after the first one makes
    // calculate() reject, which it never does on its own.
    let reads = 0
    const broken = {
      get status() {
        if (reads++ > 0) throw new Error('broken')
        return 200
      },
      text: async () => '{}',
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => broken),
    )
    const { result } = renderHook(useCalculator)
    press(result, ['2', 'add', '3', 'equals'])
    await settle()
    expect(result.current.state.banner).toBe('unknown')
    expect(result.current.state.pending).toBeNull()
  })

  it('aborts the request on unmount', () => {
    const { result, unmount } = renderHook(useCalculator)
    press(result, ['2', 'add', '3', 'equals'])
    unmount()
    expect(requests[0]!.signal.aborted).toBe(true)
  })

  it('applies one response under StrictMode', async () => {
    const { result } = renderHook(useCalculator, { wrapper: StrictMode })
    press(result, ['2', 'add', '3', 'equals'])
    const live = requests.filter((r) => !r.signal.aborted)
    expect(live).toHaveLength(1)
    live[0]!.respond(200, { result: '5' })
    await settle()
    expect(mainLine(result.current.state).text).toBe('5')
    expect(result.current.state.pending).toBeNull()
  })
})
