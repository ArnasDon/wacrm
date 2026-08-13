// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BulkUploadDropzone } from './bulk-upload-dropzone'

afterEach(cleanup)

function makeFile(name: string, type = 'image/png'): File {
  return new File(['x'], name, { type })
}

describe('BulkUploadDropzone', () => {
  it('renders the drop prompt and picker button', () => {
    const { getByText } = render(<BulkUploadDropzone onFiles={vi.fn()} />)

    expect(getByText(/arrasta as fotografias/i)).toBeTruthy()
    expect(getByText(/seleccionar fotos/i)).toBeTruthy()
    expect(getByText(/jpg, png, webp/i)).toBeTruthy()
  })

  it('is keyboard-accessible: the file input is a real, tabbable input inside a label (not display:none)', () => {
    const { container } = render(<BulkUploadDropzone onFiles={vi.fn()} />)

    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    expect(input.type).toBe('file')
    expect(input.closest('label')).toBeTruthy()
    expect(input.hidden).toBe(false)
    expect(input.tabIndex).not.toBe(-1)
  })

  it('calls onFiles with every selected file (multi-upload) via the picker input', async () => {
    const onFiles = vi.fn()
    const { container } = render(<BulkUploadDropzone onFiles={onFiles} />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement

    const files = [makeFile('a.png'), makeFile('b.jpg', 'image/jpeg')]
    await userEvent.upload(input, files)

    expect(onFiles).toHaveBeenCalledTimes(1)
    expect(onFiles.mock.calls[0][0]).toHaveLength(2)
    expect(onFiles.mock.calls[0][0].map((f: File) => f.name)).toEqual(['a.png', 'b.jpg'])
  })

  it('resets the input value after selection so picking the same file again still fires onFiles', async () => {
    const onFiles = vi.fn()
    const { container } = render(<BulkUploadDropzone onFiles={onFiles} />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement

    await userEvent.upload(input, [makeFile('a.png')])

    expect(input.value).toBe('')
  })

  it('accepts dropped files (drag & drop) and filters out non-image files', () => {
    const onFiles = vi.fn()
    const { container } = render(<BulkUploadDropzone onFiles={onFiles} />)
    const dropzone = container.firstElementChild as HTMLElement

    const imageFile = makeFile('photo.png')
    const textFile = makeFile('notes.txt', 'text/plain')

    fireEvent.drop(dropzone, {
      dataTransfer: { files: [imageFile, textFile] },
    })

    expect(onFiles).toHaveBeenCalledTimes(1)
    expect(onFiles.mock.calls[0][0]).toHaveLength(1)
    expect(onFiles.mock.calls[0][0][0].name).toBe('photo.png')
  })

  it('does not accept drops or picker uploads while disabled', () => {
    const onFiles = vi.fn()
    const { container } = render(<BulkUploadDropzone onFiles={onFiles} disabled />)
    const dropzone = container.firstElementChild as HTMLElement
    const input = container.querySelector('input[type="file"]') as HTMLInputElement

    expect(input.disabled).toBe(true)
    fireEvent.drop(dropzone, { dataTransfer: { files: [makeFile('a.png')] } })
    expect(onFiles).not.toHaveBeenCalled()
  })
})
