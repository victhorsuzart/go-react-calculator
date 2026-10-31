# Design decisions

These are the 22 decisions behind [`SPEC.md`](SPEC.md), in the order I made them. For each one: the question, the alternatives I considered, what I decided and why. How the planning was done is described in [`PROMPTS.md`](../PROMPTS.md).

## 1. Keys and operations
- **Question:** Which operations and keys should the calculator have?
- **Alternatives considered:** only the four required operations; adding power, square root and percentage; memory keys, history and parentheses; `CE` or an `AC`/`C` toggle.
- **Decision:** 22 keys: digits, decimal point, `+ − × ÷`, `xʸ`, `√`, `%`, `±`, `⌫`, `AC`, `=`.
- **My reasoning:** The optional operations carry the interesting edge cases (√ of a negative number, overflow in power, what `%` means) at almost no extra cost, since they share the endpoint structure. `⌫`, `±` and `AC` are what people expect from a calculator. `AC` plus `⌫` covers what `CE` does with a simpler model; memory and history would add scope without showing anything new.

## 2. Interaction model
- **Question:** What should `2 + 3 × 4 =` give?
- **Alternatives considered:** immediate execution (`20`, like a pocket calculator or Windows); precedence without parentheses (`14`, like the iPhone); a full expression with a parser.
- **Decision:** Immediate execution. Each operator computes the partial result, which is shown, and a second line shows the pending operation.
- **My reasoning:** It matches the requested contract: each step is one operation and one API call, and the frontend holds no math. Precedence would turn one `=` into several dependent calls with the evaluation order in the client; an expression editor is a different product. Someone used to the iPhone might expect `14`, so the partial result and the upper line make the model visible, and the README explains it. Adding precedence later would mean an `/evaluate` endpoint with a parser in the API.

## 3. Square root and percent
- **Question:** What do `√` and `%` act on, and what does `%` mean?
- **Alternatives considered:** `%` always as `x / 100`; `%` as a binary operator (which clashes with modulo); a contextual `%` like iOS and Windows; `√` applied to the pending result.
- **Decision:** One rule: `√` and `%` act on the number on the display, and a pending operator stays pending. `%` is contextual: after `+` or `−`, `b%` means "b% of the first number"; otherwise it is `x / 100`. The API has a single `percentage` operation (a% of b), and the frontend picks the base.
- **My reasoning:** It is what iOS and Windows do, so tips, taxes and discounts work as people expect, and one rule covers every case. `%` is never modulo.

## 4. Number type in the API
- **Question:** `float64` or a decimal type?
- **Alternatives considered:** `cockroachdb/apd`, `shopspring/decimal`, `math/big`, `float64`.
- **Decision:** `float64`, rounded to 15 significant digits in one place. `Inf` and `NaN` become errors, and `-0` becomes `0`.
- **My reasoning:** `apd` was the first suggestion and I dropped it as overkill: it is niche, its API is verbose, and a reviewer is unlikely to know it. `shopspring/decimal` is weak on square roots and fractional powers; `big.Float` is binary and `big.Rat` has no square root. `float64` rounded to 15 digits already shows `0.1 + 0.2 = 0.3`. A decimal type matters for a ledger, not for a 15-digit display.

## 5. Numbers on the wire
- **Question:** JSON numbers or strings? How many digits? What about results that are too large or too small?
- **Alternatives considered:** JSON numbers; decimal strings; returning `0` on underflow.
- **Decision:** Decimal strings in both directions, using the JSON number grammar (at most 32 characters). Typed input is limited to 15 digits. Results use one canonical format (15 significant digits; plain notation between `1e-6` and `1e15`, scientific outside). Overflow and underflow are errors.
- **My reasoning:** With strings, the API defines the canonical text and the browser shows it as is, never converting through a JavaScript double, whose formatting differs from Go's. The contract doesn't expose the internal type, so a decimal type could replace `float64` without breaking clients; payment APIs use strings for amounts for the same reason. Returning `0` on underflow would be a surprising result.
- **Revised after code review:** the smallest valid input, `2.2250738585072014e-308`, rounds to a subnormal value, so even `x + 0` is out of range. That already followed the rules and mirrors the top of the range, where `1.7976931348623157e308 + 0` overflows after rounding, but the SPEC didn't say so. I kept the behavior and documented it, rather than narrowing the valid inputs.

## 6. Endpoint shape
- **Question:** Which method, routes, body and response?
- **Alternatives considered:** `GET` with a query string; a single `/calculate` endpoint with an `op` field; per-operation field names (`dividend`, `divisor`); an `operands` array.
- **Decision:** `POST /api/v1/{add|subtract|multiply|divide|power|sqrt|percentage}`, body `{"a", "b"}`, response `{"result"}`.
- **My reasoning:** In a query string `+` becomes a space, so `1e+15` would arrive broken; a JSON body also allows `Content-Type` checks and rejecting unknown fields. The assignment asks for an endpoint per operation, and generic `a` / `b` fields keep the contract regular.

## 7. Edge cases per operation
- **Question:** What happens with `0 ÷ 0`, `0 ^ −1`, `√−4`, overflow and underflow?
- **Alternatives considered:** relying on the special cases of `math.Pow`; a separate code for `0 ÷ 0`; returning `0` on underflow.
- **Decision:** Domain checks run first, then the computation, then a range check on the rounded value. Three codes: `DIVISION_BY_ZERO`, `UNDEFINED_RESULT`, `RESULT_OUT_OF_RANGE`. `0 ^ 0` is `1`.
- **My reasoning:** Without the checks first, `0 ^ −1` returns `+Inf` and would be reported as overflow when the cause is a division by zero. Checking the range after rounding keeps every result a valid input. I chose a single code for `x ÷ 0` and `0 ÷ 0` (Windows distinguishes them).
- **Revised after code review:** two gaps in the SPEC. First, `percentage` computed `a × b / 100` strictly in that order, so `a × b` could overflow although the result fits: `percentage(1e308, 10)` failed instead of returning `1e+307`. It now falls back to `(a / 100) × b` only when `a × b` overflows, so no other result changes. Second, the underflow rule didn't list `sqrt` among the operations where a zero operand gives an exact zero, so `sqrt(0)` read as an underflow.

## 8. Input validation
- **Question:** How strict should the API be, and how are problems reported?
- **Alternatives considered:** decoding into a struct with `float64` fields; stopping at the first error.
- **Decision:** A fixed order of checks (route, `Content-Type`, 1 KiB size limit, a single JSON object, fields, domain). All field errors are reported at once. The body is decoded into `map[string]json.RawMessage`.
- **My reasoning:** `float64` fields can't tell a missing value from zero, and they accept numbers. Reporting every field error at once is friendlier, and the fixed order gives each failure one clear status. With duplicate keys the last value wins; that is documented as a limitation.

## 9. Error contract
- **Question:** What does an error response look like?
- **Alternatives considered:** a custom `{"error": ...}` envelope; `400` for everything.
- **Decision:** RFC 9457 Problem Details, with a stable `code` and a list of field errors. `400` for bad input, `422` for valid input with no real-number result. `404` and `405` are also JSON.
- **My reasoning:** It is the standard instead of a reinvented envelope, and the frontend relies on the `code`, never on the human-readable text. `400` versus `422` separates "your request is wrong" from "the math doesn't allow it".
- **Refined before step 2:** the `title` uses the RFC 9110 reason phrases from a small table (`Content Too Large`, `Unprocessable Content`), because Go's `http.StatusText` still returns the older phrases for `413` and `422`.

## 10. Backend structure
- **Question:** Which router, and how are packages organized?
- **Alternatives considered:** chi, gin or echo; a `switch` or one type per operation.
- **Decision:** Standard library only (Go 1.22+ `ServeMux`); packages `calc`, `number` and `httpapi`; an operation table and one generic handler.
- **My reasoning:** For seven static routes, the standard router now covers what chi used to. The main gain of gin or echo is binding and validation, which my own validation and error format would bypass. With the table, adding an operation is one entry plus its tests; a slice keeps the order deterministic.

## 11. Operational concerns
- **Question:** CORS, timeouts, shutdown, health check, logging, API documentation?
- **Alternatives considered:** CORS allowing every origin; an OpenAPI document.
- **Decision:** Same origin through a proxy (no CORS), server timeouts, graceful shutdown, `/healthz`, JSON logs with `slog` and a request ID, panics returned as a JSON `500`, configuration through two environment variables. No OpenAPI for now.
- **My reasoning:** The proxy removes the CORS question entirely. An OpenAPI document would be a third copy of the contract, next to the spec and the README, and could drift; it is listed as a next step.

## 12. State machine
- **Question:** How does the UI model the input?
- **Alternatives considered:** a single "waiting for operand" flag; keeping numbers as JavaScript numbers.
- **Decision:** Phases `first`, `awaiting`, `second`, `result` and `error`; the entry is text, marked as typed or computed; the last operation is kept for a repeated `=`.
- **My reasoning:** Separating `awaiting` from `second` is what makes `9 + √ =` work. I confirmed each behavior: `5 + =` gives `10`; `=` again repeats the last operation; `⌫` doesn't edit a computed value; `±` right after an operator starts a negative number; `√` or `%` on a result starts a new calculation.

## 13. Requests from the UI
- **Question:** Who calls the API, and what happens to keys pressed during a request?
- **Alternatives considered:** the hook intercepting keys and calling the API; disabling the keypad while waiting; parallel requests.
- **Decision:** The reducer records the request as state and one effect performs it. Keys pressed meanwhile are queued, request ids discard stale responses, the timeout is 5 s, and a loading indicator appears after 300 ms.
- **My reasoning:** The reducer stays pure and testable without mocks. Disabling the keypad would drop keys from fast typists, and parallel requests could answer out of order.
- **Refined before steps 3 and 4:** queued keys are also replayed after a math error, so typing `5 ÷ 0 = 7` quickly gives the same `7` as typing it slowly; only a connection error discards the queue. The request effect depends on the pending request object, which stays the same while the request runs, so it satisfies the `exhaustive-deps` lint rule and still runs once per request.

## 14. Errors in the UI
- **Question:** Where do errors appear, and how does the user recover?
- **Alternatives considered:** the same treatment for every error.
- **Decision:** Math errors replace the number on the display. Connection errors show a banner and restore the state from before the key, so pressing `=` again retries. Messages are mapped from the error code, in English.
- **My reasoning:** A division by zero is an answer the user should see, as on any calculator. A network failure is not the user's fault and shouldn't erase their input.

## 15. Display
- **Question:** What does the display show, and how are numbers formatted?
- **Alternatives considered:** formatting with the browser locale; measuring the DOM to fit the text; converting scientific notation.
- **Decision:** Two lines; fixed en-US thousands separators, applied by a text function at render time; the font size steps down by character count; scientific notation is shown as returned.
- **My reasoning:** The browser locale (pt-BR swaps `,` and `.`) would conflict with the decimal key and with the API. A text function keeps typed zeros and a trailing decimal point intact. Steps by length are deterministic and easy to test.

## 16. Physical keyboard
- **Question:** Which keys are supported, and how are they handled?
- **Alternatives considered:** `keyCode` or `event.code`; a listener on the component.
- **Decision:** Mapping by `event.key` (`r` for √, `n` for ±, `,` also as the decimal point, `Escape` or `Delete` for `AC`); one listener on `window`; Enter on a focused button handled explicitly; modifiers ignored except Shift; key repeat only for digits and Backspace.
- **My reasoning:** `event.key` respects the keyboard layout, while `event.code` is the physical position. The comma covers the decimal key on Brazilian (ABNT2) numeric keypads. The Enter rule avoids the classic double trigger when a button has focus.

## 17. Layout, styling and accessibility
- **Question:** Layout, CSS approach and accessibility level?
- **Alternatives considered:** Tailwind, CSS-in-JS, icon libraries.
- **Decision:** A 4 × 6 grid; `keys.ts` as the single source for keys; CSS Modules with custom properties; light and dark themes from the system preference; real buttons with accessible names, a live region for the result, and AA contrast.
- **My reasoning:** No extra dependencies. A single source for labels, shortcuts and accessible names means they never diverge.

## 18. Frontend stack
- **Question:** Which build tool and libraries?
- **Alternatives considered:** Create React App, Next.js, axios, zod, Redux, XState.
- **Decision:** Vite with the `react-ts` template, strict TypeScript, ESLint with `exhaustive-deps` as an error, native `fetch`, hand-written type guards, relative API URLs.
- **My reasoning:** The requirements ask for React and TypeScript and don't restrict the build tool; I checked that before choosing. Vite is a build tool, not a framework, so the code stays plain React. Create React App was deprecated in 2025, and two response shapes don't justify zod.
- **Revised during step 3:** the Vite template now ships TypeScript 7, but typescript-eslint doesn't support it yet: TypeScript 7.0 has no compiler API, and support is expected with 7.1. I pinned TypeScript to the latest 6.0 instead of running two compilers side by side or dropping typescript-eslint. Moving to TypeScript 7 is listed as a next step.

## 19. Testing
- **Question:** What is tested, and how?
- **Alternatives considered:** MSW; mocking the API module; Playwright.
- **Decision:** Table tests and fuzzing in Go; reducer tables with an explicit map of API responses, so tests never do arithmetic; a fake `fetch`; contract examples shared by both layers; a Docker smoke test; coverage gates.
- **My reasoning:** The shared examples catch contract drift between the layers. Browser end-to-end tests with Playwright are a next step: browsers in CI cost time and stability that this scope doesn't need.

## 20. Docker
- **Question:** How is the project packaged and run?
- **Alternatives considered:** single-stage images; publishing both ports; no Makefile.
- **Decision:** Multi-stage images (distroless for Go, unprivileged nginx for the frontend); nginx proxies `/api`; only port 3000 is published; the health check is built into the binary; a Makefile at the root.
- **My reasoning:** Small images, no root user, one origin. I kept the Makefile even though I work on Windows, because it is what a reviewer of a Go project expects; the README also lists the raw commands.

## 21. CI and coverage
- **Question:** Where do the checks run, and where is coverage visible?
- **Alternatives considered:** Codecov; committing HTML reports; golangci-lint.
- **Decision:** GitHub Actions with backend, frontend and smoke-test jobs. Coverage appears in the README, in the run summary and as artifacts. Gates: 90% on the logic modules and 80% overall in each layer.
- **My reasoning:** No external service is needed. If a gate fails, tests get added; thresholds are never lowered.

## 22. Repository and documentation
- **Question:** What goes into the repository, and how is the use of AI documented?
- **Alternatives considered:** one decision record file per decision; including the planning transcript; a `CLAUDE.md`.
- **Decision:** `SPEC.md` (what to build), this file (why) and the README (summary). Each step is built in one Claude Code session and reviewed in another. `PROMPTS.md` describes the planning method and gives the main prompt of each step verbatim, with a summary of what each review changed. No `CLAUDE.md`. I review, commit and push each step myself.
- **My reasoning:** Three documents with distinct roles avoid duplication. A `CLAUDE.md` would be a source of instructions outside `PROMPTS.md`.
