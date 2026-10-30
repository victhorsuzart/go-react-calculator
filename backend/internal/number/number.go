// Package number converts between decimal strings and float64 values
// (SPEC §2.2, §2.3). It does not round; rounding belongs to package calc.
package number

import (
	"errors"
	"math"
	"regexp"
	"strconv"
	"strings"
)

// Errors returned by Parse.
var (
	ErrInvalidNumber = errors.New("invalid number")
	ErrOutOfRange    = errors.New("number out of range")
)

const (
	maxLen = 32
	// minNormal is the smallest normal float64. calc keeps its own copy so it
	// does not depend on this package; TestMinNormal in each pins both copies.
	minNormal = 0x1p-1022
)

var grammar = regexp.MustCompile(`^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$`)

// Parse converts a decimal string to a float64. The string must match the
// §2.2 grammar and be zero or within the normal float64 range. "-0" yields 0.
func Parse(s string) (float64, error) {
	if len(s) > maxLen || !grammar.MatchString(s) {
		return 0, ErrInvalidNumber
	}
	x, err := strconv.ParseFloat(s, 64)
	if err != nil {
		if errors.Is(err, strconv.ErrRange) {
			return 0, ErrOutOfRange
		}
		return 0, ErrInvalidNumber
	}
	if x == 0 {
		mantissa := s
		if i := strings.IndexAny(s, "eE"); i >= 0 {
			mantissa = s[:i]
		}
		if strings.ContainsAny(mantissa, "123456789") {
			return 0, ErrOutOfRange
		}
		return 0, nil
	}
	if math.Abs(x) < minNormal {
		return 0, ErrOutOfRange
	}
	return x, nil
}

// Format returns the canonical text of x (§2.3, steps 2–4): -0 becomes "0",
// plain notation when 1e-6 ≤ |x| < 1e15, scientific notation otherwise, and
// no trailing zeros. x is expected to be rounded already; NaN and ±Inf are
// outside the contract and are returned as strconv writes them.
func Format(x float64) string {
	if x == 0 {
		return "0"
	}
	if math.IsNaN(x) || math.IsInf(x, 0) {
		return strconv.FormatFloat(x, 'g', -1, 64)
	}

	// Shortest representation, e.g. "-1.2345e+17".
	s := strconv.FormatFloat(x, 'e', -1, 64)
	sign := ""
	if s[0] == '-' {
		sign, s = "-", s[1:]
	}
	mantissa, expText, _ := strings.Cut(s, "e")
	exp, _ := strconv.Atoi(expText)
	digits := strings.Replace(mantissa, ".", "", 1)

	if exp < -6 || exp > 14 {
		out := digits[:1]
		if len(digits) > 1 {
			out += "." + digits[1:]
		}
		expSign := "+"
		if exp < 0 {
			expSign, exp = "-", -exp
		}
		return sign + out + "e" + expSign + strconv.Itoa(exp)
	}

	if exp < 0 {
		return sign + "0." + strings.Repeat("0", -exp-1) + digits
	}
	if len(digits) <= exp+1 {
		return sign + digits + strings.Repeat("0", exp+1-len(digits))
	}
	return sign + digits[:exp+1] + "." + digits[exp+1:]
}
