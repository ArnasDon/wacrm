/**
 * Extract plain text from a PDF buffer.
 *
 * Uses pdf-parse v2 — the buffer is passed directly to the
 * constructor and text is retrieved via getText().
 *
 * Throws if the buffer is not a valid PDF or parsing fails.
 */
export async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
  let PDFParse: typeof import('pdf-parse').PDFParse
  try {
    PDFParse = (await import('pdf-parse')).PDFParse
  } catch {
    throw new PdfExtractError('pdf-parse could not be loaded.')
  }

  const buf = Buffer.from(buffer)
  let data: { text: string }
  try {
    const parser = new PDFParse(buf)
    data = await parser.getText()
  } catch (err) {
    throw new PdfExtractError(
      `Failed to parse PDF: ${err instanceof Error ? err.message : 'unknown error'}`,
    )
  }

  const text = data.text?.trim()
  if (!text) {
    throw new PdfExtractError('PDF appears to be empty or contains no extractable text.')
  }

  return text
}

export class PdfExtractError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PdfExtractError'
  }
}
