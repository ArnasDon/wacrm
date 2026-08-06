import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Cliente Supabase usado pela aplicação WACRM.
 *
 * Todos os clientes — navegador, SSR e service role — trabalham
 * no esquema lógico `wacrm`. Estes parâmetros permanecem deliberadamente
 * genéricos até o projecto passar a gerar os tipos da base de dados.
 */
export type WacrmSupabaseClient = SupabaseClient<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  'wacrm',
  'wacrm',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any
>
