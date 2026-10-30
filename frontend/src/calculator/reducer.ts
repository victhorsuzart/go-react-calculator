import { DOMAIN_MESSAGES } from './messages'
import type {
  Action,
  BinaryOp,
  CalcError,
  DigitId,
  KeyId,
  PendingRequest,
  RequestSpec,
  State,
} from './types'

// The calculator state machine (SPEC §5.3–§5.5, §6). It is pure: a key that
// needs the API sets `pending`, and the hook performs the request.

const MAX_DIGITS = 15
const MAX_QUEUE = 32

export const initialState: State = {
  phase: 'first',
  entry: '0',
  editable: true,
  accumulator: null,
  operator: null,
  lastOp: null,
  pending: null,
  queue: [],
  nextId: 1,
  error: null,
  banner: null,
}

const SYMBOLS: Record<BinaryOp, string> = {
  add: '+',
  subtract: '−',
  multiply: '×',
  divide: '÷',
  power: '^',
}

function isBinaryOp(key: KeyId): key is BinaryOp {
  return Object.hasOwn(SYMBOLS, key)
}

function isDigit(key: KeyId): key is DigitId {
  return key.length === 1 && key >= '0' && key <= '9'
}

function countDigits(entry: string): number {
  return entry.replace(/\D/g, '').length
}

/** Prepares an entry to be used as an operand: no trailing ".", no "-0". */
function normalize(entry: string): string {
  const trimmed = entry.endsWith('.') ? entry.slice(0, -1) : entry
  return trimmed === '-0' ? '0' : trimmed
}

/**
 * The pending binary operation. In the `awaiting` and `second` phases the
 * accumulator and the operator are always set; every caller is in one of them.
 */
function binaryOperands(state: State): {
  accumulator: string
  operator: BinaryOp
} {
  return { accumulator: state.accumulator!, operator: state.operator! }
}

function reset(state: State): State {
  return { ...initialState, nextId: state.nextId }
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'KEY':
      return pressKey(state, action.key)
    case 'RESOLVED':
      if (state.pending?.id !== action.id) return state
      return replay(resolve(state, state.pending, action.result))
    case 'FAILED':
      if (state.pending?.id !== action.id) return state
      return fail(state, state.pending, action.error)
  }
}

function pressKey(state: State, key: KeyId): State {
  if (key === 'clear') return reset(state)
  if (state.pending) {
    if (state.queue.length >= MAX_QUEUE) return state
    return { ...state, queue: [...state.queue, key] }
  }
  const current = state.banner ? { ...state, banner: null } : state
  if (current.phase === 'error') return errorKey(current, key)
  if (isDigit(key) || key === 'decimal') return typeKey(current, key)
  if (isBinaryOp(key)) return operatorKey(current, key)
  switch (key) {
    case 'equals':
      return equalsKey(current)
    case 'sqrt':
      return request(current, {
        kind: 'unary',
        op: 'sqrt',
        a: normalize(current.entry),
        b: null,
      })
    case 'percent':
      return percentKey(current)
    case 'sign':
      return signKey(current)
    case 'backspace':
      return backspaceKey(current)
  }
}

/** In the error phase a digit or "." starts over, ⌫ returns to 0, and other keys are ignored. */
function errorKey(state: State, key: KeyId): State {
  if (isDigit(key) || key === 'decimal') return typeKey(reset(state), key)
  if (key === 'backspace') return reset(state)
  return state
}

/** A digit or the decimal point. */
function typeKey(state: State, key: DigitId | 'decimal'): State {
  const char = key === 'decimal' ? '.' : key
  if (!state.editable) {
    const entry = char === '.' ? '0.' : char
    switch (state.phase) {
      case 'awaiting':
        return { ...state, entry, editable: true, phase: 'second' }
      case 'result':
        return { ...state, entry, editable: true, phase: 'first', lastOp: null }
      default:
        return { ...state, entry, editable: true }
    }
  }
  if (countDigits(state.entry) >= MAX_DIGITS) return state
  if (char === '.') {
    return state.entry.includes('.')
      ? state
      : { ...state, entry: state.entry + '.' }
  }
  if (state.entry === '0') return { ...state, entry: char }
  if (state.entry === '-0') return { ...state, entry: '-' + char }
  return { ...state, entry: state.entry + char }
}

function operatorKey(state: State, op: BinaryOp): State {
  switch (state.phase) {
    case 'awaiting':
      return { ...state, operator: op }
    case 'second': {
      const { accumulator, operator } = binaryOperands(state)
      return request(state, {
        kind: 'chain',
        op: operator,
        a: accumulator,
        b: normalize(state.entry),
        nextOperator: op,
      })
    }
    default: {
      const entry = normalize(state.entry)
      return {
        ...state,
        phase: 'awaiting',
        accumulator: entry,
        entry,
        editable: false,
        operator: op,
        lastOp: null,
      }
    }
  }
}

function equalsKey(state: State): State {
  switch (state.phase) {
    case 'awaiting':
    case 'second': {
      const { accumulator, operator } = binaryOperands(state)
      return request(state, {
        kind: 'equals',
        op: operator,
        a: accumulator,
        b: normalize(state.entry),
      })
    }
    case 'result':
      if (!state.lastOp) return state
      return request(state, {
        kind: 'equals',
        op: state.lastOp.operator,
        a: state.entry,
        b: state.lastOp.operand,
      })
    default:
      return { ...state, entry: normalize(state.entry) }
  }
}

/** % is a percentage of the accumulator when + or − is pending, otherwise entry / 100. */
function percentKey(state: State): State {
  const pendingAddOrSubtract =
    (state.phase === 'awaiting' || state.phase === 'second') &&
    (state.operator === 'add' || state.operator === 'subtract')
  return request(state, {
    kind: 'unary',
    op: 'percentage',
    a: normalize(state.entry),
    b: pendingAddOrSubtract ? binaryOperands(state).accumulator : '1',
  })
}

function signKey(state: State): State {
  if (state.phase === 'awaiting') {
    return { ...state, entry: '-0', editable: true, phase: 'second' }
  }
  if (!state.editable && state.entry === '0') return state
  const entry = state.entry.startsWith('-')
    ? state.entry.slice(1)
    : '-' + state.entry
  return { ...state, entry }
}

function backspaceKey(state: State): State {
  if (!state.editable) return state
  const entry = state.entry.slice(0, -1)
  return { ...state, entry: entry === '' || entry === '-' ? '0' : entry }
}

function request(state: State, spec: RequestSpec): State {
  const pending: PendingRequest = { ...spec, id: state.nextId, previous: state }
  return { ...state, pending, nextId: state.nextId + 1 }
}

function resolve(state: State, pending: PendingRequest, result: string): State {
  const base = {
    ...pending.previous,
    pending: null,
    queue: state.queue,
    nextId: state.nextId,
  }
  switch (pending.kind) {
    case 'chain':
      return {
        ...base,
        phase: 'awaiting',
        accumulator: result,
        entry: result,
        editable: false,
        operator: pending.nextOperator,
      }
    case 'equals':
      return {
        ...base,
        phase: 'result',
        entry: result,
        editable: false,
        accumulator: null,
        operator: null,
        lastOp: { left: pending.a, operator: pending.op, operand: pending.b },
      }
    case 'unary': {
      const computed = { ...base, entry: result, editable: false }
      switch (base.phase) {
        case 'awaiting':
          return { ...computed, phase: 'second' }
        case 'result':
          return { ...computed, phase: 'first', lastOp: null }
        default:
          return computed
      }
    }
  }
}

function fail(state: State, pending: PendingRequest, error: CalcError): State {
  switch (error.kind) {
    case 'aborted':
      return state
    case 'system':
      // Restore the state before the key; the queue is discarded.
      return { ...pending.previous, banner: error.reason, nextId: state.nextId }
    case 'domain': {
      // The queue is replayed and follows the error-phase rules (SPEC §6.1).
      const request =
        pending.kind === 'unary'
          ? null
          : { a: pending.a, operator: pending.op, b: pending.b }
      return replay({
        ...reset(state),
        phase: 'error',
        editable: false,
        queue: state.queue,
        error: { code: error.code, request },
      })
    }
  }
}

/** Replays the keys queued during a request, in order. */
function replay(state: State): State {
  let next: State = { ...state, queue: [] }
  for (const key of state.queue) next = pressKey(next, key)
  return next
}

/**
 * The upper line of the display (SPEC §5.3). `format` is applied to every
 * number on it, e.g. the display's thousands separators.
 */
export function upperLine(
  state: State,
  format: (text: string) => string = (text) => text,
): string {
  switch (state.phase) {
    case 'first':
      return ''
    case 'awaiting':
    case 'second': {
      const { accumulator, operator } = binaryOperands(state)
      return `${format(accumulator)} ${SYMBOLS[operator]}`
    }
    case 'result': {
      const last = state.lastOp
      return last
        ? `${format(last.left)} ${SYMBOLS[last.operator]} ${format(last.operand)} =`
        : ''
    }
    case 'error': {
      const req = state.error?.request
      return req
        ? `${format(req.a)} ${SYMBOLS[req.operator]} ${format(req.b)} =`
        : ''
    }
  }
}

export type MainLine =
  { kind: 'number'; text: string } | { kind: 'message'; text: string }

/** The main line of the display: the entry, or the domain error message. */
export function mainLine(state: State): MainLine {
  return state.phase === 'error' && state.error
    ? { kind: 'message', text: DOMAIN_MESSAGES[state.error.code] }
    : { kind: 'number', text: state.entry }
}
