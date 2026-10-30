import {
  DOMAIN_CODES,
  type CalcError,
  type CalcResult,
  type DomainCode,
  type Op,
} from '../calculator/types'

// The API client (SPEC §6.2). calculate() never throws: every outcome is a
// CalcResult, and the backend's detail goes to the console only.

const GATEWAY_STATUSES = [502, 503, 504]

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isResultBody(value: unknown): value is { result: string } {
  return isObject(value) && typeof value.result === 'string'
}

function isDomainProblem(value: unknown): value is { code: DomainCode } {
  return (
    isObject(value) &&
    typeof value.code === 'string' &&
    (DOMAIN_CODES as readonly string[]).includes(value.code)
  )
}

/** Classifies a rejected fetch or body read. */
function fromException(err: unknown): CalcError {
  // A DOMException isn't an Error in every environment, so read its name.
  const name = isObject(err) ? err.name : undefined
  if (name === 'TimeoutError') return { kind: 'system', reason: 'timeout' }
  if (name === 'AbortError') return { kind: 'aborted' }
  return { kind: 'system', reason: 'network' }
}

function failure(error: CalcError): CalcResult {
  return { ok: false, error }
}

/** Parses JSON without throwing; anything that isn't JSON becomes undefined. */
function parseJSON(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * Requests `op(a, b)` from the API. `b` is null for one-operand operations,
 * which send only `a`.
 */
export async function calculate(
  op: Op,
  a: string,
  b: string | null,
  signal: AbortSignal,
): Promise<CalcResult> {
  let response: Response
  let text: string
  try {
    response = await fetch(`/api/v1/${op}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(b === null ? { a } : { a, b }),
      signal,
    })
    if (GATEWAY_STATUSES.includes(response.status)) {
      response.body?.cancel().catch(() => {}) // the proxy's error page is never read
      return failure({ kind: 'system', reason: 'network' })
    }
    text = await response.text()
  } catch (err) {
    return failure(fromException(err))
  }

  const body = parseJSON(text)
  if (response.status === 200 && isResultBody(body)) {
    return { ok: true, result: body.result }
  }
  if (isObject(body) && typeof body.detail === 'string') {
    console.warn(body.detail)
  }
  if (response.status === 422 && isDomainProblem(body)) {
    return failure({ kind: 'domain', code: body.code })
  }
  return failure({ kind: 'system', reason: 'unknown' })
}
