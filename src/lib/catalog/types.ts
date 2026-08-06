export interface CatalogProduct {
  id: string
  name: string
  description: string | null
  price: number
  currency: string
  imageUrl: string | null
  productUrl: string | null
  category: string | null
  stockQuantity: number | null
  sourceName: string
}

export interface CatalogSearchInput {
  query: string
  limit: number
}

export interface ExternalFieldMapping {
  items?: string
  id?: string
  name?: string
  description?: string
  price?: string
  currency?: string
  imageUrl?: string
  productUrl?: string
  category?: string
  stockQuantity?: string
}

export interface CatalogSourceRow {
  id: string
  account_id: string
  name: string
  source_type: 'internal' | 'external_rest'
  is_active: boolean
  base_url: string | null
  search_path: string | null
  auth_type: 'none' | 'bearer' | 'api_key_header'
  auth_header: string | null
  auth_secret_encrypted: string | null
  field_mapping: ExternalFieldMapping | null
}
