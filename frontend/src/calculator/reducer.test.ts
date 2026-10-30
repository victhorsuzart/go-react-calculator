// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { initialState, mainLine, reducer, upperLine } from './reducer'
import type { Action, CalcError, DomainCode, KeyId, State } from './types'

const SYMBOL_KEYS: Record<string, KeyId> = {
  '+': 'add',
  '−': 'subtract',
  '×': 'multiply',
  '÷': 'divide',
  xʸ: 'power',
  '√': 'sqrt',
  '%': 'percent',
  '±': 'sign',
  '⌫': 'backspace',
  AC: 'clear',
  '=': 'equals',
  '.': 'decimal',
}

/** Parses "2 + 10 ×" into keys; a number token becomes one key per digit. */
function parseKeys(sequence: string): KeyId[] {
  return sequence
    .split(' ')
    .filter((token) => token !== '')
    .flatMap((token) => {
      const symbol = SYMBOL_KEYS[token]
      if (symbol) return [symbol]
      if (/^\d+$/.test(token)) return [...token] as KeyId[]
      throw new Error(`unknown key token ${token}`)
    })
}

type Response = string | { domain: DomainCode }

/**
 * Presses the keys from the initial state and answers each request from
 * `responses`, keyed by "op a b" (b omitted for sqrt). An unexpected request,
 * or a response that is never requested, fails the test.
 */
function run(keys: KeyId[], responses: Record<string, Response> = {}): State {
  const unused = new Set(Object.keys(responses))
  let state = initialState
  const dispatch = (action: Action) => {
    state = reducer(state, action)
  }
  const answer = () => {
    while (state.pending) {
      const { id, op, a, b } = state.pending
      const request = [op, a, b].filter((part) => part !== null).join(' ')
      const response = responses[request]
      if (response === undefined)
        throw new Error(`unexpected request: ${request}`)
      unused.delete(request)
      if (typeof response === 'string')
        dispatch({ type: 'RESOLVED', id, result: response })
      else
        dispatch({
          type: 'FAILED',
          id,
          error: { kind: 'domain', code: response.domain },
        })
    }
  }
  for (const key of keys) {
    dispatch({ type: 'KEY', key })
    answer()
  }
  expect([...unused], 'responses never requested').toEqual([])
  return state
}

function lines(state: State) {
  return { upper: upperLine(state), main: mainLine(state).text }
}

type Row = {
  keys: string | KeyId[]
  upper: string
  main: string
  responses?: Record<string, Response>
}

// SPEC Appendix B.3, one test per row.
const B3: [string, Row][] = [
  ['(start)', { keys: '', upper: '', main: '0' }],
  ['0 0 7', { keys: '0 0 7', upper: '', main: '7' }],
  ['. 5', { keys: '. 5', upper: '', main: '0.5' }],
  ['1 . . 2', { keys: '1 . . 2', upper: '', main: '1.2' }],
  [
    '9 × 16',
    { keys: Array<KeyId>(16).fill('9'), upper: '', main: '999999999999999' },
  ],
  ['1 2 ⌫', { keys: '1 2 ⌫', upper: '', main: '1' }],
  ['± 5 ⌫', { keys: '± 5 ⌫', upper: '', main: '0' }],
  ['5 . =', { keys: '5 . =', upper: '', main: '5' }],
  ['5 × 3', { keys: '5 × 3', upper: '5 ×', main: '3' }],
  [
    '2 + 3 × 4 =',
    {
      keys: '2 + 3 × 4 =',
      upper: '5 × 4 =',
      main: '20',
      responses: { 'add 2 3': '5', 'multiply 5 4': '20' },
    },
  ],
  [
    '5 + × 2 =',
    {
      keys: '5 + × 2 =',
      upper: '5 × 2 =',
      main: '10',
      responses: { 'multiply 5 2': '10' },
    },
  ],
  [
    '5 + =',
    {
      keys: '5 + =',
      upper: '5 + 5 =',
      main: '10',
      responses: { 'add 5 5': '10' },
    },
  ],
  [
    '10 − 3 = =',
    {
      keys: '10 − 3 = =',
      upper: '7 − 3 =',
      main: '4',
      responses: { 'subtract 10 3': '7', 'subtract 7 3': '4' },
    },
  ],
  [
    '2 + 3 = 4',
    {
      keys: '2 + 3 = 4',
      upper: '',
      main: '4',
      responses: { 'add 2 3': '5' },
    },
  ],
  [
    '2 + 3 = × 4 =',
    {
      keys: '2 + 3 = × 4 =',
      upper: '5 × 4 =',
      main: '20',
      responses: { 'add 2 3': '5', 'multiply 5 4': '20' },
    },
  ],
  [
    '2 + 3 = ⌫',
    {
      keys: '2 + 3 = ⌫',
      upper: '2 + 3 =',
      main: '5',
      responses: { 'add 2 3': '5' },
    },
  ],
  [
    '5 × ± 3 =',
    {
      keys: '5 × ± 3 =',
      upper: '5 × -3 =',
      main: '-15',
      responses: { 'multiply 5 -3': '-15' },
    },
  ],
  [
    '9 √ 5',
    {
      keys: '9 √ 5',
      upper: '',
      main: '5',
      responses: { 'sqrt 9': '3' },
    },
  ],
  [
    '9 + 16 √ =',
    {
      keys: '9 + 16 √ =',
      upper: '9 + 4 =',
      main: '13',
      responses: { 'sqrt 16': '4', 'add 9 4': '13' },
    },
  ],
  [
    '9 + √ =',
    {
      keys: '9 + √ =',
      upper: '9 + 3 =',
      main: '12',
      responses: { 'sqrt 9': '3', 'add 9 3': '12' },
    },
  ],
  [
    '2 + 3 = √ =',
    {
      keys: '2 + 3 = √ =',
      upper: '',
      main: '2.23606797749979',
      responses: { 'add 2 3': '5', 'sqrt 5': '2.23606797749979' },
    },
  ],
  [
    '10 %',
    {
      keys: '10 %',
      upper: '',
      main: '0.1',
      responses: { 'percentage 10 1': '0.1' },
    },
  ],
  [
    '50 + 10 % =',
    {
      keys: '50 + 10 % =',
      upper: '50 + 5 =',
      main: '55',
      responses: { 'percentage 10 50': '5', 'add 50 5': '55' },
    },
  ],
  [
    '50 × 10 % =',
    {
      keys: '50 × 10 % =',
      upper: '50 × 0.1 =',
      main: '5',
      responses: { 'percentage 10 1': '0.1', 'multiply 50 0.1': '5' },
    },
  ],
  [
    '50 + % =',
    {
      keys: '50 + % =',
      upper: '50 + 25 =',
      main: '75',
      responses: { 'percentage 50 50': '25', 'add 50 25': '75' },
    },
  ],
  [
    '5 ÷ 0 =',
    {
      keys: '5 ÷ 0 =',
      upper: '5 ÷ 0 =',
      main: 'Cannot divide by zero',
      responses: { 'divide 5 0': { domain: 'DIVISION_BY_ZERO' } },
    },
  ],
  [
    '5 ÷ 0 +',
    {
      keys: '5 ÷ 0 +',
      upper: '5 ÷ 0 =',
      main: 'Cannot divide by zero',
      responses: { 'divide 5 0': { domain: 'DIVISION_BY_ZERO' } },
    },
  ],
  [
    '5 ÷ 0 = + = √ % ±',
    {
      keys: '5 ÷ 0 = + = √ % ±',
      upper: '5 ÷ 0 =',
      main: 'Cannot divide by zero',
      responses: { 'divide 5 0': { domain: 'DIVISION_BY_ZERO' } },
    },
  ],
  [
    '5 ÷ 0 = 7',
    {
      keys: '5 ÷ 0 = 7',
      upper: '',
      main: '7',
      responses: { 'divide 5 0': { domain: 'DIVISION_BY_ZERO' } },
    },
  ],
  [
    '5 ÷ 0 = ⌫',
    {
      keys: '5 ÷ 0 = ⌫',
      upper: '',
      main: '0',
      responses: { 'divide 5 0': { domain: 'DIVISION_BY_ZERO' } },
    },
  ],
  [
    '4 ± √',
    {
      keys: '4 ± √',
      upper: '',
      main: 'Not a real number',
      responses: { 'sqrt -4': { domain: 'UNDEFINED_RESULT' } },
    },
  ],
  [
    '10 xʸ 400 =',
    {
      keys: '10 xʸ 400 =',
      upper: '10 ^ 400 =',
      main: 'Out of range',
      responses: { 'power 10 400': { domain: 'RESULT_OUT_OF_RANGE' } },
    },
  ],
]

describe('B.3 key sequences', () => {
  it.each(B3)('%s', (_, row) => {
    const keys = typeof row.keys === 'string' ? parseKeys(row.keys) : row.keys
    expect(lines(run(keys, row.responses))).toEqual({
      upper: row.upper,
      main: row.main,
    })
  })
})

/** Presses keys without answering requests. */
function press(state: State, sequence: string): State {
  return parseKeys(sequence).reduce(
    (s, key) => reducer(s, { type: 'KEY', key }),
    state,
  )
}

function resolved(state: State, result: string): State {
  return reducer(state, { type: 'RESOLVED', id: state.pending!.id, result })
}

function failed(state: State, error: CalcError): State {
  return reducer(state, { type: 'FAILED', id: state.pending!.id, error })
}

function requestOf(state: State) {
  const p = state.pending
  return p && [p.op, p.a, p.b].filter((part) => part !== null).join(' ')
}

// SPEC Appendix B.4, the reducer side: responses are dispatched by hand.
describe('B.4 requests and system errors', () => {
  it('2 + 3 +, then 4 = before the first response', () => {
    let s = press(initialState, '2 + 3 +')
    expect(requestOf(s)).toBe('add 2 3')
    s = press(s, '4 =')
    expect(s.queue).toEqual(['4', 'equals'])
    s = resolved(s, '5')
    expect(requestOf(s)).toBe('add 5 4')
    s = resolved(s, '9')
    expect(lines(s)).toEqual({ upper: '5 + 4 =', main: '9' })
    expect(s.banner).toBeNull()
  })

  it('2 + 3 =, then AC before the response; the response arrives later', () => {
    let s = press(initialState, '2 + 3 =')
    const stale = s.pending!.id
    s = press(s, 'AC')
    expect(s.pending).toBeNull()
    s = reducer(s, { type: 'RESOLVED', id: stale, result: '5' })
    expect(lines(s)).toEqual({ upper: '', main: '0' })
  })

  it('5 ÷ 0 =, then 7 before the response', () => {
    let s = press(initialState, '5 ÷ 0 = 7')
    s = failed(s, { kind: 'domain', code: 'DIVISION_BY_ZERO' })
    expect(lines(s)).toEqual({ upper: '', main: '7' })
  })

  it('8 ÷ 2 =, no response within 5 s', () => {
    let s = press(initialState, '8 ÷ 2 =')
    s = failed(s, { kind: 'system', reason: 'timeout' })
    expect(lines(s)).toEqual({ upper: '8 ÷', main: '2' })
    expect(s.banner).toBe('timeout')
  })

  it('2 + 3 =, network failure, then = again and the server answers', () => {
    let s = press(initialState, '2 + 3 =')
    s = failed(s, { kind: 'system', reason: 'network' })
    expect(lines(s)).toEqual({ upper: '2 +', main: '3' })
    expect(s.banner).toBe('network')

    s = press(s, '=')
    expect(s.banner).toBeNull()
    expect(requestOf(s)).toBe('add 2 3')
    s = resolved(s, '5')
    expect(lines(s)).toEqual({ upper: '2 + 3 =', main: '5' })
    expect(s.banner).toBeNull()
  })

  it('2 + 3 +, network failure, 4 = pressed while waiting', () => {
    let s = press(initialState, '2 + 3 + 4 =')
    expect(s.queue).toEqual(['4', 'equals'])
    s = failed(s, { kind: 'system', reason: 'network' })
    expect(lines(s)).toEqual({ upper: '2 +', main: '3' })
    expect(s.banner).toBe('network')
    expect(s.queue).toEqual([])
    expect(s.pending).toBeNull()
  })

  it('2 + 3 =, 502 with an HTML body (classified as network)', () => {
    const s = failed(press(initialState, '2 + 3 ='), {
      kind: 'system',
      reason: 'network',
    })
    expect(lines(s)).toEqual({ upper: '2 +', main: '3' })
    expect(s.banner).toBe('network')
  })

  it('2 + 3 =, 500 (classified as unknown)', () => {
    const s = failed(press(initialState, '2 + 3 ='), {
      kind: 'system',
      reason: 'unknown',
    })
    expect(lines(s)).toEqual({ upper: '2 +', main: '3' })
    expect(s.banner).toBe('unknown')
  })

  it('2 + 3 =, network failure, then 7', () => {
    let s = failed(press(initialState, '2 + 3 ='), {
      kind: 'system',
      reason: 'network',
    })
    s = press(s, '7')
    expect(lines(s)).toEqual({ upper: '2 +', main: '37' })
    expect(s.banner).toBeNull()
  })
})

describe('other reducer rules', () => {
  it('ignores an aborted request', () => {
    const s = press(initialState, '2 + 3 =')
    expect(failed(s, { kind: 'aborted' })).toBe(s)
  })

  it('ignores a failure for a stale request', () => {
    const s = press(initialState, '2 + 3 =')
    expect(
      reducer(s, {
        type: 'FAILED',
        id: s.pending!.id + 1,
        error: { kind: 'aborted' },
      }),
    ).toBe(s)
  })

  it('queues at most 32 keys', () => {
    let s = press(initialState, '2 + 3 =')
    for (let i = 0; i < 40; i++) s = press(s, '1')
    expect(s.queue).toHaveLength(32)
  })

  it('AC clears the queue and keeps request ids increasing', () => {
    let s = press(initialState, '2 + 3 = 4')
    const id = s.pending!.id
    s = press(s, 'AC 1 + 1 =')
    expect(s.queue).toEqual([])
    expect(s.pending!.id).toBeGreaterThan(id)
  })

  it('% takes a percentage of the accumulator when − is pending', () => {
    expect(requestOf(press(initialState, '50 − 10 %'))).toBe('percentage 10 50')
  })

  it('% divides by 100 after =', () => {
    expect(
      requestOf(press(run(parseKeys('2 + 3 ='), { 'add 2 3': '5' }), '%')),
    ).toBe('percentage 5 1')
  })

  it('± leaves a computed 0 alone', () => {
    const s = run(parseKeys('5 − 5 = ±'), { 'subtract 5 5': '0' })
    expect(lines(s)).toEqual({ upper: '5 − 5 =', main: '0' })
  })

  it('± toggles a computed result, which a digit then replaces', () => {
    let s = run(parseKeys('2 + 3 = ±'), { 'add 2 3': '5' })
    expect(mainLine(s).text).toBe('-5')
    s = press(s, '±')
    expect(mainLine(s).text).toBe('5')
    s = press(s, '7')
    expect(lines(s)).toEqual({ upper: '', main: '7' })
  })

  it('± twice on a typed number removes the sign', () => {
    expect(mainLine(press(initialState, '5 ± ±')).text).toBe('5')
  })

  it('a digit after -0 keeps the sign', () => {
    expect(mainLine(press(initialState, '± 0 7')).text).toBe('-7')
  })

  it('. is ignored at 15 digits', () => {
    expect(mainLine(press(initialState, '999999999999999 .')).text).toBe(
      '999999999999999',
    )
  })

  it('. starts a new computed number as 0.', () => {
    expect(lines(press(initialState, '5 + .'))).toEqual({
      upper: '5 +',
      main: '0.',
    })
  })

  it('. after a result starts over', () => {
    expect(lines(run(parseKeys('2 + 3 = .'), { 'add 2 3': '5' }))).toEqual({
      upper: '',
      main: '0.',
    })
  })

  it('. in the error phase starts over', () => {
    const s = run(parseKeys('5 ÷ 0 = .'), {
      'divide 5 0': { domain: 'DIVISION_BY_ZERO' },
    })
    expect(lines(s)).toEqual({ upper: '', main: '0.' })
  })

  it('= in first normalizes -0', () => {
    expect(mainLine(press(initialState, '± =')).text).toBe('0')
  })

  it('an operator normalizes the entry into the accumulator', () => {
    expect(lines(press(initialState, '5 . +'))).toEqual({
      upper: '5 +',
      main: '5',
    })
  })

  it('⌫ after a computed entry in awaiting does nothing', () => {
    expect(lines(press(initialState, '5 + ⌫'))).toEqual({
      upper: '5 +',
      main: '5',
    })
  })

  it('a digit replaces a computed entry in the first phase', () => {
    const s = run(parseKeys('9 √ 1 2'), { 'sqrt 9': '3' })
    expect(lines(s)).toEqual({ upper: '', main: '12' })
  })

  it('AC in the error phase returns to the initial state', () => {
    const s = run(parseKeys('5 ÷ 0 = AC'), {
      'divide 5 0': { domain: 'DIVISION_BY_ZERO' },
    })
    expect(lines(s)).toEqual({ upper: '', main: '0' })
    expect(s.phase).toBe('first')
  })

  it('a chain failure shows the failed request', () => {
    const s = run(parseKeys('2 + 3 ×'), {
      'add 2 3': { domain: 'RESULT_OUT_OF_RANGE' },
    })
    expect(lines(s)).toEqual({ upper: '2 + 3 =', main: 'Out of range' })
  })

  it('a % failure leaves the upper line empty', () => {
    const s = run(parseKeys('5 %'), {
      'percentage 5 1': { domain: 'RESULT_OUT_OF_RANGE' },
    })
    expect(lines(s)).toEqual({ upper: '', main: 'Out of range' })
  })

  it('keeps the state unchanged while a request is pending', () => {
    const s = press(initialState, '2 + 3 =')
    expect(lines(s)).toEqual({ upper: '2 +', main: '3' })
  })
})

describe('display lines', () => {
  it('formats every number on the upper line', () => {
    const s = run(parseKeys('1234 + 5678 ='), { 'add 1234 5678': '6912' })
    expect(upperLine(s, (text) => `<${text}>`)).toBe('<1234> + <5678> =')
  })

  it('tells a number from an error message', () => {
    expect(mainLine(initialState)).toEqual({ kind: 'number', text: '0' })
    const s = run(parseKeys('5 ÷ 0 ='), {
      'divide 5 0': { domain: 'DIVISION_BY_ZERO' },
    })
    expect(mainLine(s)).toEqual({
      kind: 'message',
      text: 'Cannot divide by zero',
    })
  })

  it('sends sqrt with no second operand', () => {
    const p = press(initialState, '9 √').pending
    expect(p && [p.kind, p.op, p.a, p.b]).toEqual(['unary', 'sqrt', '9', null])
  })
})
