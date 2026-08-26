# WACRM ↔ ERP Inventory API Integration Kit v3

Arquitectura oficial: **multi-tenant + multi-provider**.

- `Inventory API`: capacidad genérica del ERP.
- `Budun ERP`: primer provider/adapter.
- Generic Catalog Tools:
  - `search_catalog`
  - `get_product`
  - `get_availability`
  - `get_product_media`
- Un provider activo por tenant en la primera versión, pero arquitectura preparada para múltiples providers.
- Credenciales aisladas por tenant/account.
- El nombre Budun nunca debe formar parte del nombre permanente de una Tool.

Archivos:
- `WACRM_ERP_INVENTORY_API_INTEGRATION_SPEC.md`
- `WACRM_IMPLEMENTATION_PROMPT.md`
- `WACRM_EXECUTE_PROMPT.md`

No ejecutar todavía hasta que el contrato final del ERP esté validado.
