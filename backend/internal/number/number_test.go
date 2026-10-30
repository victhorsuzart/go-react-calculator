package number

import (
	"errors"
	"math"
	"strings"
	"testing"
)

func TestParse(t *testing.T) {
	accepted := []struct {
		name string
		in   string
		want string // Format of the parsed value
	}{
		{"zero", "0", "0"},
		{"negative zero", "-0", "0"},
		{"zero with exponent", "0e5", "0"},
		{"negative zero with exponent", "-0.0e-400", "0"},
		{"trailing zero in fraction", "0.10", "0.1"},
		{"negative", "-1.5", "-1.5"},
		{"exponent with plus", "1e+15", "1e+15"},
		{"upper-case exponent", "1.5E-7", "1.5e-7"},
		{"smallest normal", "2.2250738585072014e-308", "2.2250738585072014e-308"},
		{"largest normal", "1.7976931348623157e308", "1.7976931348623157e+308"},
		{"negative largest normal", "-1.7976931348623157e308", "-1.7976931348623157e+308"},
		{"32 characters", "1." + strings.Repeat("0", 30), "1"},
	}
	for _, tc := range accepted {
		t.Run("accepts/"+tc.name, func(t *testing.T) {
			x, err := Parse(tc.in)
			if err != nil {
				t.Fatalf("Parse(%q) error = %v", tc.in, err)
			}
			if x == 0 && math.Signbit(x) {
				t.Errorf("Parse(%q) returned -0, want 0", tc.in)
			}
			if got := Format(x); got != tc.want {
				t.Errorf("Format(Parse(%q)) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}

	rejected := []struct {
		name string
		in   string
		want error
	}{
		{"empty", "", ErrInvalidNumber},
		{"NaN", "NaN", ErrInvalidNumber},
		{"Inf", "Inf", ErrInvalidNumber},
		{"hex", "0x10", ErrInvalidNumber},
		{"comma", "1,5", ErrInvalidNumber},
		{"leading space", " 1", ErrInvalidNumber},
		{"leading plus", "+1", ErrInvalidNumber},
		{"no integer part", ".5", ErrInvalidNumber},
		{"trailing point", "1.", ErrInvalidNumber},
		{"leading zero", "01", ErrInvalidNumber},
		{"trailing newline", "1\n", ErrInvalidNumber},
		{"33 characters", "1." + strings.Repeat("0", 31), ErrInvalidNumber},
		{"overflow", "1e400", ErrOutOfRange},
		{"negative overflow", "-1e400", ErrOutOfRange},
		{"underflow", "1e-400", ErrOutOfRange},
		{"subnormal", "5e-324", ErrOutOfRange},
		{"negative subnormal", "-5e-324", ErrOutOfRange},
		{"just below smallest normal", "2.2250738585072011e-308", ErrOutOfRange},
	}
	for _, tc := range rejected {
		t.Run("rejects/"+tc.name, func(t *testing.T) {
			_, err := Parse(tc.in)
			if !errors.Is(err, tc.want) {
				t.Errorf("Parse(%q) error = %v, want %v", tc.in, err, tc.want)
			}
		})
	}
}

// calc keeps its own copy of minNormal; both are pinned to the same bits.
func TestMinNormal(t *testing.T) {
	if got := math.Float64bits(minNormal); got != 0x0010000000000000 {
		t.Errorf("Float64bits(minNormal) = %#x, want 0x0010000000000000", got)
	}
}

func TestFormat(t *testing.T) {
	tests := []struct {
		name string
		in   float64
		want string
	}{
		// §2.3 table, as values already rounded by calc.
		{"0.1 + 0.2", 0.3, "0.3"},
		{"2 / 3", 0.666666666666667, "0.666666666666667"},
		{"1.5 * 2", 3, "3"},
		{"999999999999999 + 1", 1e15, "1e+15"},
		{"123456789 * 987654321", 1.21932631112635e17, "1.21932631112635e+17"},
		{"0.000001 / 10", 1e-7, "1e-7"},
		{"-1 * 0", math.Copysign(0, -1), "0"},
		// Notation boundaries and sign.
		{"smallest plain", 1e-6, "0.000001"},
		{"below plain", 9.99999e-7, "9.99999e-7"},
		{"largest plain", 999999999999999, "999999999999999"},
		{"plain with fraction", 1234.5, "1234.5"},
		{"negative", -1.5e-7, "-1.5e-7"},
		{"large exponent", 1e300, "1e+300"},
		// Outside the contract (calc never passes these); pinned so Format
		// keeps returning strconv's text instead of mangling it.
		{"not a number", math.NaN(), "NaN"},
		{"infinity", math.Inf(1), "+Inf"},
		{"negative infinity", math.Inf(-1), "-Inf"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := Format(tc.in); got != tc.want {
				t.Errorf("Format(%v) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

func FuzzParse(f *testing.F) {
	for _, s := range []string{
		"0", "-0", "0.10", "1e+15", "1.5E-7",
		"", "NaN", "Inf", "0x10", "1,5", " 1", "+1", ".5", "1.", "01",
		"1e400", "1e-400", "5e-324",
		"2.2250738585072014e-308", "1.7976931348623157e308",
	} {
		f.Add(s)
	}
	// §9.1: no input panics. The round-trip property is FuzzRoundTrip's job.
	f.Fuzz(func(t *testing.T, s string) {
		_, _ = Parse(s)
	})
}

func FuzzRoundTrip(f *testing.F) {
	for _, x := range []float64{
		0, 0.3, 0.666666666666667, 3, 1e15, 1.21932631112635e17, 1e-7,
		1e-6, 9.99999e-7, 999999999999999, -1.5e-7, 1e300,
		0x1p-1022, math.MaxFloat64,
	} {
		f.Add(x)
	}
	f.Fuzz(func(t *testing.T, x float64) {
		if math.IsNaN(x) || math.IsInf(x, 0) || (x != 0 && math.Abs(x) < minNormal) {
			t.Skip()
		}
		s := Format(x)
		y, err := Parse(s)
		if err != nil {
			t.Fatalf("Parse(Format(%v)) = Parse(%q) error = %v", x, s, err)
		}
		if got := Format(y); got != s {
			t.Errorf("Format(Parse(%q)) = %q, want %q", s, got, s)
		}
	})
}
