import { act, render, screen, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  describeRequest,
  fakeTimeoutSignals,
  installFakeFetch,
  type FakeRequest,
} from '../test/fakeFetch'
import { Calculator } from './Calculator'

const NAMES: Record<string, string> = {
  '+': 'add',
  '−': 'subtract',
  '×': 'multiply',
  '÷': 'divide',
  xʸ: 'power',
  '√': 'square root',
  '%': 'percent',
  '±': 'toggle sign',
  '⌫': 'backspace',
  AC: 'all clear',
  '=': 'equals',
  '.': 'decimal point',
}

let requests: FakeRequest[]
let user: UserEvent

beforeEach(() => {
  // Only timers are faked, so response bodies still stream normally.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  // Testing Library waits on setTimeout(0) after each user-event call and only
  // advances fake timers it recognizes as Jest's; point it at Vitest's.
  vi.stubGlobal('jest', {
    advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms),
  })
  fakeTimeoutSignals()
  requests = installFakeFetch()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  user = userEvent.setup({
    advanceTimers: (ms) => vi.advanceTimersByTime(ms),
  })
  render(<Calculator />)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** Clicks the on-screen keys, e.g. "2 + 10 =" (numbers are typed digit by digit). */
async function click(sequence: string) {
  for (const token of sequence.split(' ')) {
    const names = NAMES[token]
      ? [NAMES[token]]
      : [...token].map((char) => NAMES[char] ?? char)
    for (const name of names) {
      await user.click(screen.getByRole('button', { name }))
    }
  }
}

/** Lets the pending response travel through the client, hook and reducer. */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setImmediate(resolve))
    }
  })
}

async function respond(index: number, status: number, body: unknown) {
  requests[index]!.respond(status, body)
  await settle()
}

async function failNetwork(index: number) {
  requests[index]!.fail()
  await settle()
}

function display() {
  return screen.getByRole('group', { name: 'Display' })
}

function lines() {
  return {
    upper: within(display()).getByRole('paragraph').textContent,
    main: screen.getByRole('status').textContent,
    banner: screen.queryByRole('alert')?.textContent ?? null,
  }
}

const domain = (code: string) => ({
  type: 'about:blank',
  title: 'Unprocessable Content',
  status: 422,
  detail: 'Detail.',
  code,
})

// SPEC Appendix B.4, one test per row.
describe('B.4 requests and system errors', () => {
  it('2 + 3 +, then 4 = before the first response', async () => {
    await click('2 + 3 +')
    await click('4 =')
    expect(requests.map(describeRequest)).toEqual(['add 2 3'])
    await respond(0, 200, { result: '5' })
    expect(requests.map(describeRequest)).toEqual(['add 2 3', 'add 5 4'])
    await respond(1, 200, { result: '9' })
    expect(lines()).toEqual({ upper: '5 + 4 =', main: '9', banner: null })
  })

  it('2 + 3 =, then AC before the response; the response arrives later', async () => {
    await click('2 + 3 =')
    await click('AC')
    expect(requests[0]!.signal.aborted).toBe(true)
    await respond(0, 200, { result: '5' })
    expect(lines()).toEqual({ upper: '', main: '0', banner: null })
  })

  it('5 ÷ 0 =, then 7 before the response', async () => {
    await click('5 ÷ 0 = 7')
    await respond(0, 422, domain('DIVISION_BY_ZERO'))
    expect(lines()).toEqual({ upper: '', main: '7', banner: null })
  })

  it('8 ÷ 2 =, no response within 5 s', async () => {
    await click('8 ÷ 2 =')
    await act(() => vi.advanceTimersByTimeAsync(4999))
    expect(lines().banner).toBeNull()
    await act(() => vi.advanceTimersByTimeAsync(1))
    await settle()
    expect(lines()).toEqual({
      upper: '8 ÷',
      main: '2',
      banner: 'The server took too long. Try again.',
    })
  })

  it('2 + 3 =, network failure, then = again and the server answers', async () => {
    await click('2 + 3 =')
    await failNetwork(0)
    expect(lines()).toEqual({
      upper: '2 +',
      main: '3',
      banner: "Can't reach the server. Try again.",
    })
    await click('=')
    expect(lines().banner).toBeNull()
    await respond(1, 200, { result: '5' })
    expect(lines()).toEqual({ upper: '2 + 3 =', main: '5', banner: null })
  })

  it('2 + 3 +, network failure, 4 = pressed while waiting', async () => {
    await click('2 + 3 + 4 =')
    await failNetwork(0)
    expect(lines()).toEqual({
      upper: '2 +',
      main: '3',
      banner: "Can't reach the server. Try again.",
    })
    expect(requests).toHaveLength(1)
  })

  it('2 + 3 =, 502 with an HTML body', async () => {
    await click('2 + 3 =')
    await respond(0, 502, '<html>Bad Gateway</html>')
    expect(lines()).toEqual({
      upper: '2 +',
      main: '3',
      banner: "Can't reach the server. Try again.",
    })
  })

  it('2 + 3 =, 500', async () => {
    await click('2 + 3 =')
    await respond(0, 500, {
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      detail: 'An unexpected error occurred.',
      code: 'INTERNAL_ERROR',
    })
    expect(lines()).toEqual({
      upper: '2 +',
      main: '3',
      banner: 'Something went wrong. Try again.',
    })
  })

  it('2 + 3 =, network failure, then 7', async () => {
    await click('2 + 3 =')
    await failNetwork(0)
    await click('7')
    expect(lines()).toEqual({ upper: '2 +', main: '37', banner: null })
  })
})

describe('display', () => {
  it('shows a domain error on the main line, without a banner', async () => {
    await click('5 ÷ 0 =')
    await respond(0, 422, domain('DIVISION_BY_ZERO'))
    expect(lines()).toEqual({
      upper: '5 ÷ 0 =',
      main: 'Cannot divide by zero',
      banner: null,
    })
  })

  it('sets aria-busy only after 300 ms', async () => {
    await click('2 + 3 =')
    await act(() => vi.advanceTimersByTimeAsync(299))
    expect(display().getAttribute('aria-busy')).toBe('false')
    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(display().getAttribute('aria-busy')).toBe('true')
    await respond(0, 200, { result: '5' })
    expect(display().getAttribute('aria-busy')).toBe('false')
  })

  it('groups thousands on both lines', async () => {
    await click('1234 + 5678 =')
    await respond(0, 200, { result: '6912' })
    expect(lines()).toEqual({
      upper: '1,234 + 5,678 =',
      main: '6,912',
      banner: null,
    })
  })

  it('shows long upper lines in full', async () => {
    await click('123456789 × 123456789 =')
    await respond(0, 200, { result: '1.52415787501905e+16' })
    expect(lines().upper).toBe('123,456,789 × 123,456,789 =')
    await click('AC 999999999999999 × 999999999999999 =')
    await respond(1, 200, { result: '9.99999999999998e+29' })
    expect(lines()).toEqual({
      upper: '999,999,999,999,999 × 999,999,999,999,999 =',
      main: '9.99999999999998e+29',
      banner: null,
    })
    // The longest upper line: two 23-character operands.
    await click('AC 1.23456789012345 ÷ 1000000 =')
    await respond(2, 200, { result: '0.00000123456789012345' })
    await click('± × =')
    await respond(3, 200, { result: '1.52415787532388e-12' })
    expect(lines().upper).toBe(
      '-0.00000123456789012345 × -0.00000123456789012345 =',
    )
  })

  it('groups a long typed number', async () => {
    await click('1234567890')
    expect(lines().main).toBe('1,234,567,890')
  })
})

describe('keypad', () => {
  it('has the 22 keys in visual order with their accessible names', () => {
    const keypad = screen.getByRole('group', { name: 'Keypad' })
    const names = within(keypad)
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label'))
    expect(names).toEqual([
      'all clear',
      'backspace',
      'percent',
      'divide',
      'square root',
      'power',
      'toggle sign',
      'multiply',
      '7',
      '8',
      '9',
      'subtract',
      '4',
      '5',
      '6',
      'add',
      '1',
      '2',
      '3',
      'equals',
      '0',
      'decimal point',
    ])
  })

  it('describes shortcuts in title and aria-keyshortcuts', () => {
    const sqrt = screen.getByRole('button', { name: 'square root' })
    expect(sqrt.getAttribute('title')).toBe('Square root (R)')
    expect(sqrt.getAttribute('aria-keyshortcuts')).toBe('R')
    const clear = screen.getByRole('button', { name: 'all clear' })
    expect(clear.getAttribute('title')).toBe('All clear (Escape or Delete)')
    expect(clear.getAttribute('aria-keyshortcuts')).toBe('Escape Delete')
    const add = screen.getByRole('button', { name: 'add' })
    expect(add.getAttribute('aria-keyshortcuts')).toBe('Plus')
    expect(add.getAttribute('title')).toBe('Add (+)')
  })

  it('has a heading for the page', () => {
    expect(screen.getByRole('heading', { name: 'Calculator' })).toBeDefined()
  })

  it('does not take focus on click', async () => {
    await click('7')
    expect(document.activeElement).toBe(document.body)
    expect(lines().main).toBe('7')
  })
})

describe('physical keyboard', () => {
  it('types a calculation and Enter means =', async () => {
    await user.keyboard('12+3{Enter}')
    expect(requests.map(describeRequest)).toEqual(['add 12 3'])
    await respond(0, 200, { result: '15' })
    expect(lines()).toEqual({ upper: '12 + 3 =', main: '15', banner: null })
  })

  it('maps letters case-insensitively and Escape clears', async () => {
    await user.keyboard('9R')
    expect(requests.map(describeRequest)).toEqual(['sqrt 9'])
    await respond(0, 200, { result: '3' })
    expect(lines().main).toBe('3')
    await user.keyboard('{Escape}')
    expect(lines().main).toBe('0')
  })

  it('ignores keys with Ctrl', async () => {
    await user.keyboard('{Control>}7{/Control}')
    expect(lines().main).toBe('0')
  })

  it('Enter on a button reached with Tab activates that button', async () => {
    for (let i = 0; i < 9; i++) await user.tab()
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: '7' }),
    )
    await user.keyboard('{Enter}')
    expect(lines().main).toBe('7')
    expect(requests).toHaveLength(0)
  })

  it('holding Enter on a focused non-repeatable key presses it once', async () => {
    for (let i = 0; i < 7; i++) await user.tab()
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'toggle sign' }),
    )
    // Two presses would toggle the sign back; one leaves -0.
    await user.keyboard('{Enter>2}')
    expect(lines().main).toBe('-0')
  })

  it('holding Enter on a focused digit repeats it', async () => {
    for (let i = 0; i < 9; i++) await user.tab()
    await user.keyboard('{Enter>3}')
    expect(lines().main).toBe('777')
  })

  it('Enter means = again after mouse input following a Tab-focused key', async () => {
    for (let i = 0; i < 9; i++) await user.tab()
    await user.keyboard('{Enter}')
    await click('+ 3')
    expect(document.activeElement).toBe(document.body)
    await user.keyboard('{Enter}')
    expect(requests.map(describeRequest)).toEqual(['add 7 3'])
    await respond(0, 200, { result: '10' })
    expect(lines()).toEqual({ upper: '7 + 3 =', main: '10', banner: null })
  })

  it('keeps accepting keys while a key flashes', async () => {
    await user.keyboard('55')
    await act(() => vi.advanceTimersByTimeAsync(100))
    expect(lines().main).toBe('55')
  })
})
