import { describe, expect, it } from 'vitest'
import { canEditTemplateCategory } from './template-category-edit'

describe('canEditTemplateCategory', () => {
  it('locks the category of an approved template', () => {
    expect(canEditTemplateCategory('APPROVED')).toBe(false)
  })

  it.each(['REJECTED', 'PAUSED', 'DRAFT', null, undefined])(
    'allows changing the category when the status is %s',
    (status) => {
      expect(canEditTemplateCategory(status)).toBe(true)
    },
  )
})
