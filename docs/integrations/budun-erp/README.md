# WACRM ↔ ERP Inventory/Catalog Integration Kit v4

**Estado: preparado para ejecución futura. NO ejecutar todavía.**

Basado en el contrato real cerrado por FASE 15 ampliada del ERP.

- Inventory API administrativa: `/api/v1/`
- Catalog API comercial: `/api/v1/catalog/`
- `Integration` genérica y múltiple por tenant
- `app_key` público
- secreto autenticante mediante Bearer
- `secret_hash` en ERP
- scopes `catalog:*`
- `ProductImage` y media pública

Arquitectura:
**Generic Catalog Tools → Integration Resolver → Provider Adapter → ERP Catalog API**

Tools oficiales:
- `search_catalog`
- `get_product`
- `get_availability`
- `get_product_media`

Budun ERP es el primer provider, no el nombre de las Tools.

Archivos:
- `WACRM_ERP_CATALOG_INTEGRATION_SPEC_v4.md`
- `WACRM_IMPLEMENTATION_PROMPT_v4.md`
- `WACRM_EXECUTE_PROMPT_v4.md`

Guardar y esperar autorización para ejecutar.
