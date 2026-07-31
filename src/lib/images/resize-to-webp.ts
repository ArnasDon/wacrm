/**
 * Client-side (canvas) downscale + compress to WebP. Used by the
 * branding logo uploader so a large source image (e.g. a 1080px
 * export) always lands at a standard, small size — never upscales,
 * only shrinks.
 */

const QUALITY_STEPS = [0.9, 0.75, 0.6, 0.45] as const

export interface ResizeOptions {
  /** Longest side of the output image, in px. Never upscales. */
  maxDim?: number
  /** Hard cap on the output file size. */
  maxBytes?: number
}

/**
 * Resize `file` so its longest side is at most `maxDim` (preserving
 * aspect ratio), then encode as WebP — stepping the quality down
 * until the result fits under `maxBytes`. Throws a readable error if
 * even the lowest quality step doesn't fit.
 */
export async function resizeImageToWebp(
  file: File,
  { maxDim = 256, maxBytes = 1_000_000 }: ResizeOptions = {},
): Promise<Blob> {
  const objectUrl = URL.createObjectURL(file)
  try {
    const image = await loadImage(objectUrl)

    const scale = Math.min(1, maxDim / Math.max(image.width, image.height))
    const width = Math.max(1, Math.round(image.width * scale))
    const height = Math.max(1, Math.round(image.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('No se pudo procesar la imagen en este navegador.')
    ctx.drawImage(image, 0, 0, width, height)

    for (const quality of QUALITY_STEPS) {
      const blob = await canvasToBlob(canvas, quality)
      if (blob && blob.size <= maxBytes) return blob
    }

    throw new Error(
      `No se pudo comprimir la imagen bajo ${Math.round(maxBytes / 1024)}KB. Prueba con una imagen más simple o de menor resolución.`,
    )
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('No se pudo leer la imagen.'))
    img.src = src
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality))
}
