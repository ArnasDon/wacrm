import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Cliente Supabase usado pela aplicação WACRM.
 *
 * Todos os clientes — navegador, SSR e service role — trabalham
 * no esquema lógico `wacrm`.
 */
export type WacrmSupabaseClient = SupabaseClient<
  any,
  'wacrm',
  'wacrm',
  any,
  any
>
