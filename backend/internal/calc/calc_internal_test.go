package calc

import (
	"errors"
	"math"
	"testing"
)

// number keeps its own copy of minNormal; both are pinned to the same bits.
func TestMinNormal(t *testing.T) {
	if got := math.Float64bits(minNormal); got != 0x0010000000000000 {
		t.Errorf("Float64bits(minNormal) = %#x, want 0x0010000000000000", got)
	}
}

// No operation produces NaN from valid operands, so the guard is tested directly.
func TestFinishNaN(t *testing.T) {
	if _, err := finish(math.NaN(), false); !errors.Is(err, ErrUndefinedResult) {
		t.Errorf("finish(NaN) error = %v, want %v", err, ErrUndefinedResult)
	}
}
