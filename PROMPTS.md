# How I used AI

## Part 1 — Planning

I started by studying the assignment's requirements on my own. I then ran a design session with an AI assistant (Claude, in the claude.ai chat). The assistant identified the decisions the project needed, ordered them by dependency and laid out the alternatives and trade-offs of each one. I went through them one at a time, asked for explanations where I needed them, and made every call, sometimes rejecting or changing the suggestion (for example, I dropped an arbitrary-precision decimal library in favor of `float64` rounded to 15 significant digits).

The 22 decisions, with the alternatives and my reasoning, are in [`docs/DECISIONS.md`](docs/DECISIONS.md). The outcome of the session is [`docs/SPEC.md`](docs/SPEC.md), which drove the build. The planning conversation itself is not included.

## Part 2 — Building

The project was built with Claude Code in seven steps, each committed separately (with a separate `Docs:` commit when the SPEC changed). Each step ran the same way:

- The step's main prompt ran first in plan mode. I checked the plan against the SPEC before approving it.
- A second Claude Code session reviewed the result, over several rounds, until it found nothing more. I relayed its findings to the coding session and reviewed the final code myself before committing and pushing.
- When either session found a problem in the SPEC itself, it stopped and described it. I decided the fix in the planning session, updated the SPEC, and only then let the step continue.

Below is the main prompt of each step, verbatim. The follow-up prompts from the review rounds are not included; instead, each step ends with a short note on what the review changed.

### Step 1 — Backend core

```
/plan
We're building the project specified in docs/SPEC.md. The SPEC is the single source of truth: follow it exactly, add nothing it doesn't describe, and if something is ambiguous or looks wrong, raise it in the plan instead of guessing. Don't edit docs/, README.md or anything outside this stage's scope.

This is stage 1 of 7: the backend core. Read §0, §2, §3.3, §4.1, §4.2, §9.1, Appendix A and Appendix B.1.

Scope:
- Create the Go module in backend/. Module path: derive it from the `origin` remote (github.com/<owner>/go-react-calculator/backend). The go directive is the installed stable Go (check with `go version`). No external dependencies.
- internal/number: Parse and Format (§2.2, §2.3).
- internal/calc: the operation table, domain pre-checks, the single rounding function, range checks and sentinel errors (§3.3, §4.2).
- Tests: named table tests covering every example in §2.2 and §2.3 and every row of Appendix B.1; FuzzRoundTrip and FuzzParse with seeds (§9.1).
- Not in this stage: internal/httpapi, cmd/server, contract/, frontend, Makefile, Docker, CI.

Done when:
- `gofmt -l` reports nothing, `go vet ./...` is clean and `go test -race ./...` passes. If `-race` isn't available on this machine (Windows without a C compiler), run without it and tell me; CI runs it on Linux.
- Coverage of ./internal/... is at least 90%; show the number for each package.
- Don't commit or push. I'll review the code first, then commit and push it myself.

In the plan, list the files, the exported API of each package, how each Appendix B.1 row maps to a test, and any ambiguity you found.
```

**Review notes:** the review found three gaps in the SPEC itself: `percentage` could overflow in `a × b` although the result fits; the smallest valid input underflows after rounding, which the SPEC didn't state; and `sqrt(0)` was missing from the exact-zero rule. I fixed them in §2.4, §3.3 and Appendix B.1 (see `DECISIONS.md`, decisions 5 and 7).

### Step 2 — Backend HTTP layer

Before this step, I changed SPEC §3.5 so error titles use the RFC 9110 reason phrases, because Go's `http.StatusText` still returns older ones for `413` and `422`.

```
/plan
We're building the project specified in docs/SPEC.md. The SPEC is the single source of truth: follow it exactly, add nothing it doesn't describe, and if something is ambiguous or looks wrong, raise it in the plan instead of guessing. Don't edit docs/, README.md or anything outside this stage's scope. If you find a problem in the SPEC, don't edit docs/; describe it and stop.

This is stage 2 of 7: the backend HTTP layer. Stage 1 (internal/number and internal/calc) is done. Read §0, §1.3, §3, §4, §9.1, §9.3, Appendix A, Appendix B.1 and Appendix B.2.

Scope:
- internal/httpapi: routes generated from calc.Operations, the generic operation handler, request validation (§3.4), Problem Details (§3.5), the 404 and 405 handlers, GET /healthz (§3.6), and the middleware: request ID, logging, recover and the nosniff header (§4.3).
- cmd/server: configuration from PORT and LOG_LEVEL, the slog JSON logger, the http.Server timeouts, graceful shutdown and the -healthcheck flag (§3.6, §4.3). Keep main thin.
- contract/examples.json at the repository root: about 15 cases from §3.2, Appendix B.1 and Appendix B.2, in the shape given in §9.3. All of them send Content-Type: application/json; cases that need other headers stay in the Go tests only.
- Tests: httptest against the full router for every row of Appendix B.2, the 404 and 405 responses (with Allow), 413, 415, X-Request-ID (generated, client value ignored), nosniff, and recover through a test handler that panics; plus a test that runs every case in contract/examples.json against the router.
- Don't change internal/number or internal/calc unless this stage requires it; if it does, explain why.
- Not in this stage: frontend, Makefile, Docker, CI.

Done when:
- `gofmt -l` reports nothing, `go vet ./...` is clean and `go test -race ./...` passes (without -race if it isn't available on this machine; tell me).
- Coverage of ./internal/... is at least 90%; show the number for each package.
- You've started the server with `go run ./cmd/server`, called GET /healthz and POST /api/v1/add with {"a":"0.1","b":"0.2"} using curl, shown both responses, and stopped the server.
- Don't commit or push. I'll review the code first, then commit and push it myself.

In the plan, list the files, the exported API of httpapi, how routes are registered (including the method-less patterns for 405), the middleware order, how each Appendix B.2 row maps to a test, the cases you'll put in contract/examples.json, and any ambiguity you found.
```

**Review notes:** no SPEC changes came out of the review.

### Step 3 — Frontend scaffold and logic

Before this step, I clarified SPEC §6.1: keys queued during a request are also replayed after a math error, so typing fast gives the same result as typing slowly.

```
/plan
We're building the project specified in docs/SPEC.md. The SPEC is the single source of truth: follow it exactly, add nothing it doesn't describe, and if something is ambiguous or looks wrong, raise it in the plan instead of guessing. Don't edit docs/, README.md, backend/ or anything outside this stage's scope. If you find a problem in the SPEC, don't edit docs/; describe it and stop.

This is stage 3 of 7: the frontend scaffold and its pure logic. The backend is done. Read §0, §1.3, §2.1, §5, §6, §7.1, §7.2, §8, §9.2, Appendix A and Appendices B.3 to B.6.

Scope:
- Scaffold frontend/ with the Vite react-ts template (npm, non-interactive), then remove the template's demo code and assets. App.tsx stays a minimal placeholder until stage 4.
- Tooling from §8.1: Node LTS in .nvmrc and engines (check `node --version`), strict TypeScript with noUncheckedIndexedAccess, ESLint with exhaustive-deps as an error, Prettier, the Vite proxy for /api, and the scripts. Test stack from §9.2 (Vitest, jsdom, Testing Library, user-event) plus a coverage provider. No other dependencies.
- src/calculator/: types.ts (including the CalcError and request types, which api/client.ts will import in stage 4), keys.ts (§5.1, with the grid positions from §7.3), reducer.ts (§5.3 to §5.5 and §6: requests as state, the queue, stale responses, domain and system errors), the upper-line text (§5.3) as a pure function next to the reducer, format.ts (§7.1 thousands separators), keyboard.ts (the §7.2 mapping only, as a pure function of the event's key, modifiers, repeat and isComposing) and messages.ts (§6.2).
- Tests: every row of Appendix B.3 through a harness with an explicit response map (no arithmetic in tests); the reducer side of every Appendix B.4 row (queue, stale response after AC, timeout and network errors restoring the previous state, banner hidden by the next key), dispatching RESOLVED and FAILED directly; Appendix B.5 for format.ts; Appendix B.6 for keyboard.ts.
- Not in this stage: api/client.ts, useCalculator, components, styles, the Dockerfile, the Makefile, CI.

Done when:
- `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` all pass.
- Coverage of src/calculator/ is at least 90%; show the number for each file.
- Don't commit or push. I'll review the code first, then commit and push it myself.

In the plan, list the dependencies you'll add, the files, the State and Action types, how each phase handles each key (a table is fine), how each Appendix B.3 row maps to a test, and any ambiguity you found.
```

**Review notes:** Claude Code stopped to ask instead of working around the SPEC: the Vite template now ships TypeScript 7, which typescript-eslint can't use yet. I pinned TypeScript 6.0 and recorded the exception in SPEC §8.1.

### Step 4 — Frontend client, hook and UI

Before this step, I changed SPEC §6.1 so the request effect depends on the pending request object, which resolves a conflict with the `exhaustive-deps` lint rule.

```
/plan
We're building the project specified in docs/SPEC.md. The SPEC is the single source of truth: follow it exactly, add nothing it doesn't describe, and if something is ambiguous or looks wrong, raise it in the plan instead of guessing. Don't edit docs/, README.md, backend/ or anything outside this stage's scope. If you find a problem in the SPEC, don't edit docs/; describe it and stop.

This is stage 4 of 7: the frontend's API client, hook and UI. The backend and the frontend's pure logic (stage 3) are done. Read §0, §1.3, §2.1, §5.1, §6, §7, §8, §9.2, §9.3, Appendix A and Appendix B.4.

Scope:
- src/api/client.ts: calculate() and the error classification (§6.2), with hand-written type guards. For sqrt, send only a (the API rejects b, §3.4). Import the error and request types from calculator/types.ts.
- src/calculator/useCalculator.ts: useReducer plus the single request effect, the abort and timeout wiring, and the 300 ms loading flag (§6.1).
- Components: Calculator, Display, Keypad and Key with CSS Modules (§7), the window keyboard listener built on keyboard.ts (§7.2), the key flash, and the Enter-on-focused-button rule. App.tsx renders the calculator; index.html gets lang="en" and the title (§7.3).
- Tests:
  - client: every row of the §6.2 table, plus every case in contract/examples.json replayed as a fake response. Load the JSON at runtime with node:fs instead of importing it, so the frontend still builds when contract/ isn't in the Docker build context (§10.1).
  - hook and components: every Appendix B.4 row with a fake fetch (vi.stubGlobal) and fake timers; clicks and keyboard input with user-event (set it up with advanceTimers when fake timers are on); Enter on a focused button; the domain error on the main line and the system-error banner with role="alert"; aria-busy only after 300 ms. If fake timers don't drive AbortSignal.timeout, make the fake fetch reject with a TimeoutError for the timeout row and check the 5 s value separately.
- Not in this stage: Dockerfile, nginx.conf, Makefile, CI, coverage thresholds in the config.

Done when:
- `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` all pass.
- Coverage of src/calculator/ and src/api/ is at least 90%, and at least 80% overall; show the numbers.
- With the backend running (`go run ./cmd/server`) and `npm run dev`, a POST to http://localhost:5173/api/v1/add with {"a":"2","b":"3"} returns {"result":"5"} through the Vite proxy; show the response.
- Don't commit or push. I'll review the code first, then commit and push it myself.

In the plan, list the files, the hook's API, the component tree with each element's role and accessible name, how each Appendix B.4 row and each §6.2 row maps to a test, and any ambiguity you found.
```

**Review notes:** the review caught a focus bug: after using Tab and then the mouse, Enter still pressed the previously focused key instead of `=`. It was fixed, with a test for that exact sequence. Vitest's fake timers don't drive jsdom's `AbortSignal.timeout`, so the timeout test controls that signal directly and still checks the real 5-second boundary.

### Step 5 — Docker, nginx and Makefile

```
/plan
We're building the project specified in docs/SPEC.md. The SPEC is the single source of truth: follow it exactly, add nothing it doesn't describe, and if something is ambiguous or looks wrong, raise it in the plan instead of guessing. Don't edit docs/, README.md or any source code in backend/ or frontend/. If you find a problem in the SPEC, don't edit docs/; describe it and stop.

This is stage 5 of 7: packaging. The backend and the frontend are done. Read §0, §1.3, §1.4, §3.6, §4.3, §9.4, §9.5, §10.1 to §10.3 and §11.

Scope:
- backend/Dockerfile and backend/.dockerignore (§10.1). The Go image tag matches the go directive in backend/go.mod.
- frontend/Dockerfile, frontend/.dockerignore and frontend/nginx.conf (§10.1, §10.2). The Node image tag matches frontend/.nvmrc.
- docker-compose.yml at the repository root (§10.1).
- Makefile at the repository root with the targets in §10.3, including the smoke test (§9.4) and the Go coverage gate (§9.5). Targets use a POSIX shell and only tools the project already uses (go, npm, docker, curl).
- Not in this stage: CI, README changes.

Done when:
- `docker compose up --build -d --wait` brings both services up, with the backend healthy.
- Through http://localhost:3000: the page returns 200 with HTML; POST /api/v1/add with {"a":"1","b":"2"} returns {"result":"3"}; POST /api/v1/divide with {"a":"5","b":"0"} returns the 422 Problem Details from the API, not an nginx page; GET /healthz is not proxied to the API. Show each response.
- `docker compose down` stops everything.
- `make test`, `make lint`, `make cover` and `make smoke` pass. If make isn't installed on this machine, run the commands each target would run, show the results and tell me.
- `docker image ls` shows both images; the backend image runs as non-root and neither final image contains a toolchain.
- Don't commit or push. I'll review the code first, then commit and push it myself.

In the plan, list the files, the base images and tags you'll use, each Makefile target with its commands, the nginx locations, and any ambiguity you found.
```

**Review notes:** only minor fixes and a few renames; no SPEC changes.

### Step 6 — CI and coverage gates

```
/plan
We're building the project specified in docs/SPEC.md. The SPEC is the single source of truth: follow it exactly, add nothing it doesn't describe, and if something is ambiguous or looks wrong, raise it in the plan instead of guessing. Don't edit docs/, README.md, PROMPTS.md or any source code in backend/ or frontend/src/. If you find a problem in the SPEC, don't edit docs/; describe it and stop.

This is stage 6 of 7: CI and coverage gates. The backend, the frontend, Docker and the Makefile are done. Read §0, §4.1, §8.1, §9.5 and §10.4.

Scope:
- Frontend coverage thresholds in the Vitest config (§9.5): src/calculator/** and src/api/** at 90%, and 80% overall. The existing exclusions stay as they are.
- .github/workflows/ci.yml with the backend, frontend and smoke jobs (§10.4). Versions come from backend/go.mod and frontend/.nvmrc; use the current major version of each action (check, don't assume). Coverage summaries go to $GITHUB_STEP_SUMMARY, and the HTML reports are uploaded as artifacts. Reuse the Makefile targets where they fit, so CI and local runs do the same thing.
- Not in this stage: README changes, new tests, source changes.

Done when:
- `npm run test:coverage` passes with the thresholds in place, and fails if you raise one above the current numbers (check once, then restore it).
- The Go coverage gate in the Makefile passes.
- The workflow is valid YAML, and every command it runs has been run locally where possible; show the results and name anything that can only run in GitHub Actions.
- Don't commit or push. I'll review the code first, then commit and push it myself; the first CI run happens on my push.

In the plan, list the files, each job with its steps and action versions, how the coverage summaries are produced, and any ambiguity you found.
```

**Review notes:** only minor fixes and a few renames; no SPEC changes.

### Step 7 — Final review

```
/plan
We're building the project specified in docs/SPEC.md. The SPEC is the single source of truth. Don't edit docs/, PROMPTS.md or any source code. If you find a problem in the SPEC, don't edit docs/; describe it and stop.

This is stage 7 of 7: the final check before delivery. Everything is built, including CI. Read the whole SPEC, with §11 in detail.

Scope:
- Check the repository against the SPEC: walk through each section and list anything that doesn't match, with the file and the SPEC reference. Don't change code in this stage; report only.
- Check that every command and curl example in README.md works as written (run them, with the Docker stack up for the curl examples), and fix README.md wherever it doesn't match what actually happens.
- Run `make cover` and replace the coverage comment in README.md with a table of the real numbers: Go per package for ./internal/..., and the frontend total plus src/api and src/calculator.
- Leave the screenshot and time-spent comments in README.md as they are; I'll fill those in.

Done when:
- The SPEC check is reported as a list, or as "no deviations".
- Every README command and example has been run, and the README matches what they actually do.
- The coverage table holds the numbers from this run.
- Don't commit or push. I'll review the changes first, then commit and push them myself.

In the plan, list what you'll run and in which order.
```
