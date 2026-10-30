import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('App', () => {
  it('renders the calculator in the main landmark', () => {
    render(<App />)
    const main = screen.getByRole('main')
    expect(within(main).getByRole('group', { name: 'Keypad' })).toBeDefined()
    expect(within(main).getByRole('status').textContent).toBe('0')
  })
})
