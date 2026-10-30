import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Unmount rendered components after each test; Testing Library only does
// this on its own when Vitest globals are enabled.
afterEach(cleanup)
