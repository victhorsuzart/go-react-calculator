# go-react-calculator

A web calculator with a React + TypeScript frontend and a Go REST API. Every arithmetic operation is performed by the API; the frontend only manages input and display.

<!-- Screenshot: docs/screenshot.png (added after implementation). -->

## Quick start

Requires Docker with Compose v2.

```bash
docker compose up --build
```

Open http://localhost:3000. The API is served from the same origin, at `http://localhost:3000/api/v1/...`.

`make up` and `make down` do the same in the background.

## Running locally

Prerequisites: Go (version in `backend/go.mod`), Node.js LTS (version in `frontend/.nvmrc`), npm, and optionally Make.

| Task | Make | Raw command |
|---|---|---|
| API on `:8080` | `make dev-backend` | `cd backend && go run ./cmd/server` |
| Frontend on `:5173` (proxies `/api` to `:8080`) | `make dev-frontend` | `cd frontend && npm ci && npm run dev` |
| All tests | `make test` | `cd backend && go test -race ./...` and `cd frontend && npm test` |
| Coverage reports | `make cover` | `cd frontend && npm run test:coverage`; Go: see the Makefile |
| Lint and type check | `make lint` | `gofmt -l`, `go vet ./...`, `npm run lint`, `npm run typecheck` |
| Smoke test of the Docker stack | `make smoke` | see the Makefile |
| Fuzzing (optional, long) | `make fuzz` | see the Makefile |

The API reads two environment variables: `PORT` (default `8080`) and `LOG_LEVEL` (default `info`).

## API

Every operation is a `POST` with `Content-Type: application/json`. **Numbers are decimal strings**, in requests and in responses.

| Endpoint | Body | Result |
|---|---|---|
| `POST /api/v1/add` | `{"a": "7", "b": "2"}` | a + b |
| `POST /api/v1/subtract` | `{"a": "7", "b": "2"}` | a − b |
| `POST /api/v1/multiply` | `{"a": "7", "b": "2"}` | a × b |
| `POST /api/v1/divide` | `{"a": "7", "b": "2"}` | a ÷ b |
| `POST /api/v1/power` | `{"a": "7", "b": "2"}` | a ^ b |
| `POST /api/v1/sqrt` | `{"a": "9"}` | √a |
| `POST /api/v1/percentage` | `{"a": "10", "b": "50"}` | a% of b |

A successful call returns `200` with `{"result": "3.5"}`. Results are rounded to 15 significant digits and use plain notation when `1e-6 ≤ |x| < 1e15`, scientific notation otherwise (`"1e+15"`, `"1.21932631112635e+17"`).

`GET /healthz` is a liveness check for the container; it is not exposed through nginx.

### Examples

```bash
curl -s http://localhost:3000/api/v1/add \
  -H 'Content-Type: application/json' -d '{"a":"0.1","b":"0.2"}'
# 200 {"result":"0.3"}

curl -s http://localhost:3000/api/v1/divide \
  -H 'Content-Type: application/json' -d '{"a":"5","b":"0"}'
# 422 {"type":"about:blank","title":"Unprocessable Content","status":422,
#      "detail":"Cannot divide by zero.","code":"DIVISION_BY_ZERO"}

curl -s http://localhost:3000/api/v1/sqrt \
  -H 'Content-Type: application/json' -d '{"a":9,"b":"1"}'
# 400 {..., "code":"VALIDATION_FAILED",
#      "errors":[{"field":"a","issue":"must_be_string",...},
#                {"field":"b","issue":"unknown_field",...}]}
```

### Errors

Errors follow RFC 9457 (Problem Details, `application/problem+json`) and carry a stable `code`. Invalid input is a `400`; valid input with no real-number result is a `422`.

| `code` | Status | When |
|---|---|---|
| `MALFORMED_JSON` | 400 | Empty body, invalid JSON, not an object, or data after the object |
| `VALIDATION_FAILED` | 400 | One or more invalid fields, all listed in `errors` (`required`, `must_be_string`, `invalid_number`, `out_of_range`, `unknown_field`) |
| `NOT_FOUND` | 404 | Unknown route |
| `METHOD_NOT_ALLOWED` | 405 | Wrong method; the `Allow` header names the right one (`POST` for operations, `GET` for `/healthz`) |
| `PAYLOAD_TOO_LARGE` | 413 | Body larger than 1 KiB |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | `Content-Type` is not JSON |
| `DIVISION_BY_ZERO` | 422 | `x ÷ 0`, `0 ^ negative` |
| `UNDEFINED_RESULT` | 422 | `√` of a negative number, negative base with a fractional exponent |
| `RESULT_OUT_OF_RANGE` | 422 | Overflow or underflow of the result |
| `INTERNAL_ERROR` | 500 | Unexpected failure (details only in the server log) |

## Calculator behavior

- **Immediate execution**, like a pocket calculator: each operator applies the pending operation. `2 + 3 × 4 =` gives `20`, and `5` is shown when `×` is pressed. The line above the number shows the pending operation.
- Pressing `=` again repeats the last operation: `2 + 3 = =` gives `8`. `5 + =` gives `10`.
- **Percent is contextual**, as on iOS and Windows. After `+` or `−`, `b%` means b% of the first number: `50 + 10 % =` gives `55`. Otherwise `x%` is `x / 100`: `50 × 10 % =` gives `5`.
- **√** applies to the number on the display, and a pending operation stays pending: `9 + 16 √ =` gives `13`.
- Errors such as division by zero appear on the display; the next digit starts a new calculation. Connection errors show a banner and keep your input, so you can try again.

### Keyboard shortcuts

| Key | Action |
|---|---|
| `0`–`9` | Digits |
| `.` or `,` | Decimal point |
| `+` `-` `*` `/` | Operators |
| `^` | Power |
| `r` | Square root |
| `%` | Percent |
| `n` | Toggle sign |
| `Enter` or `=` | Equals |
| `Backspace` | Delete the last digit |
| `Escape` or `Delete` | All clear |

## Design decisions

A summary. The alternatives considered and the reasoning behind each choice are in [docs/DECISIONS.md](docs/DECISIONS.md); the implementation spec is [docs/SPEC.md](docs/SPEC.md).

1. **All arithmetic happens in the API.** The frontend never converts the display to a JavaScript number; it edits text and sends strings.
2. **Immediate execution instead of operator precedence.** Each step is one API call, which matches the one-endpoint-per-operation contract, and the partial result is always visible.
3. **Numbers travel as decimal strings.** The API defines the canonical format, and the browser never reinterprets it.
4. **`float64` rounded to 15 significant digits.** `0.1 + 0.2` shows `0.3`. This is enough for a calculator display; for a ledger I would use a decimal type.
5. **Overflow and underflow are errors**, never a silent `Infinity` or `0`. Domain checks run before computing, so `0 ^ -1` is reported as division by zero, not as overflow.
6. **RFC 9457 Problem Details with stable codes.** `400` for bad input, `422` for valid input without a real result.
7. **Strict validation that reports every field error at once.**
8. **Go standard library only.** Go 1.22+ routing, an operation table and one generic handler.
9. **The UI state is a pure reducer.** API calls are described as state and run by an effect; keys pressed during a request are queued, one request runs at a time, and stale responses are ignored.
10. **Same origin through a proxy** (Vite in development, nginx in Docker), so no CORS.

## Testing

| Layer | What is tested | How |
|---|---|---|
| Go | Number parsing and formatting, every operation and edge case, HTTP validation and errors | Table-driven tests, native fuzzing (number parsing never panics; format round-trip), `httptest`, race detector |
| Frontend | State machine (key sequence → display), display formatting, keyboard mapping, API client error handling, components | Vitest, Testing Library and user-event; a fake `fetch` with explicit responses, so tests never do arithmetic |
| Contract | `contract/examples.json`, checked by both layers | Shared fixtures |
| Smoke | The Docker stack end to end, through nginx | `make smoke`, also in CI |

Coverage gates, enforced in CI: Go at least 90% on `backend/internal/...` (`cmd/server` is reported but not gated); frontend at least 90% on `src/calculator/` and `src/api/`, and at least 80% overall.

<!-- Coverage table: filled in after the final run of `make cover`. -->

## Project structure

```
backend/                  Go module
  cmd/server/             wiring: config, logger, server, graceful shutdown
  internal/calc/          operations, domain checks, rounding, range checks
  internal/number/        decimal string ↔ float64 (grammar, range, canonical format)
  internal/httpapi/       routes, generic handler, validation, Problem Details, middleware
frontend/                 Vite + React + TypeScript
  src/api/                API client and error classification
  src/calculator/         keys, reducer (state machine), display formatting, keyboard, components
contract/examples.json    request/response examples shared by both test suites
docs/                     SPEC.md, DECISIONS.md, screenshot
.github/workflows/ci.yml  CI: lint, tests with coverage gates, Docker smoke test
docker-compose.yml        nginx (frontend + /api proxy) and the API
Makefile                  common tasks
PROMPTS.md                how AI was used, with every Claude Code prompt
```

## Limitations and next steps

- Operator precedence and parentheses: an expression endpoint (`/evaluate`) with a parser in the API, keeping the per-operation endpoints.
- A decimal type (e.g. `shopspring/decimal`) if results ever represent money.
- An OpenAPI document, checked against `contract/examples.json`.
- Browser end-to-end tests (Playwright).
- `golangci-lint`, a Content Security Policy and a coverage badge.
- Authentication, rate limiting, metrics and tracing for a public deployment.
- Duplicate JSON keys: the last value wins (Go `encoding/json` behavior).
- On keyboard layouts with dead keys (ABNT2, US-International), `^` needs a second keystroke; the on-screen key always works.

## How I used AI

I studied the requirements first. I then planned the design with an AI assistant, which listed and ordered the decisions and laid out the trade-offs; I evaluated each one and made the calls. The result is the spec in `docs/SPEC.md`, which I used to build the project with Claude Code, one prompt per step. The method and every Claude Code prompt are in [PROMPTS.md](PROMPTS.md).

<!-- Time spent: planning and implementation, filled in at the end. -->
