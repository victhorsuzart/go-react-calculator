package calc_test

import (
	"errors"
	"testing"

	"github.com/victhorsuzart/go-react-calculator/backend/internal/calc"
	"github.com/victhorsuzart/go-react-calculator/backend/internal/number"
)

func TestOperationsTable(t *testing.T) {
	want := []struct {
		name  string
		arity int
	}{
		{"add", 2}, {"subtract", 2}, {"multiply", 2}, {"divide", 2},
		{"power", 2}, {"sqrt", 1}, {"percentage", 2},
	}
	if len(calc.Operations) != len(want) {
		t.Fatalf("len(Operations) = %d, want %d", len(calc.Operations), len(want))
	}
	for i, w := range want {
		op := calc.Operations[i]
		if op.Name != w.name || op.Arity != w.arity {
			t.Errorf("Operations[%d] = {%q, %d}, want {%q, %d}", i, op.Name, op.Arity, w.name, w.arity)
		}
	}
}

// TestOperations covers every row of SPEC Appendix B.1, plus §3.3 cases that
// no B.1 row reaches.
func TestOperations(t *testing.T) {
	tests := []struct {
		name    string
		op      string
		a, b    string
		want    string
		wantErr error
	}{
		{"0.1 plus 0.2", "add", "0.1", "0.2", "0.3", nil},
		{"rounds up to 1e+15", "add", "999999999999999", "1", "1e+15", nil},
		{"overflow", "add", "1e308", "1e308", "", calc.ErrOutOfRange},
		{"max overflows after rounding", "add", "1.7976931348623157e308", "0", "", calc.ErrOutOfRange},
		{"min underflows after rounding", "add", "2.2250738585072014e-308", "0", "", calc.ErrOutOfRange},

		{"0.3 minus 0.1", "subtract", "0.3", "0.1", "0.2", nil},
		{"exact zero", "subtract", "5", "5", "0", nil},

		{"1.5 times 2", "multiply", "1.5", "2", "3", nil},
		{"negative zero", "multiply", "-1", "0", "0", nil},
		{"scientific result", "multiply", "123456789", "987654321", "1.21932631112635e+17", nil},
		{"overflow", "multiply", "1e200", "1e200", "", calc.ErrOutOfRange},
		{"underflow", "multiply", "1e-200", "1e-200", "", calc.ErrOutOfRange},

		{"7 by 2", "divide", "7", "2", "3.5", nil},
		{"2 by 3", "divide", "2", "3", "0.666666666666667", nil},
		{"small result", "divide", "0.000001", "10", "1e-7", nil},
		{"by zero", "divide", "5", "0", "", calc.ErrDivisionByZero},
		{"zero by zero", "divide", "0", "0", "", calc.ErrDivisionByZero},
		{"zero by 5", "divide", "0", "5", "0", nil},
		{"negative zero by 5", "divide", "-0", "5", "0", nil},

		{"zero to zero", "power", "0", "0", "1", nil},
		{"zero to negative", "power", "0", "-1", "", calc.ErrDivisionByZero},
		{"negative to fraction", "power", "-8", "0.5", "", calc.ErrUndefinedResult},
		{"negative to integer", "power", "-2", "3", "-8", nil},
		{"negative exponent", "power", "2", "-1", "0.5", nil},
		{"overflow", "power", "10", "309", "", calc.ErrOutOfRange},
		{"underflow", "power", "10", "-400", "", calc.ErrOutOfRange},

		{"of 9", "sqrt", "9", "0", "3", nil},
		{"of 2", "sqrt", "2", "0", "1.4142135623731", nil},
		{"of zero", "sqrt", "0", "0", "0", nil},
		{"of negative zero", "sqrt", "-0", "0", "0", nil},
		{"of negative", "sqrt", "-4", "0", "", calc.ErrUndefinedResult},

		{"10 percent of 50", "percentage", "10", "50", "5", nil},
		{"50 percent of 1", "percentage", "50", "1", "0.5", nil},
		{"zero percent", "percentage", "0", "50", "0", nil},
		{"falls back when a times b overflows", "percentage", "1e308", "10", "1e+307", nil},
		{"overflow", "percentage", "1e308", "1e10", "", calc.ErrOutOfRange},

		// Not in B.1: a subnormal result is an underflow (§3.3).
		{"subnormal underflow", "multiply", "1e-160", "1e-150", "", calc.ErrOutOfRange},

		// Not in B.1: other operands that force a zero result (§3.3).
		{"zero to positive", "power", "0", "2", "0", nil},
		{"percent of zero", "percentage", "50", "0", "0", nil},
		{"zero times 5", "multiply", "0", "5", "0", nil},
	}
	for _, tc := range tests {
		t.Run(tc.op+"/"+tc.name, func(t *testing.T) {
			op := find(t, tc.op)
			a := parse(t, tc.a)
			b := parse(t, tc.b)
			got, err := op.Apply(a, b)
			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Fatalf("%s(%s, %s) error = %v, want %v", tc.op, tc.a, tc.b, err, tc.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("%s(%s, %s) error = %v", tc.op, tc.a, tc.b, err)
			}
			if s := number.Format(got); s != tc.want {
				t.Errorf("%s(%s, %s) = %q, want %q", tc.op, tc.a, tc.b, s, tc.want)
			}
		})
	}
}

func find(t *testing.T, name string) calc.Operation {
	t.Helper()
	for _, op := range calc.Operations {
		if op.Name == name {
			return op
		}
	}
	t.Fatalf("operation %q not found", name)
	return calc.Operation{}
}

func parse(t *testing.T, s string) float64 {
	t.Helper()
	x, err := number.Parse(s)
	if err != nil {
		t.Fatalf("Parse(%q) error = %v", s, err)
	}
	return x
}
