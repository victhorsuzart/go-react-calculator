package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/victhorsuzart/go-react-calculator/backend/internal/calc"
)

// Request errors produced by this package. Each one maps to a Problem Details
// response in problemFor.
var (
	errMalformedJSON        = errors.New("malformed JSON")
	errUnsupportedMediaType = errors.New("unsupported media type")
	errNotFound             = errors.New("not found")
	errMethodNotAllowed     = errors.New("method not allowed")
)

// fieldError is one invalid field in a VALIDATION_FAILED response.
type fieldError struct {
	Field   string `json:"field"`
	Issue   string `json:"issue"`
	Message string `json:"message"`
}

// validationErrors lists every invalid field of a request, sorted by field.
type validationErrors []fieldError

func (v validationErrors) Error() string {
	fields := make([]string, len(v))
	for i, e := range v {
		fields[i] = e.Field + ": " + e.Issue
	}
	return "validation failed: " + strings.Join(fields, ", ")
}

// problem is an RFC 9457 Problem Details body (SPEC §3.5).
type problem struct {
	Type   string       `json:"type"`
	Title  string       `json:"title"`
	Status int          `json:"status"`
	Detail string       `json:"detail"`
	Code   string       `json:"code"`
	Errors []fieldError `json:"errors,omitempty"`
}

type result struct {
	Result string `json:"result"`
}

// titles holds the RFC 9110 reason phrases; http.StatusText still returns
// older phrases for 413 and 422.
var titles = map[int]string{
	http.StatusBadRequest:            "Bad Request",
	http.StatusNotFound:              "Not Found",
	http.StatusMethodNotAllowed:      "Method Not Allowed",
	http.StatusRequestEntityTooLarge: "Content Too Large",
	http.StatusUnsupportedMediaType:  "Unsupported Media Type",
	http.StatusUnprocessableEntity:   "Unprocessable Content",
	http.StatusInternalServerError:   "Internal Server Error",
}

func newProblem(status int, code, detail string) problem {
	return problem{Type: "about:blank", Title: titles[status], Status: status, Detail: detail, Code: code}
}

var internalError = newProblem(http.StatusInternalServerError, "INTERNAL_ERROR", "An unexpected error occurred.")

// problemFor maps any error to its Problem Details. It is the only place where
// errors become responses.
func problemFor(err error) problem {
	var validation validationErrors
	var tooLarge *http.MaxBytesError
	switch {
	case errors.Is(err, errMalformedJSON):
		return newProblem(http.StatusBadRequest, "MALFORMED_JSON", "The request body must be a single JSON object.")
	case errors.As(err, &validation):
		p := newProblem(http.StatusBadRequest, "VALIDATION_FAILED", "One or more fields are invalid.")
		p.Errors = validation
		return p
	case errors.Is(err, errNotFound):
		return newProblem(http.StatusNotFound, "NOT_FOUND", "The requested resource does not exist.")
	case errors.Is(err, errMethodNotAllowed):
		return newProblem(http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "The method is not allowed for this resource.")
	case errors.As(err, &tooLarge):
		return newProblem(http.StatusRequestEntityTooLarge, "PAYLOAD_TOO_LARGE",
			fmt.Sprintf("The request body must not exceed %d KiB.", maxBodyKiB))
	case errors.Is(err, errUnsupportedMediaType):
		return newProblem(http.StatusUnsupportedMediaType, "UNSUPPORTED_MEDIA_TYPE", "The Content-Type must be application/json.")
	case errors.Is(err, calc.ErrDivisionByZero):
		return newProblem(http.StatusUnprocessableEntity, "DIVISION_BY_ZERO", "Cannot divide by zero.")
	case errors.Is(err, calc.ErrUndefinedResult):
		return newProblem(http.StatusUnprocessableEntity, "UNDEFINED_RESULT", "The result is not a real number.")
	case errors.Is(err, calc.ErrOutOfRange):
		return newProblem(http.StatusUnprocessableEntity, "RESULT_OUT_OF_RANGE", "The result is out of range.")
	default:
		return internalError
	}
}

// writeError sends the Problem Details for err. The cause of a 500 goes only
// to the log.
func (s *server) writeError(w http.ResponseWriter, r *http.Request, err error) {
	p := problemFor(err)
	if p.Status == http.StatusInternalServerError {
		s.logger.ErrorContext(r.Context(), "internal error", "error", err.Error(), "request_id", requestIDFrom(r.Context()))
	}
	s.writeJSON(w, r, p.Status, "application/problem+json", p)
}

// writeJSON encodes v and writes it with the given status and content type.
func (s *server) writeJSON(w http.ResponseWriter, r *http.Request, status int, contentType string, v any) {
	body, err := json.Marshal(v)
	if err != nil {
		// Only the fixed structs of this package are encoded, so this is a bug.
		s.logger.ErrorContext(r.Context(), "encode response", "error", err.Error(), "request_id", requestIDFrom(r.Context()))
		status, contentType = http.StatusInternalServerError, "application/problem+json"
		body, _ = json.Marshal(internalError)
	}
	w.Header().Set("Content-Type", contentType)
	w.WriteHeader(status)
	_, _ = w.Write(body)
}
