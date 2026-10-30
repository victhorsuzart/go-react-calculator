// Package calc defines the calculator operations and decides each result
// value: domain pre-checks, computation, rounding and range check (SPEC §3.3).
package calc

import (
	"errors"
	"math"
	"strconv"
)

// Domain errors returned by Operation.Apply.
var (
	ErrDivisionByZero  = errors.New("division by zero")
	ErrUndefinedResult = errors.New("undefined result")
	ErrOutOfRange      = errors.New("result out of range")
)

// minNormal is the smallest normal float64. number keeps its own copy so the
// two packages stay independent; TestMinNormal in each pins both copies.
const minNormal = 0x1p-1022

// Operation is one calculator operation, exposed as POST /api/v1/{Name}.
// When Arity is 1, Apply ignores b; callers pass 0.
type Operation struct {
	Name  string                              // route name: "add", ...
	Arity int                                 // 1 or 2
	Apply func(a, b float64) (float64, error) // pre-checks, compute, round, range check
}

// Operations lists every operation in route order.
var Operations = []Operation{
	{Name: "add", Arity: 2, Apply: func(a, b float64) (float64, error) {
		return finish(a+b, true)
	}},
	{Name: "subtract", Arity: 2, Apply: func(a, b float64) (float64, error) {
		return finish(a-b, true)
	}},
	{Name: "multiply", Arity: 2, Apply: func(a, b float64) (float64, error) {
		return finish(a*b, a == 0 || b == 0)
	}},
	{Name: "divide", Arity: 2, Apply: func(a, b float64) (float64, error) {
		if b == 0 {
			return 0, ErrDivisionByZero
		}
		return finish(a/b, a == 0)
	}},
	{Name: "power", Arity: 2, Apply: func(a, b float64) (float64, error) {
		if a == 0 && b < 0 {
			return 0, ErrDivisionByZero
		}
		if a < 0 && math.Trunc(b) != b {
			return 0, ErrUndefinedResult
		}
		return finish(math.Pow(a, b), a == 0)
	}},
	{Name: "sqrt", Arity: 1, Apply: func(a, _ float64) (float64, error) {
		if a < 0 {
			return 0, ErrUndefinedResult
		}
		return finish(math.Sqrt(a), a == 0)
	}},
	{Name: "percentage", Arity: 2, Apply: func(a, b float64) (float64, error) {
		p := a * b
		if math.IsInf(p, 0) {
			// a × b overflowed although a × b / 100 may fit (§3.3).
			return finish(a/100*b, false)
		}
		return finish(p/100, a == 0 || b == 0)
	}},
}

// round rounds x to 15 significant digits (§2.3, step 1). A value that rounds
// beyond the float64 maximum becomes ±Inf.
func round(x float64) float64 {
	r, _ := strconv.ParseFloat(strconv.FormatFloat(x, 'e', 14, 64), 64)
	return r
}

// finish rounds a computed value and checks the range of the rounded value
// (§2.4). zeroForced reports whether the operands make a zero result exact.
func finish(x float64, zeroForced bool) (float64, error) {
	if math.IsNaN(x) {
		return 0, ErrUndefinedResult
	}
	r := round(x)
	switch {
	case math.IsInf(r, 0):
		return 0, ErrOutOfRange
	case r == 0 && !zeroForced:
		return 0, ErrOutOfRange
	case r != 0 && math.Abs(r) < minNormal:
		return 0, ErrOutOfRange
	}
	return r, nil
}
