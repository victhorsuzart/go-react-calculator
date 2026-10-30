// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CalcResult, DomainCode, Op } from '../calculator/types'
import { calculate } from './client'

const signal = new AbortController().signal

/** Stubs fetch to answer once with the given status and body. */
function answer(status: number, body: unknown) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () => new Response(text, { status }),
  )
  vi.stubGlobal('fetch', fetch)
  return fetch
}

function reject(error: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Promise.reject(error)),
  )
}

function problem(status: number, code: string, detail = 'Some detail.') {
  return { type: 'about:blank', title: 'T', status, detail, code }
}

const html = '<html><body>Bad Gateway</body></html>'

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// SPEC §6.2, one block per row of the response table.
describe('§6.2 classification', () => {
  it('200 with {"result": string} is ok', async () => {
    const fetch = answer(200, { result: '5' })
    expect(await calculate('add', '2', '3', signal)).toEqual({
      ok: true,
      result: '5',
    })
    expect(fetch).toHaveBeenCalledWith('/api/v1/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"a":"2","b":"3"}',
      signal,
    })
  })

  it('sends only a for sqrt', async () => {
    const fetch = answer(200, { result: '3' })
    await calculate('sqrt', '9', null, signal)
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/sqrt',
      expect.objectContaining({ body: '{"a":"9"}' }),
    )
  })

  it.each([
    'DIVISION_BY_ZERO',
    'UNDEFINED_RESULT',
    'RESULT_OUT_OF_RANGE',
  ] as const)('422 with %s is a domain error', async (code) => {
    answer(422, problem(422, code))
    expect(await calculate('divide', '5', '0', signal)).toEqual({
      ok: false,
      error: { kind: 'domain', code },
    })
  })

  it('TimeoutError is system/timeout', async () => {
    reject(new DOMException('signal timed out', 'TimeoutError'))
    expect(await calculate('add', '2', '3', signal)).toEqual({
      ok: false,
      error: { kind: 'system', reason: 'timeout' },
    })
  })

  it('a rejected fetch is system/network', async () => {
    reject(new TypeError('Failed to fetch'))
    expect(await calculate('add', '2', '3', signal)).toEqual({
      ok: false,
      error: { kind: 'system', reason: 'network' },
    })
  })

  it.each([502, 503, 504])('%i is system/network', async (status) => {
    answer(status, html)
    expect(await calculate('add', '2', '3', signal)).toEqual({
      ok: false,
      error: { kind: 'system', reason: 'network' },
    })
  })

  it('releases a gateway error body without reading it', async () => {
    const cancel = vi.fn(() => {
      throw new Error('stream already closed')
    })
    const body = new ReadableStream({ cancel })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { status: 502 })),
    )
    expect(await calculate('add', '2', '3', signal)).toEqual({
      ok: false,
      error: { kind: 'system', reason: 'network' },
    })
    expect(cancel).toHaveBeenCalled()
  })

  it('AbortError is aborted', async () => {
    reject(new DOMException('aborted', 'AbortError'))
    expect(await calculate('add', '2', '3', signal)).toEqual({
      ok: false,
      error: { kind: 'aborted' },
    })
  })

  it('an abort while reading the body is aborted', async () => {
    const response = new Response('{"result":"5"}', { status: 200 })
    vi.spyOn(response, 'text').mockRejectedValue(
      new DOMException('aborted', 'AbortError'),
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response),
    )
    expect(await calculate('add', '2', '3', signal)).toEqual({
      ok: false,
      error: { kind: 'aborted' },
    })
  })

  it.each<[string, number, unknown]>([
    ['500', 500, problem(500, 'INTERNAL_ERROR')],
    ['400 problem', 400, problem(400, 'VALIDATION_FAILED')],
    ['200 non-JSON', 200, html],
    ['200 unexpected shape', 200, { result: 5 }],
    ['200 array', 200, []],
    ['422 unknown code', 422, problem(422, 'SOMETHING_NEW')],
    ['422 HTML', 422, html],
  ])('anything else (%s) is system/unknown', async (_, status, body) => {
    answer(status, body)
    expect(await calculate('add', '2', '3', signal)).toEqual({
      ok: false,
      error: { kind: 'system', reason: 'unknown' },
    })
  })

  it('sends the backend detail to the console only', async () => {
    answer(422, problem(422, 'DIVISION_BY_ZERO', 'Cannot divide by zero.'))
    const result = await calculate('divide', '5', '0', signal)
    expect(console.warn).toHaveBeenCalledWith('Cannot divide by zero.')
    expect(JSON.stringify(result)).not.toContain('Cannot divide')
  })
})

type ContractCase = {
  name: string
  method: string
  path: string
  body: { a?: unknown; b?: unknown } | null
  status: number
  response: { result?: string; code?: string }
}

// Read at runtime so the frontend build never depends on contract/ (SPEC §9.3).
const contract = JSON.parse(
  readFileSync(
    new URL('../../../contract/examples.json', import.meta.url),
    'utf8',
  ),
) as ContractCase[]

function expected(c: ContractCase): CalcResult {
  if (c.status === 200) return { ok: true, result: c.response.result! }
  if (c.status === 422) {
    return {
      ok: false,
      error: { kind: 'domain', code: c.response.code as DomainCode },
    }
  }
  return { ok: false, error: { kind: 'system', reason: 'unknown' } }
}

describe('contract/examples.json replayed', () => {
  it('has cases', () => {
    expect(contract.length).toBeGreaterThan(0)
  })

  it.each(contract.map((c) => [c.name, c] as const))('%s', async (_, c) => {
    const fetch = answer(c.status, c.response)
    const op = c.path.split('/').pop() as Op
    const { a, b } = c.body ?? {}
    // Cases whose body calculate() can build (string operands) also check the
    // request; the others (a number, an array, no body) only replay the response.
    const buildable =
      typeof a === 'string' && (b === undefined || typeof b === 'string')
    const result = buildable
      ? await calculate(op, a, b ?? null, signal)
      : await calculate(op, '1', '1', signal)
    expect(result).toEqual(expected(c))
    expect(fetch.mock.calls[0]![0]).toBe(c.path)
    if (buildable) {
      expect(fetch.mock.calls[0]![1]).toMatchObject({
        method: 'POST',
        body: JSON.stringify(c.body),
      })
    }
  })
})
