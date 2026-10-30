package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"maps"
	"net/http"
	"runtime/debug"
	"time"
)

type requestIDKey struct{}

func requestIDFrom(ctx context.Context) string {
	id, _ := ctx.Value(requestIDKey{}).(string)
	return id
}

// withRequestID gives every request a fresh random ID, ignoring any ID the
// client sent, and sets the headers every response carries.
func withRequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		buf := make([]byte, 16)
		_, _ = rand.Read(buf) // crypto/rand.Read never returns an error
		id := hex.EncodeToString(buf)
		w.Header().Set("X-Request-ID", id)
		w.Header().Set("X-Content-Type-Options", "nosniff")
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), requestIDKey{}, id)))
	})
}

// statusRecorder remembers the status code sent through it, and whether the
// response was aborted. The logging middleware creates it; recover reads it to
// know whether headers were sent.
type statusRecorder struct {
	http.ResponseWriter
	status  int
	aborted bool
}

func (s *statusRecorder) WriteHeader(status int) {
	if s.status == 0 {
		s.status = status
	}
	s.ResponseWriter.WriteHeader(status)
}

func (s *statusRecorder) Write(b []byte) (int, error) {
	if s.status == 0 {
		s.status = http.StatusOK
	}
	return s.ResponseWriter.Write(b)
}

// FlushError records the implicit 200 a flush sends, so a flush through
// http.ResponseController counts as headers written.
func (s *statusRecorder) FlushError() error {
	if s.status == 0 {
		s.status = http.StatusOK
	}
	return http.NewResponseController(s.ResponseWriter).Flush()
}

func (s *statusRecorder) Unwrap() http.ResponseWriter { return s.ResponseWriter }

// withLogging writes one log line per request, even when a panic aborts it.
// It never logs bodies. The status is the one sent to the client; an aborted
// request that sent nothing logs status 0.
func (s *server) withLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w}
		defer func() {
			status := rec.status
			if status == 0 && !rec.aborted {
				status = http.StatusOK
			}
			attrs := []any{
				"method", r.Method,
				"path", r.URL.Path,
				"status", status,
				"duration", time.Since(start).String(),
				"request_id", requestIDFrom(r.Context()),
			}
			if rec.aborted {
				attrs = append(attrs, "aborted", true)
			}
			s.logger.InfoContext(r.Context(), "request", attrs...)
		}()
		next.ServeHTTP(rec, r)
	})
}

// withRecover turns a panic into 500 INTERNAL_ERROR. If the handler already
// sent headers, it only logs the panic and aborts the response, so a
// truncated body is never completed as a success. http.ErrAbortHandler is
// passed on untouched.
func (s *server) withRecover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rec, ok := w.(*statusRecorder)
		if !ok {
			rec = &statusRecorder{ResponseWriter: w}
		}
		outer := w.Header().Clone() // headers set by outer middleware
		defer func() {
			v := recover()
			if v == nil {
				return
			}
			if v == http.ErrAbortHandler {
				rec.aborted = true
				panic(v)
			}
			s.logger.ErrorContext(r.Context(), "panic",
				"panic", fmt.Sprint(v),
				"stack", string(debug.Stack()),
				"request_id", requestIDFrom(r.Context()),
			)
			if rec.status != 0 {
				rec.aborted = true
				panic(http.ErrAbortHandler)
			}
			// Drop headers the handler set before panicking (e.g. Allow).
			h := w.Header()
			clear(h)
			maps.Copy(h, outer)
			// The panic is already logged, so write the 500 without logging it again.
			s.writeJSON(rec, r, internalError.Status, "application/problem+json", internalError)
		}()
		next.ServeHTTP(rec, r)
	})
}
