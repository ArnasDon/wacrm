export type DataSourceType = 'google_sheets' | 'remote_csv' | 'uploaded_csv'
export type DataSourceUsage = 'knowledge' | 'catalog' | 'both'
export type DataSourceStatus = 'active' | 'disabled' | 'error'
export type FallbackPolicy = 'primary_only' | 'fallback_on_not_found' | 'search_all_active'

export interface DataSourceRow {
  id: string
  account_id: string
  source_type: DataSourceType
  display_name: string
  source_url: string | null
  source_filename: string | null
  usage: DataSourceUsage
  status: DataSourceStatus
  priority: number
  is_primary: boolean
  fallback_policy: FallbackPolicy
  currency: string
  column_mapping: Record<string, unknown> | null
  row_count: number | null
  knowledge_document_id: string | null
  last_synced_at: string | null
  last_error: string | null
  created_at: string
  updated_at: string
  /** First-5-rows snapshot (raw header-keyed) — see migration 046. Only
   *  meaningful for `usage: knowledge` sources; catalog/both sources are
   *  previewed live from ai_catalog_products instead (getDataSourcePreview
   *  in service.ts). */
  preview_sample: { sample: Record<string, string>[]; columns: string[] } | null
}

export interface DataSourceMutableFields {
  displayName?: string
  usage?: DataSourceUsage
  status?: DataSourceStatus
  priority?: number
  isPrimary?: boolean
  fallbackPolicy?: FallbackPolicy
  currency?: string
}
