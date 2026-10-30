# Calculator — Specification

## 0. About this document
- Single source of truth for the implementation. Keywords **MUST**, **MUST NOT** and **SHOULD** follow RFC 2119.
- Examples and the tables in Appendix B are normative: every row becomes a test case.
- Do not add features, endpoints, keys, dependencies or files that are not described here. If something is ambiguous or missing, flag it in the plan instead of guessing.
- Rationale lives in `docs/DECISIONS.md`. This document only states what to build.

## 1. Overview

### 1.1 Scope
A web calculator with a React + TypeScript frontend and a Go REST API. **All arithmetic is performed by the API.** The frontend only manages input state and display.

- **Operations:** add, subtract, multiply, divide, power, square root, percentage.
- **Keys (22):** `0–9`, `.`, `+ − × ÷`, `xʸ`, `√`, `%`, `±`, `⌫`, `AC`, `=`.

### 1.2 Out of scope
Parentheses and operator precedence, memory keys, history, `x²`, `1/x`, `CE`, copy/paste, authentication, rate limiting, metrics, tracing, an OpenAPI document, CORS.

### 1.3 Architecture
```
Browser ──► nginx (static files + /api proxy) ──► Go API
            same origin, no CORS
```
- **Docker:** nginx serves the built frontend and proxies `/api/` to the backend. Only nginx is published, at `http://localhost:3000`.
- **Development:** the Vite dev server (`:5173`) proxies `/api` to the backend (`:8080`).
- The frontend **MUST** call relative URLs only (`/api/v1/...`).

### 1.4 Repository layout
```
backend/                  Go module: cmd/server, internal/{calc,number,httpapi}
frontend/                 Vite + React + TypeScript app, nginx.conf
contract/examples.json    shared request/response examples (§9.3)
docs/                     SPEC.md, DECISIONS.md, screenshot.png
.github/workflows/ci.yml
docker-compose.yml  Makefile  README.md  PROMPTS.md  .gitignore  .editorconfig  .gitattributes
```

## 2. Number model
Applies to both layers.

### 2.1 Decimal strings
- Every number in requests and responses **MUST** be a JSON **string**, never a JSON number.
- The frontend **MUST NOT** convert numbers to JS `number`: no `Number()`, `parseFloat`, `toFixed`, `toLocaleString` and no arithmetic. Numbers are text.
- The API uses `float64` internally.

### 2.2 Input grammar and limits
- **Grammar** (JSON number syntax), at most 32 characters:
  `^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$`
- **Accepted:** `"0"`, `"-0"` (treated as `0`), `"0.10"`, `"1e+15"`, `"1.5E-7"`.
- **Rejected:** `""`, `"NaN"`, `"Inf"`, `"0x10"`, `"1,5"`, `" 1"`, `"+1"`, `".5"`, `"1."`, `"01"`.
- The API **MUST** check the grammar before calling `strconv.ParseFloat`, which accepts `NaN`, `Inf` and hex floats.
- **Range:** a valid number is zero or has `|x|` within the normal `float64` range (`2.2250738585072014e-308` to `1.7976931348623157e308`).
  - `"1e400"` and `"1e-400"` are out of range.
  - `ParseFloat` reports overflow but not underflow. A parsed `0` from a string that has a non-zero digit, or a subnormal result, is out of range.
- The UI limits typed entry to **15 digits**; the sign and the decimal point do not count.

### 2.3 Canonical result format
Applied in one place in the API, to every result:
1. Round to 15 significant digits. **SHOULD** use `strconv.FormatFloat(x, 'e', 14, 64)` and parse back.
2. Normalize `-0` to `0`.
3. Use plain notation when `1e-6 ≤ |x| < 1e15`. Otherwise use scientific notation with no leading zeros in the exponent (`1e+15`, `1.5e-7`).
4. No trailing zeros and no trailing decimal point.

Every result string **MUST** be a valid input (round-trip).

| Operation | `result` |
|---|---|
| `0.1 + 0.2` | `"0.3"` |
| `2 ÷ 3` | `"0.666666666666667"` |
| `1.5 × 2` | `"3"` |
| `999999999999999 + 1` | `"1e+15"` |
| `123456789 × 987654321` | `"1.21932631112635e+17"` |
| `0.000001 ÷ 10` | `"1e-7"` |
| `-1 × 0` | `"0"` |

### 2.4 Representable range
- A result **MUST** be zero or fall within the normal `float64` range **after rounding** (§2.3, step 1). Overflow and underflow both yield `RESULT_OUT_OF_RANGE` (§3.3).
- The check uses the rounded value. `1.7976931348623157e308` rounds to `1.79769313486232e+308`, which overflows.
- The same applies at the bottom: `2.2250738585072014e-308` rounds to `2.2250738585072e-308`, which is subnormal and underflows. The range of valid results is therefore slightly narrower than the range of valid inputs.

**MUST NOT:** format with `FormatFloat(x, 'f', -1, 64)` (gives `0.30000000000000004`); use Go's `'g'` format without normalizing the exponent (gives `1e-05`); use a fixed number of decimals; mix strings and JSON numbers in the API.

## 3. HTTP API

### 3.1 Endpoints
Every operation is `POST /api/v1/{operation}` with a JSON body. Fields are always `a` and `b`, both decimal strings (§2).

| Operation | Arity | Body | Result |
|---|---|---|---|
| `add` | 2 | `{"a","b"}` | `a + b` |
| `subtract` | 2 | `{"a","b"}` | `a − b` |
| `multiply` | 2 | `{"a","b"}` | `a × b` |
| `divide` | 2 | `{"a","b"}` | `a ÷ b` |
| `power` | 2 | `{"a","b"}` | `a ^ b` |
| `sqrt` | 1 | `{"a"}` | `√a` |
| `percentage` | 2 | `{"a","b"}` | `a`% of `b` = `a × b / 100` |

**MUST NOT:** a generic `/calculate` endpoint; other route names (`/sub`, `/mul`, `/pow`, `/mod`); percentage implemented as modulo; swapped percentage operands.

### 3.2 Success response
`200`, `Content-Type: application/json`, body exactly `{"result": "<decimal string>"}` (§2.3).
```
POST /api/v1/divide      {"a":"7","b":"2"}      → 200 {"result":"3.5"}
POST /api/v1/sqrt        {"a":"9"}              → 200 {"result":"3"}
POST /api/v1/percentage  {"a":"10","b":"50"}    → 200 {"result":"5"}
POST /api/v1/add         {"a":"0.1","b":"0.2"}  → 200 {"result":"0.3"}
```
Responses **MUST** be encoded from structs. **MUST NOT:** `201`; JSON built by string concatenation.

### 3.3 Operation semantics and edge cases
Every operation runs these steps in order:
1. Domain pre-checks (table below), each with its own code.
2. Compute with `float64`.
3. Round (§2.3, step 1) and check the range of the rounded value (§2.4).
4. A `NaN` that reaches this point is `UNDEFINED_RESULT`, never a response.

| Operation | Pre-check | Code |
|---|---|---|
| `divide` | `b = 0`, including `0 ÷ 0` | `DIVISION_BY_ZERO` |
| `power` | `a = 0` and `b < 0` | `DIVISION_BY_ZERO` |
| `power` | `a < 0` and `b` is not an integer (`math.Trunc(b) != b`) | `UNDEFINED_RESULT` |
| `sqrt` | `a < 0` | `UNDEFINED_RESULT` |

- `0 ^ 0` is `1`.
- `percentage` computes `a × b / 100`, in that order. If `a × b` overflows, it computes `(a / 100) × b` instead.
- **Overflow:** the rounded value is infinite or beyond the `float64` maximum.
- **Underflow:** the rounded value is subnormal, or it is `0` although no operand forces a zero result. Operands force zero only in these cases: for `multiply` and `percentage`, when `a = 0` or `b = 0`; for `divide`, `power` and `sqrt`, when `a = 0`. A zero from `add` or `subtract` is always exact.
- Both yield `RESULT_OUT_OF_RANGE`. All cases are in **Appendix B.1**.

**MUST NOT:** rely on `math.Pow` special cases (`0 ^ -1` returns `+Inf` and would be reported as overflow); check the range before rounding; return `"0"` on underflow; let `-0` reach a response; test for integers with `b == float64(int64(b))`; use `math.Mod`.

### 3.4 Request validation
Checks run in this order, and each one stops processing:
1. Route and method → `404` / `405` (§3.5).
2. `Content-Type` is `application/json`; parameters such as `charset=utf-8` are allowed. Parse it with `mime.ParseMediaType`. Missing or different → `415 UNSUPPORTED_MEDIA_TYPE`.
3. Body at most 1 KiB (`http.MaxBytesReader`) → otherwise `413 PAYLOAD_TOO_LARGE`.
4. Body is exactly one JSON object, with nothing after it → otherwise `400 MALFORMED_JSON`.
5. Fields → `400 VALIDATION_FAILED`, listing **all** field errors, sorted by field name:

| Issue | When |
|---|---|
| `unknown_field` | Key not allowed for the arity (arity 1 allows `a`; arity 2 allows `a` and `b`) |
| `required` | Allowed key missing or `null` |
| `must_be_string` | Value is not a JSON string; the message shows the expected form, e.g. `"2"` |
| `invalid_number` | String fails the grammar (§2.2) |
| `out_of_range` | String matches the grammar but is out of range (§2.2) |

6. Domain pre-checks (§3.3) → `422`.

- **Technique:** decode into `map[string]json.RawMessage`, then validate the keys and each field separately.
- **Known limitation:** with duplicate keys, `encoding/json` keeps the last value. Document it in the README.
- All cases are in **Appendix B.2**.

**MUST NOT:** ignore data after the object (a second `Decode` **MUST** return `io.EOF`); report a `*http.MaxBytesError` as malformed JSON (use `errors.As`); compare `Content-Type` by string equality; expose Go error text in responses; decode into `float64` fields; return only the first field error.

### 3.5 Error responses
RFC 9457 Problem Details, `Content-Type: application/problem+json`.

| Field | Value |
|---|---|
| `type` | `"about:blank"` |
| `title` | The RFC 9110 reason phrase for the status: `Bad Request`, `Not Found`, `Method Not Allowed`, `Content Too Large`, `Unsupported Media Type`, `Unprocessable Content` or `Internal Server Error`. Taken from a small table, because Go's `http.StatusText` still returns older phrases for `413` and `422` |
| `status` | Same as the HTTP status |
| `detail` | English message for API consumers |
| `code` | Stable code from the catalog |
| `errors` | Only for `VALIDATION_FAILED`: `[{"field", "issue", "message"}]` |

```
422 {"type":"about:blank","title":"Unprocessable Content","status":422,
     "detail":"Cannot divide by zero.","code":"DIVISION_BY_ZERO"}

400 {"type":"about:blank","title":"Bad Request","status":400,
     "detail":"One or more fields are invalid.","code":"VALIDATION_FAILED",
     "errors":[{"field":"a","issue":"must_be_string","message":"a must be a decimal string, e.g. \"2\"."},
               {"field":"b","issue":"required","message":"b is required."}]}
```

| `code` | Status | When |
|---|---|---|
| `MALFORMED_JSON` | 400 | Empty body, invalid JSON, not an object, data after the object |
| `VALIDATION_FAILED` | 400 | Field errors (§3.4) |
| `NOT_FOUND` | 404 | Unknown route |
| `METHOD_NOT_ALLOWED` | 405 | Wrong method; `Allow` header set |
| `PAYLOAD_TOO_LARGE` | 413 | Body larger than 1 KiB |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | `Content-Type` is not JSON |
| `DIVISION_BY_ZERO` | 422 | §3.3 |
| `UNDEFINED_RESULT` | 422 | §3.3 |
| `RESULT_OUT_OF_RANGE` | 422 | §3.3 |
| `INTERNAL_ERROR` | 500 | Recovered panic or unexpected failure |

- `400` means a problem in the request data; `422` means a valid request with no real-number result. So the input `"1e400"` is a `400`, and an out-of-range result is a `422`.
- `404` and `405` **MUST** also be Problem Details:
  - a catch-all `/` handler returns `NOT_FOUND`;
  - each route also registers its method-less pattern (`/api/v1/add`, `/healthz`), which returns `METHOD_NOT_ALLOWED` with `Allow: POST` (or `GET` for `/healthz`). In Go 1.22+ routing, `POST /api/v1/add` takes precedence over `/api/v1/add`, which takes precedence over `/`.
- `INTERNAL_ERROR` uses a generic `detail`; the cause goes only to the log.

**MUST NOT:** `http.Error` or any `text/plain` response; the default `ServeMux` 404/405 bodies; setting headers after `WriteHeader`; `err.Error()` in `detail`; a `status` field that differs from the HTTP status; `http.StatusText` for the `title`; `500` for domain errors; `application/json` as the error content type.

### 3.6 Health check
`GET /healthz` → `200 {"status":"ok"}`. Liveness only, outside `/api`, not proxied by nginx. The server binary also accepts a `-healthcheck` flag: it calls `GET http://127.0.0.1:$PORT/healthz` and exits with `0` on `200`, `1` otherwise. Docker uses it (§10.1).

## 4. Backend design

### 4.1 Packages
```
backend/
  cmd/server/        wiring: config, logger, server, graceful shutdown, -healthcheck flag
  internal/number/   Parse(string) (float64, error): grammar and range (§2.2)
                     Format(float64) string: canonical format (§2.3); never fails
  internal/calc/     operation table, domain pre-checks, rounding, range check, sentinel errors
  internal/httpapi/  routes, generic handler, validation, Problem Details, middleware
```
- `calc` decides the result **value**, including rounding and range; `number` only converts between text and `float64`. The single rounding function lives in `calc`. `calc` **MUST NOT** import `net/http`.
- `go.mod` has **no external dependencies**, tests included.
- Go version: the latest stable release at build time (check with `go version`), the same in `go.mod`, the Dockerfile and CI.

### 4.2 Operation table and generic handler
```go
type Operation struct {
    Name  string                              // route name: "add", ...
    Arity int                                 // 1 or 2
    Apply func(a, b float64) (float64, error) // pre-checks, compute, round, range check
}
var Operations = []Operation{ /* add, subtract, multiply, divide, power, sqrt, percentage */ }
```
- `Operations` is a slice, so routes, docs and tests have a deterministic order. Routes are generated from it. Adding an operation means one entry plus its tests.
- One handler factory, `operationHandler(op calc.Operation) http.Handler`: decode → validate by arity → `op.Apply` → `number.Format` → respond.
- `calc` defines sentinel errors `ErrDivisionByZero`, `ErrUndefinedResult` and `ErrOutOfRange`; `httpapi` defines a `ValidationErrors` type. A single function maps errors to Problem Details with `errors.Is` / `errors.As`.

**MUST NOT:** business logic in handlers; one handler per operation; registration in `init()`; a map as the registry; mapping errors by comparing strings; `utils` or `pkg` packages; adding gin, echo, chi, gorilla/mux or testify; exporting more than needed.

### 4.3 Server behavior

| Topic | Rule |
|---|---|
| Timeouts | `ReadHeaderTimeout` 5 s, `ReadTimeout` 10 s, `WriteTimeout` 10 s, `IdleTimeout` 60 s |
| Shutdown | `signal.NotifyContext` (SIGINT, SIGTERM) → `srv.Shutdown` with a 10 s deadline; `http.ErrServerClosed` is not an error |
| Logging | `log/slog`, JSON to stdout. One line per request: method, path, status, duration, `request_id`. Level from `LOG_LEVEL`. Never log bodies |
| Request ID | Random (16 bytes from `crypto/rand`, hex), returned in `X-Request-ID` and logged; a client-sent ID is ignored |
| Recover | Panic → `500 INTERNAL_ERROR`, stack trace in the log |
| Middleware order | request ID → logging → recover → router |
| Config | Environment only: `PORT` (default `8080`), `LOG_LEVEL` (default `info`) |
| Headers | `X-Content-Type-Options: nosniff` on every response |
| CORS | None (same origin, §1.3) |

**MUST NOT:** `http.ListenAndServe` without timeouts; `fmt` or `log` for logging; CORS headers; recover outside the logging middleware; changing the status in recover after the handler has already written headers (only log it).

## 5. Calculator behavior

### 5.1 Keys
`keys.ts` is the single source for each key: id, label, accessible name, shortcuts and grid position (§7.3).

| Id | Label | Accessible name | Shortcuts | Kind |
|---|---|---|---|---|
| `0`…`9` | `0`…`9` | the digit | `0`–`9` | digit |
| `decimal` | `.` | decimal point | `.` `,` | digit |
| `add` `subtract` `multiply` `divide` `power` | `+ − × ÷ xʸ` | add, subtract, multiply, divide, power | `+ - * / ^` | operator |
| `sqrt` | `√` | square root | `r` | unary |
| `percent` | `%` | percent | `%` | unary |
| `sign` | `±` | toggle sign | `n` | edit |
| `backspace` | `⌫` | backspace | `Backspace` | edit |
| `clear` | `AC` | all clear | `Escape` `Delete` | clear |
| `equals` | `=` | equals | `Enter` `=` | equals |

Operator ids are the API route names; `percent` calls `/percentage`.

### 5.2 Interaction model
- **Immediate execution:** an operator pressed when a second operand is present sends the pending operation to the API, and the result becomes the first operand. `2 + 3 × 4 =` → `20`.
- The API is called only for chaining, `=`, `√` and `%`. `⌫` and `±` edit text.

**MUST NOT:** `eval`, `Function`, an expression parser, or any arithmetic in the frontend.

### 5.3 State
```ts
type BinaryOp = 'add' | 'subtract' | 'multiply' | 'divide' | 'power';
type Phase =
  | 'first'     // typing the first operand; the initial state is "0", editable
  | 'awaiting'  // operator pending, no second operand yet; main line shows the accumulator
  | 'second'    // second operand typed, or computed by √ / %
  | 'result'    // after "="
  | 'error';    // domain error shown (§6.2)
type State = {   // minimum shape; fields MAY be added (error message, banner)
  phase: Phase;
  entry: string;              // main line, unformatted
  editable: boolean;          // typed (true) or computed (false)
  accumulator: string | null;
  operator: BinaryOp | null;
  lastOp: { left: string; operator: BinaryOp; operand: string } | null; // for repeated "="
  pending: PendingRequest | null;
  queue: KeyId[];             // §6.1
};
```
**Upper line** (operator symbols `+ − × ÷ ^`): empty in `first`; `{accumulator} {op}` in `awaiting` and `second`; `{left} {op} {operand} =` in `result`; in `error`, the failed binary request followed by `=` (empty if `√` or `%` failed).

### 5.4 Key rules

| Key | Rule |
|---|---|
| Digit | **Editable:** append; replaces a lone `0` (`-0` → `-d`); ignored at 15 digits. **Computed:** start a new number; `awaiting` → `second`; `result` → `first` and `lastOp` cleared. |
| `.` | Like a digit, but a new number starts as `0.`; ignored if the entry already has `.` or 15 digits. |
| Operator | **`first` / `result`:** accumulator = entry, → `awaiting`, entry becomes computed, `lastOp` cleared; no request. **`awaiting`:** replace the operator. **`second`:** request `op(accumulator, entry)`; the result becomes accumulator and entry; → `awaiting`. |
| `=` | **`second`:** request `op(accumulator, entry)`, set `lastOp`, → `result`. **`awaiting`:** the entry is also the second operand (`5 + =` → `10`). **`result`:** repeat `lastOp` on the result. **`first`:** no request; normalize only. |
| `√` `%` | Request per §5.5; the result replaces the entry as computed. `awaiting` → `second`; `result` → `first` and `lastOp` cleared. |
| `±` | Text edit; the phase does not change. **Editable:** toggle a leading `-` (`0` → `-0`). **Computed:** toggle, except on `0`. **`awaiting`:** start the second operand as `-0`, editable, → `second`. |
| `⌫` | **Editable:** drop the last character; `""` or `-` becomes `0`. **Computed:** no effect. |
| `AC` | Initial state; cancels any request (§6.1). |

**Normalization:** when the entry becomes an operand (request or accumulator), drop a trailing `.` and turn `-0` into `0`.

**MUST NOT:** a single `waitingForOperand` flag instead of the phases; swapped operands on a repeated `=`; JS numbers in the state; sending `"5."`.

### 5.5 Square root and percent
- `√` requests `sqrt(entry)`.
- `%` requests `percentage(entry, accumulator)` when `+` or `−` is pending; otherwise `percentage(entry, "1")`, i.e. `entry / 100`.
- The result replaces the entry, and a pending operator stays pending. Cases in B.3.

**MUST NOT:** `%` as modulo; computing a percentage in the frontend.

## 6. Requests and errors in the UI

### 6.1 Requests
- The reducer is pure. When a key needs the API, it sets `pending = { id, op, a, b, kind, previous }`, where `id` increases, `kind` is `chain`, `equals` or `unary`, and `previous` is the state before the key.
- `useCalculator` has one effect, keyed on the pending `id`. It calls `calculate` (§6.2) and dispatches `RESOLVED` or `FAILED`; a response with a different `id` is ignored.
- Keys pressed while a request is pending (except `AC`) are queued, up to 32. After the response is applied, the queue is replayed in order, also after a domain error (the replayed keys then follow the `error` phase rules, §6.2); only a system error discards it. One request at a time; the keypad is never disabled.
- `AC` resets immediately, and the effect cleanup aborts the `fetch` (on unmount too).
- **Timeout** 5 s: `AbortSignal.any([AbortSignal.timeout(5000), controller.signal])`. A `TimeoutError` is a system error; an `AbortError` is ignored. No retries. The loading indicator appears after 300 ms (§7.1).

**MUST NOT:** `fetch` in the reducer or in event handlers; parallel requests; effect dependencies other than the pending `id`; removing StrictMode to hide the double request in development; a timeout built with `setTimeout` and `Promise.race`.

### 6.2 Errors
`calculate(op, a, b, signal)` in `src/api/client.ts` never throws:
```ts
type CalcResult = { ok: true; result: string } | { ok: false; error: CalcError };
type CalcError =
  | { kind: 'domain'; code: 'DIVISION_BY_ZERO' | 'UNDEFINED_RESULT' | 'RESULT_OUT_OF_RANGE' }
  | { kind: 'system'; reason: 'timeout' | 'network' | 'unknown' }
  | { kind: 'aborted' };
```

| Response | Result |
|---|---|
| `200` with `{"result": <string>}` | `ok` |
| `422` with a known domain `code` | `domain` |
| `TimeoutError` | `system` / `timeout` |
| `fetch` rejects, or `502` / `503` / `504` | `system` / `network` |
| `AbortError` | `aborted` |
| Anything else (other status, non-JSON body, unexpected shape, unknown `code`) | `system` / `unknown` |

- **Domain error:** shown on the main line; phase `error`; the message is never stored in `entry`. A digit or `.` starts over, `AC` or `⌫` returns to `0`, and other keys are ignored.
- **System error:** a banner below the display (`role="alert"`); the state is restored to `previous` and the queue is discarded. Any key hides the banner and is processed normally, so `=` retries.
- The backend `detail` goes to the console only.

| Case | Message |
|---|---|
| `DIVISION_BY_ZERO` | Cannot divide by zero |
| `UNDEFINED_RESULT` | Not a real number |
| `RESULT_OUT_OF_RANGE` | Out of range |
| `timeout` | The server took too long. Try again. |
| `network` | Can't reach the server. Try again. |
| `unknown` | Something went wrong. Try again. |

**MUST NOT:** show `detail`, an HTTP status or `TypeError` on screen; let `response.json()` throw on an HTML error page.

## 7. Presentation

### 7.1 Display
- Two lines: the upper line (§5.3) and the main line (the entry, or the domain error message).
- **Thousands separators:** fixed en-US (`,` groups, `.` decimal). A pure text function applied at render time to every number shown. It groups the integer part only; the fraction, the exponent, a trailing `.` and typed zeros are left as they are. The state never contains separators.
- **Long numbers:** the font steps down by character count (≤ 9, 10–13, ≥ 14). No DOM measuring; the text never wraps or scrolls.
- Scientific notation is shown exactly as returned.
- **Loading:** after 300 ms, a discreet indicator on the upper line and `aria-busy="true"` on the display.

**MUST NOT:** `Number(...).toLocaleString()` or `Intl` with the browser locale; grouping fraction or exponent digits; formatted text in the state; `ResizeObserver`. Cases in B.5.

### 7.2 Physical keyboard
- One `keydown` listener on `window`, in a `useEffect` with cleanup. It maps `event.key` through `keys.ts` and dispatches; it never reads the state.
- Letter shortcuts are case-insensitive. `Shift` is accepted; events with `Ctrl`, `Meta`, `Alt` or `isComposing` are ignored. `event.repeat` is accepted only for digits and `Backspace`. `preventDefault` only on handled keys.
- **Enter on a focused button:** mouse clicks don't move focus to the button (`preventDefault` on `mousedown`). When a button was reached with Tab, `Enter` and `Space` activate it; otherwise `Enter` is `=`.
- A key pressed on the keyboard flashes its on-screen key for ~100 ms (component state). Each button has a `title` such as "Square root (R)" and `aria-keyshortcuts`.

**MUST NOT:** `keyCode`, `which` or `event.code`; a listener without cleanup; filtering `Shift`. Cases in B.6.

### 7.3 Layout, styling, accessibility
```
AC   ⌫    %    ÷
√    xʸ   ±    ×
7    8    9    −
4    5    6    +
1    2    3    =
0 (2 columns) .  =   (= spans 2 rows)
```
- CSS Modules and CSS custom properties. Light and dark themes via `prefers-color-scheme`, with no toggle. System font; `tabular-nums` on the display.
- Centered card, max width ~360 px; square keys, at least 48 px; works at 320 px.
- Operators in an accent color, `=` the strongest, `AC` distinct. AA contrast. A visible `:focus-visible` ring. `prefers-reduced-motion` turns off the flash transition.
- `<button type="button">` with the accessible names from §5.1. Keypad: `role="group"`, `aria-label="Keypad"`. Main line: `aria-live="polite"`, `aria-atomic="true"`; the upper line is outside the live region. `lang="en"`, `<title>Calculator</title>`, a visually hidden `<h1>`. Tab order follows the visual order.

**MUST NOT:** `div` with `onClick`; `outline: none` without a replacement; JSX written per key instead of mapping `keys.ts`; Tailwind, CSS-in-JS, icon libraries or web fonts.

## 8. Frontend architecture

### 8.1 Tooling
- Vite `react-ts` template, with the current stable versions at build time and the lockfile committed. Never downgrade or mix major versions, with one exception: TypeScript is pinned to the latest 6.0.x, because typescript-eslint doesn't support TypeScript 7 yet (7.0 has no compiler API; support is expected with 7.1).
- Node LTS, recorded in `.nvmrc` and `engines` (the same in the Dockerfile and CI). npm only.
- TypeScript `strict` plus `noUncheckedIndexedAccess`; no `any`, no `@ts-ignore`. ESLint flat config with `typescript-eslint` and `react-hooks` (`exhaustive-deps` as an error); Prettier.
- StrictMode on; native `fetch`. Vite proxies `/api` to `http://localhost:8080`; the target can be overridden by an environment variable in `vite.config.ts` only.
- Scripts: `dev`, `build`, `typecheck`, `lint`, `format`, `test` (`vitest run`), `test:coverage`.

**MUST NOT:** Create React App; axios, zod, Redux, lodash, MSW; absolute API URLs; turning off `strict` or `exhaustive-deps`.

### 8.2 Modules
```
frontend/src/
  main.tsx, App.tsx
  api/client.ts            calculate() and error classification (§6.2)
  calculator/
    types.ts  keys.ts  reducer.ts  format.ts  keyboard.ts  messages.ts  useCalculator.ts
    Calculator.tsx  Display.tsx  Keypad.tsx  Key.tsx  (+ *.module.css)
```
Tests sit next to each file (`*.test.ts(x)`).

## 9. Testing

### 9.1 Backend
- Named table tests (`t.Run`): `number` (§2.2, §2.3), `calc` (B.1), `httpapi` with `httptest` against the full router (B.2, `X-Request-ID`, and recover through a test handler that panics).
- Fuzzing: `FuzzRoundTrip` (`Format(x)` parses back and formats to the same string) and `FuzzParse` (no input panics). The seeds run in `go test`.
- Run with `-race`. Compare formatted strings, never floats with `==`. Standard library only.

### 9.2 Frontend
- Vitest, jsdom, Testing Library and user-event.
- Reducer: B.3 through a harness with an explicit response map. `format` and `keyboard`: B.5 and B.6. Client: every row of the §6.2 table.
- Components: query by role and name; flows by click and by keyboard; Enter on a focused button; B.4 with a fake `fetch` (`vi.stubGlobal`) and fake timers (300 ms, 5 s).

**MUST NOT:** MSW; `vi.mock` of the client, the reducer or the hook; `fireEvent`; `data-testid` or class selectors; whole-DOM snapshots; real timers.

### 9.3 Contract examples
`contract/examples.json` holds about 15 cases taken from §3.2, B.1 and B.2, each as `{ "name", "method", "path", "body", "status", "response" }`. The Go test runs them against the real router; the frontend client test replays the same responses.

### 9.4 Smoke test
`make smoke` runs `docker compose up --build -d --wait`, then `curl`s through nginx: the page (`200`, HTML) and `POST /api/v1/add` with `{"a":"1","b":"2"}` (expects `{"result":"3"}`). It always runs `docker compose down` and fails on any mismatch.

### 9.5 Coverage gates
- Go: `./internal/...` ≥ 90%, checked in the Makefile from `go tool cover -func`. `cmd/server` is reported but not gated.
- Frontend: `src/calculator/**` and `src/api/**` ≥ 90%, total ≥ 80%, via Vitest `coverage.thresholds`. `main.tsx`, CSS and test files are excluded.
- If a gate fails, add tests. **MUST NOT** lower a threshold or exclude a file to pass.

## 10. Packaging and CI

### 10.1 Docker
- **Backend image:** `golang:<x.y>-alpine` builds with `CGO_ENABLED=0 go build -trimpath -ldflags="-s -w"`; the final image is `gcr.io/distroless/static-debian12:nonroot`. `ENTRYPOINT ["/server"]` in exec form. Healthcheck: `["/server", "-healthcheck"]`.
- **Frontend image:** `node:<LTS>-alpine` runs `npm ci && npm run build`; the final image is `nginxinc/nginx-unprivileged:<x.y>-alpine`, listening on 8080.
- Dependency manifests are copied and installed before the sources. One `.dockerignore` per app.
- **Compose** (no `version:` key): `backend` with the healthcheck and no published port; `frontend` on `3000:8080`, with `depends_on` → `backend: condition: service_healthy`.
- Image tags are pinned to `major.minor`, matching `go.mod` and `.nvmrc`; never `latest`.

### 10.2 nginx
- `try_files $uri /index.html`. `location /api/ { proxy_pass http://backend:8080; }` with **no trailing slash**, plus `X-Forwarded-For` and 10 s proxy timeouts.
- gzip. Hashed assets: `Cache-Control: public, max-age=31536000, immutable`; `index.html`: `no-cache`. Headers `X-Content-Type-Options: nosniff` and `Referrer-Policy: strict-origin-when-cross-origin`.
- No body-size override (the API enforces it) and no CSP.

### 10.3 Makefile
At the repository root, POSIX shell. Targets: `up`, `down`, `dev-backend`, `dev-frontend`, `test`, `cover`, `lint`, `smoke`, `fuzz`.

### 10.4 GitHub Actions
`.github/workflows/ci.yml` runs on pushes and pull requests to `main`, with `permissions: contents: read` and `concurrency` cancelling older runs. Actions use their current major versions.

| Job | Steps |
|---|---|
| `backend` | `setup-go` (version from `go.mod`); `test -z "$(gofmt -l .)"`; `go vet ./...`; tests with `-race` and coverage; gate; summary to `$GITHUB_STEP_SUMMARY`; HTML report as an artifact |
| `frontend` | `setup-node` (from `.nvmrc`, npm cache); `npm ci`; lint; typecheck; `test:coverage` (gate); summary; HTML artifact |
| `smoke` | Needs both; `make smoke` |

**MUST NOT (§10):** single-stage images; shell-form `CMD`; `proxy_pass` with a trailing slash; a `curl` healthcheck on distroless; running as root; `localhost` between containers; a published backend port; the Vite dev server in an image; `npm install` in CI; Vitest in watch mode; outdated action versions or `set-output`.

## 11. Repository and documentation
- **README:** overview and screenshot; quick start; running locally; API with `curl` examples and the error catalog; calculator behavior and shortcuts; design decisions (summary with a link to `docs/DECISIONS.md`); testing and coverage; project structure; limitations and next steps; how AI was used; time spent. Numbers (coverage, time) come from real runs and are never invented.
- **`docs/DECISIONS.md`** and **`PROMPTS.md`** are written by the author. Implementers **MUST NOT** edit them, and **MUST NOT** rewrite the recorded prompts.
- **Commits:** Conventional Commits in English, one per step, no squashing, on `main`.
- **`.gitignore`:** `node_modules/`, `dist/`, `coverage/`, `*.out`, `coverage.html`, `.env`, OS and editor files.
- **`.editorconfig`:** UTF-8, LF, final newline; tabs for Go and the Makefile, 2 spaces otherwise.
- **`.gitattributes`:** `* text=auto eol=lf`, so a Windows checkout doesn't break the Makefile or the shell scripts.
- No `CLAUDE.md` and no license.

---

## Appendix A. Glossary
- **Arity:** number of operands (1 for `sqrt`, 2 for the rest).
- **Editable / computed entry:** typed by the user, or produced by the API (a result, or `√` / `%` output).
- **Chaining:** pressing an operator when a second operand is present, which computes the pending operation.
- **Canonical format:** the API's result string (§2.3).
- **Normal range:** non-zero `float64` values from `2.2250738585072014e-308` to `1.7976931348623157e308`.
- **Underflow:** a non-zero exact result that rounds to `0` or to a subnormal value.
- **Domain error / system error:** the math has no real result (`422`) / anything else that failed (§6.2).

## Appendix B. Test cases

### B.1 Operations (`calc` and API)

| Operation | `a` | `b` | Result |
|---|---|---|---|
| `add` | `0.1` | `0.2` | `"0.3"` |
| `add` | `999999999999999` | `1` | `"1e+15"` |
| `add` | `1e308` | `1e308` | `RESULT_OUT_OF_RANGE` |
| `add` | `1.7976931348623157e308` | `0` | `RESULT_OUT_OF_RANGE` (overflows after rounding) |
| `add` | `2.2250738585072014e-308` | `0` | `RESULT_OUT_OF_RANGE` (underflows after rounding) |
| `subtract` | `0.3` | `0.1` | `"0.2"` |
| `subtract` | `5` | `5` | `"0"` |
| `multiply` | `1.5` | `2` | `"3"` |
| `multiply` | `-1` | `0` | `"0"` |
| `multiply` | `123456789` | `987654321` | `"1.21932631112635e+17"` |
| `multiply` | `1e200` | `1e200` | `RESULT_OUT_OF_RANGE` |
| `multiply` | `1e-200` | `1e-200` | `RESULT_OUT_OF_RANGE` (underflow) |
| `divide` | `7` | `2` | `"3.5"` |
| `divide` | `2` | `3` | `"0.666666666666667"` |
| `divide` | `0.000001` | `10` | `"1e-7"` |
| `divide` | `5` | `0` | `DIVISION_BY_ZERO` |
| `divide` | `0` | `0` | `DIVISION_BY_ZERO` |
| `divide` | `0` | `5` | `"0"` |
| `divide` | `-0` | `5` | `"0"` |
| `power` | `0` | `0` | `"1"` |
| `power` | `0` | `-1` | `DIVISION_BY_ZERO` |
| `power` | `-8` | `0.5` | `UNDEFINED_RESULT` |
| `power` | `-2` | `3` | `"-8"` |
| `power` | `2` | `-1` | `"0.5"` |
| `power` | `10` | `309` | `RESULT_OUT_OF_RANGE` |
| `power` | `10` | `-400` | `RESULT_OUT_OF_RANGE` (underflow) |
| `sqrt` | `9` | — | `"3"` |
| `sqrt` | `2` | — | `"1.4142135623731"` |
| `sqrt` | `0` | — | `"0"` |
| `sqrt` | `-0` | — | `"0"` |
| `sqrt` | `-4` | — | `UNDEFINED_RESULT` |
| `percentage` | `10` | `50` | `"5"` |
| `percentage` | `50` | `1` | `"0.5"` |
| `percentage` | `0` | `50` | `"0"` |
| `percentage` | `1e308` | `10` | `"1e+307"` (`a × b` overflows; falls back to `(a / 100) × b`) |
| `percentage` | `1e308` | `1e10` | `RESULT_OUT_OF_RANGE` |

### B.2 Request validation (API)

| Request | Status | Expected |
|---|---|---|
| `POST /api/v1/add`, `Content-Type: text/plain`, valid body | 415 | `UNSUPPORTED_MEDIA_TYPE` |
| `POST /api/v1/add`, no `Content-Type` | 415 | `UNSUPPORTED_MEDIA_TYPE` |
| `POST /api/v1/add`, `application/json; charset=utf-8`, `{"a":"1","b":"2"}` | 200 | `"3"` |
| Body larger than 1 KiB | 413 | `PAYLOAD_TOO_LARGE` |
| Empty body | 400 | `MALFORMED_JSON` |
| `{"a":` | 400 | `MALFORMED_JSON` |
| `[]` | 400 | `MALFORMED_JSON` |
| `{"a":"1","b":"2"} x` | 400 | `MALFORMED_JSON` |
| `add` `{"a":"1"}` | 400 | `b: required` |
| `add` `{"a":"1","b":null}` | 400 | `b: required` |
| `add` `{"a":2,"b":"3"}` | 400 | `a: must_be_string` |
| `add` `{"a":2}` | 400 | `a: must_be_string`, `b: required` (both, in this order) |
| `add` `{"a":"1","b":"2","c":"3"}` | 400 | `c: unknown_field` |
| `sqrt` `{"a":"9","b":"1"}` | 400 | `b: unknown_field` |
| `add` with `a` = `"abc"`, `"NaN"`, `"Inf"`, `"0x10"`, `"1,5"`, `" 1"`, `"+1"`, `".5"`, `"1."`, `"01"`, `""`, or 33 characters | 400 | `a: invalid_number` |
| `add` with `a` = `"1e400"` or `"1e-400"` | 400 | `a: out_of_range` |
| `add` `{"a":"-0","b":"5"}` | 200 | `"5"` |
| `GET /api/v1/add` | 405 | `METHOD_NOT_ALLOWED`, `Allow: POST` |
| `POST /api/v1/mod` | 404 | `NOT_FOUND` |
| `POST /healthz` | 405 | `METHOD_NOT_ALLOWED`, `Allow: GET` |

### B.3 Key sequences (reducer)
Each row starts from the initial state. The harness answers requests from the last column; any other request fails the test. Lines are unformatted.

| Keys | Upper line | Main line | Requests → response |
|---|---|---|---|
| (start) | | `0` | |
| `0 0 7` | | `7` | |
| `. 5` | | `0.5` | |
| `1 . . 2` | | `1.2` | |
| `9` × 16 | | `999999999999999` | |
| `1 2 ⌫` | | `1` | |
| `± 5 ⌫` | | `0` | |
| `5 . =` | | `5` | |
| `5 × 3` | `5 ×` | `3` | |
| `2 + 3 × 4 =` | `5 × 4 =` | `20` | add 2 3 → 5; multiply 5 4 → 20 |
| `5 + × 2 =` | `5 × 2 =` | `10` | multiply 5 2 → 10 |
| `5 + =` | `5 + 5 =` | `10` | add 5 5 → 10 |
| `10 − 3 = =` | `7 − 3 =` | `4` | subtract 10 3 → 7; subtract 7 3 → 4 |
| `2 + 3 = 4` | | `4` | add 2 3 → 5 |
| `2 + 3 = × 4 =` | `5 × 4 =` | `20` | add 2 3 → 5; multiply 5 4 → 20 |
| `2 + 3 = ⌫` | `2 + 3 =` | `5` | add 2 3 → 5 |
| `5 × ± 3 =` | `5 × -3 =` | `-15` | multiply 5 -3 → -15 |
| `9 √ 5` | | `5` | sqrt 9 → 3 |
| `9 + 16 √ =` | `9 + 4 =` | `13` | sqrt 16 → 4; add 9 4 → 13 |
| `9 + √ =` | `9 + 3 =` | `12` | sqrt 9 → 3; add 9 3 → 12 |
| `2 + 3 = √ =` | | `2.23606797749979` | add 2 3 → 5; sqrt 5 → 2.23606797749979 |
| `10 %` | | `0.1` | percentage 10 1 → 0.1 |
| `50 + 10 % =` | `50 + 5 =` | `55` | percentage 10 50 → 5; add 50 5 → 55 |
| `50 × 10 % =` | `50 × 0.1 =` | `5` | percentage 10 1 → 0.1; multiply 50 0.1 → 5 |
| `50 + % =` | `50 + 25 =` | `75` | percentage 50 50 → 25; add 50 25 → 75 |
| `5 ÷ 0 =` | `5 ÷ 0 =` | `Cannot divide by zero` | divide 5 0 → `DIVISION_BY_ZERO` |
| `5 ÷ 0 +` | `5 ÷ 0 =` | `Cannot divide by zero` | divide 5 0 → `DIVISION_BY_ZERO` |
| `5 ÷ 0 = + = √ % ±` | `5 ÷ 0 =` | `Cannot divide by zero` | divide 5 0 → `DIVISION_BY_ZERO` |
| `5 ÷ 0 = 7` | | `7` | divide 5 0 → `DIVISION_BY_ZERO` |
| `5 ÷ 0 = ⌫` | | `0` | divide 5 0 → `DIVISION_BY_ZERO` |
| `4 ± √` | | `Not a real number` | sqrt -4 → `UNDEFINED_RESULT` |
| `10 xʸ 400 =` | `10 ^ 400 =` | `Out of range` | power 10 400 → `RESULT_OUT_OF_RANGE` |

### B.4 Requests and system errors (hook and components, fake `fetch`)

| Scenario | Upper | Main | Banner |
|---|---|---|---|
| `2 + 3 +`, then `4 =` before the first response (add 2 3 → 5; add 5 4 → 9) | `5 + 4 =` | `9` | — |
| `2 + 3 =`, then `AC` before the response; the response arrives later | | `0` | — |
| `5 ÷ 0 =`, then `7` before the response (divide 5 0 → `DIVISION_BY_ZERO`) | | `7` | — |
| `8 ÷ 2 =`, no response within 5 s | `8 ÷` | `2` | The server took too long. Try again. |
| `2 + 3 =`, network failure | `2 +` | `3` | Can't reach the server. Try again. |
| …then `=` again and the server answers (add 2 3 → 5) | `2 + 3 =` | `5` | — |
| `2 + 3 +`, network failure, `4 =` pressed while waiting | `2 +` | `3` | Can't reach the server. Try again. (queue discarded) |
| `2 + 3 =`, `502` with an HTML body | `2 +` | `3` | Can't reach the server. Try again. |
| `2 + 3 =`, `500` | `2 +` | `3` | Something went wrong. Try again. |
| `2 + 3 =`, network failure, then `7` | `2 +` | `37` | — (the restored entry is still editable) |

### B.5 Display formatting (`format.ts`)

| `entry` | Shown |
|---|---|
| `123` | `123` |
| `1234` | `1,234` |
| `-1234.50` | `-1,234.50` |
| `1000.` | `1,000.` |
| `999999999999999` | `999,999,999,999,999` |
| `0.000001` | `0.000001` |
| `1.21932631112635e+17` | `1.21932631112635e+17` |
| `-0` | `-0` |

### B.6 Keyboard mapping (`keyboard.ts`)

| Event | Action |
|---|---|
| `"7"` | digit 7 |
| `","` | decimal point |
| `"*"` with `Shift` | multiply |
| `"R"` | square root |
| `"Enter"` | equals |
| `"Escape"`, `"Delete"` | all clear |
| `"5"` with `repeat` | digit 5 |
| `"Backspace"` with `repeat` | backspace |
| `"="` with `repeat` | ignored |
| `"r"` with `Ctrl` | ignored |
| `"x"` | ignored |
| any key with `isComposing` | ignored |
