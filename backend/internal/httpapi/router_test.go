package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/victhorsuzart/go-react-calculator/backend/internal/calc"
)

const jsonType = "application/json"

func newTestHandler() http.Handler {
	return NewHandler(slog.New(slog.NewJSONHandler(io.Discard, nil)))
}

// send runs one request against h. An empty contentType sends no header.
func send(h http.Handler, method, path, contentType, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// response holds the union of the success and Problem Details bodies.
type response struct {
	Result string       `json:"result"`
	Type   string       `json:"type"`
	Title  string       `json:"title"`
	Status int          `json:"status"`
	Detail string       `json:"detail"`
	Code   string       `json:"code"`
	Errors []fieldError `json:"errors"`
}

func decode(t *testing.T, rec *httptest.ResponseRecorder) response {
	t.Helper()
	var r response
	if err := json.Unmarshal(rec.Body.Bytes(), &r); err != nil {
		t.Fatalf("body %q is not JSON: %v", rec.Body.String(), err)
	}
	return r
}

// checkResult asserts a 200 response with the given result string.
func checkResult(t *testing.T, rec *httptest.ResponseRecorder, want string) {
	t.Helper()
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body %s", rec.Code, rec.Body)
	}
	if ct := rec.Header().Get("Content-Type"); ct != jsonType {
		t.Errorf("Content-Type = %q, want %q", ct, jsonType)
	}
	if got := decode(t, rec).Result; got != want {
		t.Errorf("result = %q, want %q", got, want)
	}
}

// checkProblem asserts a Problem Details response and returns it.
func checkProblem(t *testing.T, rec *httptest.ResponseRecorder, status int, code string) response {
	t.Helper()
	if rec.Code != status {
		t.Fatalf("status = %d, want %d; body %s", rec.Code, status, rec.Body)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/problem+json" {
		t.Errorf("Content-Type = %q, want application/problem+json", ct)
	}
	p := decode(t, rec)
	if p.Type != "about:blank" || p.Status != status || p.Title != titles[status] || p.Code != code || p.Detail == "" {
		t.Errorf("problem = %+v, want type about:blank, status %d, title %q, code %s and a detail", p, status, titles[status], code)
	}
	return p
}

type issue struct{ field, issue string }

func checkIssues(t *testing.T, p response, want []issue) {
	t.Helper()
	if len(p.Errors) != len(want) {
		t.Fatalf("errors = %+v, want %v", p.Errors, want)
	}
	for i, w := range want {
		e := p.Errors[i]
		if e.Field != w.field || e.Issue != w.issue || e.Message == "" {
			t.Errorf("errors[%d] = %+v, want %s: %s with a message", i, e, w.field, w.issue)
		}
	}
}

type validationCase struct {
	name          string
	method        string // default POST
	path          string
	contentType   string // default application/json
	noContentType bool
	body          string
	status        int
	code          string  // for errors
	issues        []issue // for VALIDATION_FAILED
	result        string  // for 200
	allow         string  // for 405
}

// TestValidation covers every row of SPEC Appendix B.2.
func TestValidation(t *testing.T) {
	tests := []validationCase{
		{name: "text/plain", path: "/api/v1/add", contentType: "text/plain", body: `{"a":"1","b":"2"}`,
			status: 415, code: "UNSUPPORTED_MEDIA_TYPE"},
		{name: "no Content-Type", path: "/api/v1/add", noContentType: true, body: `{"a":"1","b":"2"}`,
			status: 415, code: "UNSUPPORTED_MEDIA_TYPE"},
		{name: "charset parameter", path: "/api/v1/add", contentType: "application/json; charset=utf-8", body: `{"a":"1","b":"2"}`,
			status: 200, result: "3"},
		{name: "body larger than 1 KiB", path: "/api/v1/add", body: `{"a":"1","b":"2"}` + strings.Repeat(" ", 1025-17),
			status: 413, code: "PAYLOAD_TOO_LARGE"},
		{name: "body of exactly 1 KiB", path: "/api/v1/add", body: `{"a":"1","b":"2"}` + strings.Repeat(" ", 1024-17),
			status: 200, result: "3"},
		{name: "empty body", path: "/api/v1/add", body: "",
			status: 400, code: "MALFORMED_JSON"},
		{name: "truncated JSON", path: "/api/v1/add", body: `{"a":`,
			status: 400, code: "MALFORMED_JSON"},
		{name: "array", path: "/api/v1/add", body: `[]`,
			status: 400, code: "MALFORMED_JSON"},
		{name: "data after the object", path: "/api/v1/add", body: `{"a":"1","b":"2"} x`,
			status: 400, code: "MALFORMED_JSON"},
		{name: "b missing", path: "/api/v1/add", body: `{"a":"1"}`,
			status: 400, code: "VALIDATION_FAILED", issues: []issue{{"b", "required"}}},
		{name: "b null", path: "/api/v1/add", body: `{"a":"1","b":null}`,
			status: 400, code: "VALIDATION_FAILED", issues: []issue{{"b", "required"}}},
		{name: "a is a number", path: "/api/v1/add", body: `{"a":2,"b":"3"}`,
			status: 400, code: "VALIDATION_FAILED", issues: []issue{{"a", "must_be_string"}}},
		{name: "a is a number and b missing", path: "/api/v1/add", body: `{"a":2}`,
			status: 400, code: "VALIDATION_FAILED", issues: []issue{{"a", "must_be_string"}, {"b", "required"}}},
		{name: "unknown field c", path: "/api/v1/add", body: `{"a":"1","b":"2","c":"3"}`,
			status: 400, code: "VALIDATION_FAILED", issues: []issue{{"c", "unknown_field"}}},
		{name: "b on a unary operation", path: "/api/v1/sqrt", body: `{"a":"9","b":"1"}`,
			status: 400, code: "VALIDATION_FAILED", issues: []issue{{"b", "unknown_field"}}},
		{name: "negative zero", path: "/api/v1/add", body: `{"a":"-0","b":"5"}`,
			status: 200, result: "5"},
		{name: "GET on an operation", method: http.MethodGet, path: "/api/v1/add",
			status: 405, code: "METHOD_NOT_ALLOWED", allow: "POST"},
		{name: "unknown operation", path: "/api/v1/mod", body: `{"a":"1","b":"2"}`,
			status: 404, code: "NOT_FOUND"},
		{name: "POST on healthz", path: "/healthz",
			status: 405, code: "METHOD_NOT_ALLOWED", allow: "GET"},
	}
	invalid := []string{"abc", "NaN", "Inf", "0x10", "1,5", " 1", "+1", ".5", "1.", "01", "", "1." + strings.Repeat("0", 31)}
	for _, s := range invalid {
		tests = append(tests, validationCase{name: "invalid number " + s, path: "/api/v1/add", body: bodyA(s),
			status: 400, code: "VALIDATION_FAILED", issues: []issue{{"a", "invalid_number"}}})
	}
	for _, s := range []string{"1e400", "1e-400"} {
		tests = append(tests, validationCase{name: "out of range " + s, path: "/api/v1/add", body: bodyA(s),
			status: 400, code: "VALIDATION_FAILED", issues: []issue{{"a", "out_of_range"}}})
	}

	h := newTestHandler()
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			method := tc.method
			if method == "" {
				method = http.MethodPost
			}
			contentType := tc.contentType
			if contentType == "" && !tc.noContentType {
				contentType = jsonType
			}
			rec := send(h, method, tc.path, contentType, tc.body)
			if tc.status == http.StatusOK {
				checkResult(t, rec, tc.result)
				return
			}
			p := checkProblem(t, rec, tc.status, tc.code)
			checkIssues(t, p, tc.issues)
			if got := rec.Header().Get("Allow"); got != tc.allow {
				t.Errorf("Allow = %q, want %q", got, tc.allow)
			}
		})
	}
}

// bodyA returns {"a": a, "b": "1"}.
func bodyA(a string) string {
	body, _ := json.Marshal(map[string]string{"a": a, "b": "1"})
	return string(body)
}

// TestOperationsAPI covers SPEC §3.2 and every row of Appendix B.1 through
// the router.
func TestOperationsAPI(t *testing.T) {
	tests := []struct {
		op, a, b string // b == "" sends {"a"} only
		result   string
		code     string
	}{
		// §3.2
		{"divide", "7", "2", "3.5", ""},
		{"sqrt", "9", "", "3", ""},
		{"percentage", "10", "50", "5", ""},
		{"add", "0.1", "0.2", "0.3", ""},
		// B.1
		{"add", "999999999999999", "1", "1e+15", ""},
		{"add", "1e308", "1e308", "", "RESULT_OUT_OF_RANGE"},
		{"add", "1.7976931348623157e308", "0", "", "RESULT_OUT_OF_RANGE"},
		{"add", "2.2250738585072014e-308", "0", "", "RESULT_OUT_OF_RANGE"},
		{"subtract", "0.3", "0.1", "0.2", ""},
		{"subtract", "5", "5", "0", ""},
		{"multiply", "1.5", "2", "3", ""},
		{"multiply", "-1", "0", "0", ""},
		{"multiply", "123456789", "987654321", "1.21932631112635e+17", ""},
		{"multiply", "1e200", "1e200", "", "RESULT_OUT_OF_RANGE"},
		{"multiply", "1e-200", "1e-200", "", "RESULT_OUT_OF_RANGE"},
		{"divide", "2", "3", "0.666666666666667", ""},
		{"divide", "0.000001", "10", "1e-7", ""},
		{"divide", "5", "0", "", "DIVISION_BY_ZERO"},
		{"divide", "0", "0", "", "DIVISION_BY_ZERO"},
		{"divide", "0", "5", "0", ""},
		{"divide", "-0", "5", "0", ""},
		{"power", "0", "0", "1", ""},
		{"power", "0", "-1", "", "DIVISION_BY_ZERO"},
		{"power", "-8", "0.5", "", "UNDEFINED_RESULT"},
		{"power", "-2", "3", "-8", ""},
		{"power", "2", "-1", "0.5", ""},
		{"power", "10", "309", "", "RESULT_OUT_OF_RANGE"},
		{"power", "10", "-400", "", "RESULT_OUT_OF_RANGE"},
		{"sqrt", "2", "", "1.4142135623731", ""},
		{"sqrt", "0", "", "0", ""},
		{"sqrt", "-0", "", "0", ""},
		{"sqrt", "-4", "", "", "UNDEFINED_RESULT"},
		{"percentage", "50", "1", "0.5", ""},
		{"percentage", "0", "50", "0", ""},
		{"percentage", "1e308", "10", "1e+307", ""},
		{"percentage", "1e308", "1e10", "", "RESULT_OUT_OF_RANGE"},
	}
	h := newTestHandler()
	for _, tc := range tests {
		t.Run(tc.op+"/"+tc.a+"_"+tc.b, func(t *testing.T) {
			fields := map[string]string{"a": tc.a}
			if tc.b != "" {
				fields["b"] = tc.b
			}
			body, _ := json.Marshal(fields)
			rec := send(h, http.MethodPost, "/api/v1/"+tc.op, jsonType, string(body))
			if tc.code != "" {
				checkProblem(t, rec, http.StatusUnprocessableEntity, tc.code)
				return
			}
			checkResult(t, rec, tc.result)
		})
	}
}

func TestHealthz(t *testing.T) {
	rec := send(newTestHandler(), http.MethodGet, "/healthz", "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != jsonType {
		t.Errorf("Content-Type = %q, want %q", ct, jsonType)
	}
	if got := rec.Body.String(); got != `{"status":"ok"}` {
		t.Errorf("body = %s, want {\"status\":\"ok\"}", got)
	}
}

// An unexpected error becomes a generic 500; the cause goes only to the log.
func TestUnexpectedError(t *testing.T) {
	var buf bytes.Buffer
	s := &server{logger: slog.New(slog.NewJSONHandler(&buf, nil))}
	rec := httptest.NewRecorder()
	s.writeError(rec, httptest.NewRequest(http.MethodGet, "/", nil), errors.New("database exploded"))

	p := checkProblem(t, rec, http.StatusInternalServerError, "INTERNAL_ERROR")
	if strings.Contains(p.Detail, "database") {
		t.Errorf("detail %q exposes the cause", p.Detail)
	}
	if !strings.Contains(buf.String(), "database exploded") {
		t.Errorf("log %q does not contain the cause", buf.String())
	}
}

// Edge cases outside Appendix B.2.
func TestRequestEdges(t *testing.T) {
	h := newTestHandler()

	t.Run("media type is case-insensitive", func(t *testing.T) {
		checkResult(t, send(h, http.MethodPost, "/api/v1/add", "APPLICATION/JSON", `{"a":"1","b":"2"}`), "3")
	})
	t.Run("malformed Content-Type", func(t *testing.T) {
		checkProblem(t, send(h, http.MethodPost, "/api/v1/add", "application/json;;", `{"a":"1","b":"2"}`),
			http.StatusUnsupportedMediaType, "UNSUPPORTED_MEDIA_TYPE")
	})
	t.Run("null body", func(t *testing.T) {
		checkProblem(t, send(h, http.MethodPost, "/api/v1/add", jsonType, `null`), http.StatusBadRequest, "MALFORMED_JSON")
	})
	t.Run("HEAD healthz", func(t *testing.T) {
		if rec := send(h, http.MethodHead, "/healthz", "", ""); rec.Code != http.StatusOK {
			t.Errorf("status = %d, want 200", rec.Code)
		}
	})

	for _, tc := range []struct{ method, path string }{
		{http.MethodGet, "//healthz"},
		{http.MethodGet, "/api/v1//add"},
		{http.MethodPost, "/api/v1/../v1/add"},
		{http.MethodPost, "/api/v1/add/"},
	} {
		t.Run("unclean path "+tc.method+" "+tc.path, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, "/", strings.NewReader(`{"a":"1","b":"2"}`))
			req.URL.Path = tc.path
			req.Header.Set("Content-Type", jsonType)
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			checkProblem(t, rec, http.StatusNotFound, "NOT_FOUND")
		})
	}
}

type failingReader struct{}

func (failingReader) Read([]byte) (int, error) { return 0, errors.New("connection reset") }

func TestBodyReadError(t *testing.T) {
	var buf bytes.Buffer
	h := NewHandler(slog.New(slog.NewJSONHandler(&buf, nil)))
	req := httptest.NewRequest(http.MethodPost, "/api/v1/add", failingReader{})
	req.Header.Set("Content-Type", jsonType)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	p := checkProblem(t, rec, http.StatusBadRequest, "MALFORMED_JSON")
	if strings.Contains(p.Detail, "reset") {
		t.Errorf("detail %q exposes the cause", p.Detail)
	}
	if !strings.Contains(buf.String(), "connection reset") {
		t.Errorf("log %q does not contain the cause", buf.String())
	}
}

func TestEncodeFailure(t *testing.T) {
	var buf bytes.Buffer
	s := &server{logger: slog.New(slog.NewJSONHandler(&buf, nil))}
	rec := httptest.NewRecorder()
	s.writeJSON(rec, httptest.NewRequest(http.MethodGet, "/", nil), http.StatusOK, jsonType, make(chan int))

	checkProblem(t, rec, http.StatusInternalServerError, "INTERNAL_ERROR")
	if !strings.Contains(buf.String(), "encode response") {
		t.Errorf("log %q does not record the failure", buf.String())
	}
}

func TestValidationErrorsMessage(t *testing.T) {
	err := validationErrors{{Field: "a", Issue: "must_be_string"}, {Field: "b", Issue: "required"}}
	if got, want := err.Error(), "validation failed: a: must_be_string, b: required"; got != want {
		t.Errorf("Error() = %q, want %q", got, want)
	}
}

func TestInvalidArityPanics(t *testing.T) {
	s := &server{logger: slog.New(slog.NewJSONHandler(io.Discard, nil))}
	defer func() {
		if recover() == nil {
			t.Error("routes accepted an operation with arity 3")
		}
	}()
	s.routes([]calc.Operation{{Name: "bad", Arity: 3}})
}

// A rejected oversized body closes the connection instead of being drained.
func TestTooLargeClosesConnection(t *testing.T) {
	srv := httptest.NewServer(newTestHandler())
	defer srv.Close()
	body := `{"a":"` + strings.Repeat("1", 4096) + `","b":"1"}`
	resp, err := srv.Client().Post(srv.URL+"/api/v1/add", jsonType, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Errorf("status = %d, want 413", resp.StatusCode)
	}
	if !resp.Close {
		t.Error("connection kept open after a too-large body, want Connection: close")
	}
}
