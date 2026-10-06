import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { Checkbox } from './checkbox'

describe('Checkbox component', () => {
  it('renders unchecked with inline-flex, size-4 and visible border', () => {
    const html = renderToStaticMarkup(
      React.createElement(Checkbox, { 'aria-label': 'Select item' }),
    )
    expect(html).toContain('inline-flex')
    expect(html).toContain('size-4')
    expect(html).toContain('border')
    expect(html).toContain('data-unchecked')
    expect(html).toContain('role="checkbox"')
  })

  it('renders checked with data-checked and check indicator', () => {
    const html = renderToStaticMarkup(
      React.createElement(Checkbox, { checked: true, 'aria-label': 'Select item' }),
    )
    expect(html).toContain('data-checked')
    expect(html).toContain('data-slot="checkbox-indicator"')
    expect(html).toContain('lucide-check')
  })

  it('renders indeterminate with data-indeterminate and minus indicator', () => {
    const html = renderToStaticMarkup(
      React.createElement(Checkbox, { indeterminate: true, 'aria-label': 'Select all' }),
    )
    expect(html).toContain('data-indeterminate')
    expect(html).toContain('data-slot="checkbox-indicator"')
    expect(html).toContain('lucide-minus')
  })
})
