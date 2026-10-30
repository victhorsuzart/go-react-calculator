import { vi } from 'vitest'

// A controllable fetch for the hook and component tests. Each request waits
// until the test answers it, and like a real fetch it rejects with the
// signal's reason when the signal aborts.

export type FakeRequest = {
  url: string
  body: unknown
  signal: AbortSignal
  respond: (status: number, body: unknown) => void
  fail: (error?: unknown) => void
}

export function installFakeFetch(): FakeRequest[] {
  const requests: FakeRequest[] = []
  const fetch = vi.fn(
    (url: string, init: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        const signal = init.signal!
        if (signal.aborted) return reject(signal.reason)
        signal.addEventListener('abort', () => reject(signal.reason))
        requests.push({
          url,
          body: JSON.parse(String(init.body)),
          signal,
          respond: (status, body) => {
            const text = typeof body === 'string' ? body : JSON.stringify(body)
            const type =
              typeof body === 'string' ? 'text/html' : 'application/json'
            resolve(
              new Response(text, { status, headers: { 'Content-Type': type } }),
            )
          },
          fail: (error = new TypeError('Failed to fetch')) => reject(error),
        })
      }),
  )
  vi.stubGlobal('fetch', fetch)
  return requests
}

/**
 * Makes AbortSignal.timeout follow Vitest's fake timers, which jsdom's own
 * implementation ignores. Returns the spy, so tests can check the delay.
 */
export function fakeTimeoutSignals() {
  return vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
    const controller = new AbortController()
    setTimeout(
      () =>
        controller.abort(new DOMException('signal timed out', 'TimeoutError')),
      ms,
    )
    return controller.signal
  })
}

/** "add 2 3", or "sqrt 9" when there is no second operand. */
export function requestLabel(
  op: string,
  a: string,
  b: string | null | undefined,
): string {
  return b == null ? `${op} ${a}` : `${op} ${a} ${b}`
}

/** The label of a request sent to the fake fetch, e.g. "add 2 3". */
export function describeRequest(request: FakeRequest): string {
  const { a, b } = request.body as { a: string; b?: string }
  return requestLabel(request.url.split('/').pop()!, a, b)
}
