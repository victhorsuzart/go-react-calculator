package httpapi

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// logLines decodes every JSON log line written to buf.
func logLines(t *testing.T, buf *bytes.Buffer) []map[string]any {
	t.Helper()
	var lines []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(buf.String()), "\n") {
		if line == "" {
			continue
		}
		var m map[string]any
		if err := json.Unmarshal([]byte(line), &m); err != nil {
			t.Fatalf("log line %q is not JSON: %v", line, err)
		}
		lines = append(lines, m)
	}
	return lines
}

func TestRequestID(t *testing.T) {
	h := newTestHandler()

	t.Run("generated", func(t *testing.T) {
		first := send(h, http.MethodGet, "/healthz", "", "").Header().Get("X-Request-ID")
		second := send(h, http.MethodGet, "/healthz", "", "").Header().Get("X-Request-ID")
		for _, id := range []string{first, second} {
			if b, err := hex.DecodeString(id); err != nil || len(b) != 16 {
				t.Errorf("X-Request-ID = %q, want 32 hex characters", id)
			}
		}
		if first == second {
			t.Errorf("two requests got the same X-Request-ID %q", first)
		}
	})

	t.Run("client value ignored", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
		req.Header.Set("X-Request-ID", "abc")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if got := rec.Header().Get("X-Request-ID"); got == "abc" || len(got) != 32 {
			t.Errorf("X-Request-ID = %q, want a new 32-character ID", got)
		}
	})
}

func TestNosniff(t *testing.T) {
	h := newTestHandler()
	tests := []struct {
		name, method, path, body string
	}{
		{"200", http.MethodPost, "/api/v1/add", `{"a":"1","b":"2"}`},
		{"400", http.MethodPost, "/api/v1/add", `[]`},
		{"404", http.MethodPost, "/nope", ``},
		{"405", http.MethodGet, "/api/v1/add", ``},
		{"422", http.MethodPost, "/api/v1/divide", `{"a":"1","b":"0"}`},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			rec := send(h, tc.method, tc.path, jsonType, tc.body)
			if got := rec.Header().Get("X-Content-Type-Options"); got != "nosniff" {
				t.Errorf("X-Content-Type-Options = %q, want nosniff", got)
			}
		})
	}
}

func TestRequestLog(t *testing.T) {
	var buf bytes.Buffer
	h := NewHandler(slog.New(slog.NewJSONHandler(&buf, nil)))
	rec := send(h, http.MethodPost, "/api/v1/divide", jsonType, `{"a":"1","b":"0"}`)

	lines := logLines(t, &buf)
	if len(lines) != 1 {
		t.Fatalf("got %d log lines, want 1: %s", len(lines), buf.String())
	}
	line := lines[0]
	want := map[string]any{
		"msg":        "request",
		"method":     "POST",
		"path":       "/api/v1/divide",
		"status":     float64(422),
		"request_id": rec.Header().Get("X-Request-ID"),
	}
	for k, v := range want {
		if line[k] != v {
			t.Errorf("log %s = %v, want %v", k, line[k], v)
		}
	}
	if _, ok := line["duration"]; !ok {
		t.Error("log line has no duration")
	}
	if strings.Contains(buf.String(), `"b":"0"`) {
		t.Error("log contains the request body")
	}
}

func TestRecover(t *testing.T) {
	t.Run("before headers", func(t *testing.T) {
		var buf bytes.Buffer
		s := &server{logger: slog.New(slog.NewJSONHandler(&buf, nil))}
		h := s.wrap(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
			panic("boom")
		}))

		rec := send(h, http.MethodGet, "/", "", "")
		p := checkProblem(t, rec, http.StatusInternalServerError, "INTERNAL_ERROR")
		if strings.Contains(p.Detail, "boom") {
			t.Errorf("detail %q exposes the panic", p.Detail)
		}
		if got := rec.Header().Get("X-Content-Type-Options"); got != "nosniff" {
			t.Errorf("X-Content-Type-Options = %q, want nosniff", got)
		}

		lines := logLines(t, &buf)
		if len(lines) != 2 {
			t.Fatalf("got %d log lines, want panic + request: %s", len(lines), buf.String())
		}
		if lines[0]["msg"] != "panic" || lines[0]["panic"] != "boom" || !strings.Contains(lines[0]["stack"].(string), "goroutine") {
			t.Errorf("panic log = %v, want the panic value and a stack trace", lines[0])
		}
		if lines[1]["msg"] != "request" || lines[1]["status"] != float64(500) {
			t.Errorf("request log = %v, want status 500", lines[1])
		}
	})

	t.Run("drops headers set before the panic", func(t *testing.T) {
		s := &server{logger: slog.New(slog.NewJSONHandler(io.Discard, nil))}
		h := s.wrap(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Allow", "POST")
			panic("boom")
		}))
		rec := send(h, http.MethodGet, "/", "", "")
		checkProblem(t, rec, http.StatusInternalServerError, "INTERNAL_ERROR")
		if got := rec.Header().Get("Allow"); got != "" {
			t.Errorf("Allow = %q, want it dropped", got)
		}
		if rec.Header().Get("X-Request-ID") == "" {
			t.Error("X-Request-ID was dropped")
		}
	})

	t.Run("after headers aborts the response", func(t *testing.T) {
		var buf bytes.Buffer
		s := &server{logger: slog.New(slog.NewJSONHandler(&buf, nil))}
		srv := httptest.NewServer(s.wrap(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", jsonType)
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"result":`))
			_ = http.NewResponseController(w).Flush()
			panic("late")
		})))
		defer srv.Close()

		resp, err := srv.Client().Get(srv.URL)
		if err == nil {
			_, err = io.ReadAll(resp.Body)
			resp.Body.Close()
		}
		if err == nil {
			t.Error("the truncated response completed without an error")
		}
		srv.Close() // wait for the handler, and its log lines, to finish
		lines := logLines(t, &buf)
		if len(lines) != 2 || lines[0]["panic"] != "late" || lines[1]["status"] != float64(200) || lines[1]["aborted"] != true {
			t.Errorf("log = %v, want the panic and an aborted request line with status 200", lines)
		}
	})

	t.Run("after a flush without WriteHeader", func(t *testing.T) {
		var buf bytes.Buffer
		s := &server{logger: slog.New(slog.NewJSONHandler(&buf, nil))}
		srv := httptest.NewServer(s.wrap(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_ = http.NewResponseController(w).Flush()
			panic("after flush")
		})))
		defer srv.Close()

		resp, err := srv.Client().Get(srv.URL)
		if err == nil {
			body, readErr := io.ReadAll(resp.Body)
			resp.Body.Close()
			if strings.Contains(string(body), "INTERNAL_ERROR") {
				t.Errorf("a 500 body was appended to the flushed %d: %q", resp.StatusCode, body)
			}
			err = readErr
		}
		if err == nil {
			t.Error("the flushed response completed without an error")
		}
		srv.Close()
		lines := logLines(t, &buf)
		if len(lines) != 2 || lines[1]["status"] != float64(200) || lines[1]["aborted"] != true {
			t.Errorf("log = %v, want an aborted request line with status 200", lines)
		}
	})

	t.Run("ErrAbortHandler passes through", func(t *testing.T) {
		var buf bytes.Buffer
		s := &server{logger: slog.New(slog.NewJSONHandler(&buf, nil))}
		h := s.wrap(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
			panic(http.ErrAbortHandler)
		}))
		defer func() {
			if v := recover(); v != http.ErrAbortHandler {
				t.Errorf("recovered %v, want http.ErrAbortHandler", v)
			}
			lines := logLines(t, &buf)
			if len(lines) != 1 || lines[0]["msg"] != "request" || lines[0]["status"] != float64(0) || lines[0]["aborted"] != true {
				t.Errorf("log = %v, want only an aborted request line with status 0", lines)
			}
		}()
		send(h, http.MethodGet, "/", "", "")
	})
}

func TestStatusDefaults(t *testing.T) {
	tests := []struct {
		name    string
		handler http.HandlerFunc
	}{
		{"write without WriteHeader", func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("x")) }},
		{"nothing written", func(http.ResponseWriter, *http.Request) {}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var buf bytes.Buffer
			s := &server{logger: slog.New(slog.NewJSONHandler(&buf, nil))}
			send(s.wrap(tc.handler), http.MethodGet, "/", "", "")
			lines := logLines(t, &buf)
			if len(lines) != 1 || lines[0]["status"] != float64(200) {
				t.Errorf("log = %v, want status 200", lines)
			}
		})
	}
}
