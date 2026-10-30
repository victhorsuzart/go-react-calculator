// Package httpapi exposes the calculator over HTTP (SPEC §3): routes generated
// from calc.Operations, request validation, Problem Details and middleware.
package httpapi

import (
	"fmt"
	"log/slog"
	"net/http"
	"path"

	"github.com/victhorsuzart/go-react-calculator/backend/internal/calc"
)

// server holds what the handlers and middleware share.
type server struct {
	logger *slog.Logger
}

// NewHandler returns the API with its middleware, outermost first:
// request ID → logging → recover → router.
func NewHandler(logger *slog.Logger) http.Handler {
	s := &server{logger: logger}
	return s.wrap(s.routes(calc.Operations))
}

func (s *server) wrap(h http.Handler) http.Handler {
	return withRequestID(s.withLogging(s.withRecover(h)))
}

// routes registers every route. A method-specific pattern takes precedence
// over its method-less pattern, which takes precedence over "/".
func (s *server) routes(ops []calc.Operation) http.Handler {
	mux := http.NewServeMux()
	for _, op := range ops {
		if op.Arity != 1 && op.Arity != 2 {
			panic(fmt.Sprintf("httpapi: operation %q has arity %d, want 1 or 2", op.Name, op.Arity))
		}
		p := "/api/v1/" + op.Name
		mux.Handle("POST "+p, s.operationHandler(op))
		mux.Handle(p, s.methodNotAllowed("POST"))
	}
	mux.Handle("GET /healthz", s.health())
	mux.Handle("/healthz", s.methodNotAllowed("GET"))
	notFound := s.notFound()
	mux.Handle("/", notFound)

	// ServeMux answers unclean paths (//healthz, /api/v1/../v1/add) with its
	// own redirect; no route has such a path, so they are a Problem Details 404.
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if path.Clean(r.URL.Path) != r.URL.Path {
			notFound.ServeHTTP(w, r)
			return
		}
		mux.ServeHTTP(w, r)
	})
}

func (s *server) health() http.Handler {
	type status struct {
		Status string `json:"status"`
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.writeJSON(w, r, http.StatusOK, "application/json", status{Status: "ok"})
	})
}

func (s *server) methodNotAllowed(allow string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Allow", allow)
		s.writeError(w, r, errMethodNotAllowed)
	})
}

func (s *server) notFound() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.writeError(w, r, errNotFound)
	})
}
