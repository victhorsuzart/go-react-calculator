package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"os"
	"reflect"
	"testing"
)

// contractFile is shared with the frontend client tests (SPEC §9.3).
const contractFile = "../../../contract/examples.json"

type contractCase struct {
	Name     string          `json:"name"`
	Method   string          `json:"method"`
	Path     string          `json:"path"`
	Body     json.RawMessage `json:"body"`
	Status   int             `json:"status"`
	Response json.RawMessage `json:"response"`
}

func TestContractExamples(t *testing.T) {
	data, err := os.ReadFile(contractFile)
	if err != nil {
		t.Fatalf("read %s: %v", contractFile, err)
	}
	var cases []contractCase
	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatalf("parse %s: %v", contractFile, err)
	}
	if len(cases) == 0 {
		t.Fatalf("%s has no cases", contractFile)
	}

	h := newTestHandler()
	for _, tc := range cases {
		t.Run(tc.Name, func(t *testing.T) {
			var body []byte
			if string(tc.Body) != "null" {
				body = tc.Body
			}
			req := httptest.NewRequest(tc.Method, tc.Path, bytes.NewReader(body))
			req.Header.Set("Content-Type", jsonType)
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)

			if rec.Code != tc.Status {
				t.Errorf("status = %d, want %d", rec.Code, tc.Status)
			}
			wantType := "application/problem+json"
			if tc.Status == 200 {
				wantType = jsonType
			}
			if got := rec.Header().Get("Content-Type"); got != wantType {
				t.Errorf("Content-Type = %q, want %q", got, wantType)
			}
			var got, want any
			if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
				t.Fatalf("response %q is not JSON: %v", rec.Body, err)
			}
			if err := json.Unmarshal(tc.Response, &want); err != nil {
				t.Fatalf("expected response is not JSON: %v", err)
			}
			if !reflect.DeepEqual(got, want) {
				t.Errorf("response = %s, want %s", rec.Body, tc.Response)
			}
		})
	}
}
