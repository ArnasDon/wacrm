import { createClient } from '@/lib/supabase/server'

export interface Branding {
  logoUrl: string | null
  brandName: string
}

const DEFAULT_BRANDING: Branding = {
  logoUrl: null,
  brandName: 'CRM Template for WhatsApp',
}

/**
 * Server-side read of the instance's branding (migration 043,
 * singleton `app_branding` row). Used by the dashboard layout to pass
 * the logo/name down to the sidebar with no client round-trip and no
 * flash of default branding.
 *
 * Never throws — any failure (row missing, RLS hiccup, network) falls
 * back to the same default the app shipped with, so a bad branding
 * row can never break the whole dashboard from rendering.
 */
export async function getBranding(): Promise<Branding> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('app_branding')
      .select('logo_url, brand_name')
      .eq('id', true)
      .maybeSingle()
    if (error || !data) return DEFAULT_BRANDING
    return {
      logoUrl: data.logo_url ?? null,
      brandName: data.brand_name || DEFAULT_BRANDING.brandName,
    }
  } catch {
    return DEFAULT_BRANDING
  }
}
