// Shared types for the calculator (SPEC §5.3, §6). Numbers are always text.

export type BinaryOp = 'add' | 'subtract' | 'multiply' | 'divide' | 'power'

/** An API route name (SPEC §3.1). */
export type Op = BinaryOp | 'sqrt' | 'percentage'

export type DigitId = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'

export type KeyId =
  | DigitId
  | 'decimal'
  | BinaryOp
  | 'sqrt'
  | 'percent'
  | 'sign'
  | 'backspace'
  | 'clear'
  | 'equals'

export type KeyKind =
  'digit' | 'operator' | 'unary' | 'edit' | 'clear' | 'equals'

export type DomainCode =
  'DIVISION_BY_ZERO' | 'UNDEFINED_RESULT' | 'RESULT_OUT_OF_RANGE'

export type SystemReason = 'timeout' | 'network' | 'unknown'

export type CalcError =
  | { kind: 'domain'; code: DomainCode }
  | { kind: 'system'; reason: SystemReason }
  | { kind: 'aborted' }

export type CalcResult =
  { ok: true; result: string } | { ok: false; error: CalcError }

export type RequestKind = 'chain' | 'equals' | 'unary'

/** What to request; the kind fixes which operations and operands are allowed. */
export type RequestSpec =
  | {
      kind: 'chain'
      op: BinaryOp
      a: string
      b: string
      nextOperator: BinaryOp // the operator key that triggered the chain
    }
  | { kind: 'equals'; op: BinaryOp; a: string; b: string }
  | { kind: 'unary'; op: 'sqrt'; a: string; b: null }
  | { kind: 'unary'; op: 'percentage'; a: string; b: string }

export type PendingRequest = RequestSpec & {
  id: number
  previous: State // the state before the key that made the request
}

export type Phase = 'first' | 'awaiting' | 'second' | 'result' | 'error'

export type LastOp = { left: string; operator: BinaryOp; operand: string }

export type DomainError = {
  code: DomainCode
  /** The failed binary request, shown on the upper line; null for √ and %. */
  request: { a: string; operator: BinaryOp; b: string } | null
}

export type State = {
  phase: Phase
  entry: string // main line, unformatted
  editable: boolean // typed (true) or computed (false)
  accumulator: string | null
  operator: BinaryOp | null
  lastOp: LastOp | null // for repeated "="
  pending: PendingRequest | null
  queue: KeyId[] // keys pressed while a request is pending
  nextId: number // id of the next request; survives AC so stale ids never match
  error: DomainError | null // set in the error phase
  banner: SystemReason | null // system error banner
}

export type Action =
  | { type: 'KEY'; key: KeyId }
  | { type: 'RESOLVED'; id: number; result: string }
  | { type: 'FAILED'; id: number; error: CalcError }
