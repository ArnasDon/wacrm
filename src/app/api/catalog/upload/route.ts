import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const MAX_BYTES = 5 * 1024 * 1024

export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'A fotografia é obrigatória.' }, { status: 400 })
    }
    if (!ALLOWED.has(file.type)) {
      return NextResponse.json({ error: 'Formato não permitido. Use JPG, PNG, WEBP ou GIF.' }, { status: 400 })
    }
    if (file.size <= 0 || file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'A fotografia deve ter no máximo 5 MB.' }, { status: 400 })
    }

    const extension = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
    const path = `${accountId}/${crypto.randomUUID()}.${extension}`
    const { error } = await supabase.storage
      .from('catalog-products')
      .upload(path, file, { contentType: file.type, upsert: false, cacheControl: '3600' })
    if (error) throw error

    const { data } = supabase.storage.from('catalog-products').getPublicUrl(path)
    return NextResponse.json({ url: data.publicUrl, path }, { status: 201 })
  } catch (error) {
    return toErrorResponse(error)
  }
}
