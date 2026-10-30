package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"slices"
	"strings"

	"github.com/victhorsuzart/go-react-calculator/backend/internal/calc"
	"github.com/victhorsuzart/go-react-calculator/backend/internal/number"
)

const (
	maxBodyKiB   = 1
	maxBodyBytes = maxBodyKiB << 10
)

// operationHandler serves POST /api/v1/{op.Name}: decode → validate by arity
// → op.Apply → number.Format → respond (SPEC §3.4, §4.2).
func (s *server) operationHandler(op calc.Operation) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fields, err := s.decodeBody(w, r)
		if err != nil {
			s.writeError(w, r, err)
			return
		}
		a, b, err := validate(fields, op.Arity)
		if err != nil {
			s.writeError(w, r, err)
			return
		}
		v, err := op.Apply(a, b)
		if err != nil {
			s.writeError(w, r, err)
			return
		}
		s.writeJSON(w, r, http.StatusOK, "application/json", result{Result: number.Format(v)})
	})
}

// decodeBody checks the content type and size, then decodes exactly one JSON
// object into raw fields.
func (s *server) decodeBody(w http.ResponseWriter, r *http.Request) (map[string]json.RawMessage, error) {
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		return nil, errUnsupportedMediaType
	}

	// Read the whole body first so the size check runs before the JSON check.
	// MaxBytesReader closes the connection after a too-large body only when it
	// is given the server's own writer, so unwrap the middleware recorders.
	body, err := io.ReadAll(http.MaxBytesReader(unwrap(w), r.Body, maxBodyBytes))
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			return nil, err
		}
		// A body that can't be read (client gone, read timeout) is reported
		// as malformed; the cause goes to the log.
		s.logger.WarnContext(r.Context(), "read body", "error", err.Error(), "request_id", requestIDFrom(r.Context()))
		return nil, errMalformedJSON
	}

	dec := json.NewDecoder(bytes.NewReader(body))
	var fields map[string]json.RawMessage
	if err := dec.Decode(&fields); err != nil || fields == nil {
		return nil, errMalformedJSON
	}
	if err := dec.Decode(new(json.RawMessage)); err != io.EOF {
		return nil, errMalformedJSON
	}
	return fields, nil
}

// unwrap returns the innermost writer of a chain of Unwrap methods.
func unwrap(w http.ResponseWriter) http.ResponseWriter {
	for {
		u, ok := w.(interface{ Unwrap() http.ResponseWriter })
		if !ok {
			return w
		}
		w = u.Unwrap()
	}
}

// validate checks the keys allowed for the arity and parses each operand. It
// reports every field error, sorted by field name.
func validate(fields map[string]json.RawMessage, arity int) (a, b float64, err error) {
	allowed := []string{"a", "b"}[:arity]
	var errs validationErrors

	for key := range fields {
		if !slices.Contains(allowed, key) {
			errs = append(errs, fieldError{Field: key, Issue: "unknown_field", Message: key + " is not allowed."})
		}
	}

	values := make([]float64, len(allowed))
	for i, key := range allowed {
		v, fieldErr := parseField(key, fields[key])
		if fieldErr != nil {
			errs = append(errs, *fieldErr)
			continue
		}
		values[i] = v
	}

	if len(errs) > 0 {
		slices.SortStableFunc(errs, func(x, y fieldError) int { return strings.Compare(x.Field, y.Field) })
		return 0, 0, errs
	}
	a = values[0]
	if arity == 2 {
		b = values[1]
	}
	return a, b, nil
}

// parseField converts one raw operand to a float64, or describes why it can't.
func parseField(key string, raw json.RawMessage) (float64, *fieldError) {
	if raw == nil || string(raw) == "null" {
		return 0, &fieldError{Field: key, Issue: "required", Message: key + " is required."}
	}
	var s string
	if json.Unmarshal(raw, &s) != nil {
		return 0, &fieldError{Field: key, Issue: "must_be_string", Message: key + ` must be a decimal string, e.g. "2".`}
	}
	x, err := number.Parse(s)
	switch {
	case errors.Is(err, number.ErrOutOfRange):
		return 0, &fieldError{Field: key, Issue: "out_of_range", Message: key + " is out of range."}
	case err != nil:
		return 0, &fieldError{Field: key, Issue: "invalid_number", Message: key + " is not a valid decimal number."}
	}
	return x, nil
}
