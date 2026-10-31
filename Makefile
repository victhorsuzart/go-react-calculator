SHELL := /bin/sh

FUZZTIME ?= 30s

.PHONY: up down dev-backend dev-frontend test cover cover-backend cover-frontend lint smoke fuzz

up:
	docker compose up --build -d

down:
	docker compose down

dev-backend:
	cd backend && go run ./cmd/server

dev-frontend:
	cd frontend && npm ci && npm run dev

test:
	cd backend && go test -race ./...
	cd frontend && npm test

cover: cover-backend cover-frontend

# Go gate: ./internal/... >= 90% (SPEC §9.5); cmd/server is reported, not gated.
cover-backend:
	cd backend && go test -race -coverprofile=coverage.out ./...
	cd backend && go tool cover -func=coverage.out
	cd backend && go tool cover -html=coverage.out -o coverage.html
	@cd backend && grep -v '/cmd/' coverage.out > coverage.internal.out && \
	total=$$(go tool cover -func=coverage.internal.out | grep '^total:'); \
	rm -f coverage.internal.out; \
	set -- $$total; pct=$${3:-}; pct=$${pct%\%}; \
	case "$$pct" in [0-9]*) ;; *) echo "FAIL: could not read Go coverage of ./internal/..."; exit 1 ;; esac; \
	case "$$pct" in *[!0-9.]*) echo "FAIL: could not read Go coverage of ./internal/..."; exit 1 ;; esac; \
	echo "Go coverage of ./internal/...: $$pct% (gate 90%)"; \
	if [ "$${pct%%.*}" -lt 90 ]; then echo "FAIL: Go coverage below 90%"; exit 1; fi

# The frontend gate is Vitest's coverage.thresholds.
cover-frontend:
	cd frontend && npm run test:coverage

lint:
	@cd backend && out=$$(gofmt -l .) && \
	if [ -n "$$out" ]; then echo "gofmt needed:"; echo "$$out"; exit 1; fi
	cd backend && go vet ./...
	cd frontend && npm run lint
	cd frontend && npm run typecheck

# Runs the Docker stack, checks it through nginx and always tears it down (SPEC §9.4).
smoke:
	@set -u; \
	trap 'status=$$?; docker compose down; exit $$status' EXIT; \
	trap 'exit 130' INT; trap 'exit 143' TERM; \
	docker compose up --build -d --wait || exit 1; \
	page=$$(curl -sS --retry 5 --retry-connrefused --retry-delay 1 -o /dev/null \
		-w '%{http_code} %{content_type}' http://localhost:3000/) || exit 1; \
	case "$$page" in \
		"200 text/html"*) echo "ok   GET /: $$page" ;; \
		*) echo "FAIL GET /: expected 200 text/html, got: $$page"; exit 1 ;; \
	esac; \
	add=$$(curl -sS -X POST -H 'Content-Type: application/json' -d '{"a":"1","b":"2"}' \
		http://localhost:3000/api/v1/add) || exit 1; \
	if [ "$$add" = '{"result":"3"}' ]; then echo "ok   POST /api/v1/add: $$add"; \
	else echo "FAIL POST /api/v1/add: expected {\"result\":\"3\"}, got: $$add"; exit 1; fi

# Go fuzzes one target per run.
fuzz:
	cd backend && go test -run='^$$' -fuzz='^FuzzParse$$' -fuzztime=$(FUZZTIME) ./internal/number
	cd backend && go test -run='^$$' -fuzz='^FuzzRoundTrip$$' -fuzztime=$(FUZZTIME) ./internal/number
