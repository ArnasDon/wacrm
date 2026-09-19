// Cloudinary delivery-URL helpers. Pure string functions — safe on
// client and server.

/** Insert a transformation into a Cloudinary delivery URL. */
export function transformedUrl(url: string, transformation: string): string {
  return url.replace('/image/upload/', `/image/upload/${transformation}/`)
}

/** Square thumbnail for lists and pickers. */
export const thumbUrl = (url: string) => transformedUrl(url, 'c_fill,w_160,h_160,f_auto,q_auto')

/** JPEG ≤1600px for WhatsApp (image messages accept JPEG/PNG up to 5 MB). */
export const whatsappImageUrl = (url: string) => transformedUrl(url, 'c_limit,w_1600,h_1600,f_jpg,q_auto')
