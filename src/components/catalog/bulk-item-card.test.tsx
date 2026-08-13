// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { BulkItemCard, isBulkItemComplete, type BulkItem } from './bulk-item-card'

afterEach(cleanup)

const BASE_ITEM: BulkItem = {
  id: '1',
  file: new File(['x'], 'a.png', { type: 'image/png' }),
  previewUrl: 'blob:preview',
  imageUrl: null,
  uploading: false,
  classifying: false,
  name: '',
  price: '',
  category: null,
  color: null,
  description: '',
}

function renderCard(item: BulkItem) {
  return render(
    <BulkItemCard
      item={item}
      categoryOptions={[]}
      colorOptions={[]}
      onCreateCategory={vi.fn()}
      onCreateColor={vi.fn()}
      onChange={vi.fn()}
      onRemove={vi.fn()}
    />,
  )
}

describe('isBulkItemComplete', () => {
  it('is false until image, name and a valid price are all present', () => {
    expect(isBulkItemComplete(BASE_ITEM)).toBe(false)
    expect(isBulkItemComplete({ ...BASE_ITEM, imageUrl: 'https://x/y.jpg' })).toBe(false)
    expect(isBulkItemComplete({ ...BASE_ITEM, imageUrl: 'https://x/y.jpg', name: 'Legging' })).toBe(false)
    expect(isBulkItemComplete({ ...BASE_ITEM, imageUrl: 'https://x/y.jpg', name: 'Legging', price: '10' })).toBe(true)
  })
})

describe('BulkItemCard — per-item state', () => {
  it('shows "Falta informação" while name/price are missing', () => {
    const { getByText } = renderCard(BASE_ITEM)
    expect(getByText('Falta informação')).toBeTruthy()
  })

  it('shows "Pronto" once image, name and price are filled', () => {
    const { getByText } = renderCard({ ...BASE_ITEM, imageUrl: 'https://x/y.jpg', name: 'Legging', price: '10' })
    expect(getByText('Pronto')).toBeTruthy()
  })

  it('shows an "A analisar com IA" state while classifying', () => {
    const { getByText } = renderCard({ ...BASE_ITEM, imageUrl: 'https://x/y.jpg', classifying: true })
    expect(getByText(/a analisar com ia/i)).toBeTruthy()
  })

  it('surfaces a per-item error individually, without affecting the badge copy of other items', () => {
    const { getByText } = renderCard({ ...BASE_ITEM, error: 'Formato não permitido.' })
    expect(getByText('Formato não permitido.')).toBeTruthy()
    expect(getByText('Falta informação')).toBeTruthy()
  })
})
