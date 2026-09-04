# WACRM — PROMPT DE IMPLEMENTACIÓN v4

## OBJETIVO

Implementar una integración de catálogo genérica, multi-tenant y multi-provider en WACRM.

Primera integración real: **Budun ERP**.

## REGLA CENTRAL

Budun = provider/adapter.
Tools = genéricas.

NO crear:
- `search_budun`
- `get_budun_product`
- `check_budun_stock`

Crear:
- `search_catalog`
- `get_product`
- `get_availability`
- `get_product_media`

# FASE 1 — AUDITORÍA

Leer primero todos los documentos de este kit.

Inspeccionar el repositorio real:
- AI Agent
- OpenAI/Anthropic/OpenRouter adapters
- settings
- Supabase/RLS
- secret storage
- media
- WhatsApp
- auto-reply
- playground
- tests

No inventar APIs internas.

# FASE 2 — INTEGRACIÓN

Implementar una abstracción equivalente a:

```text
ExternalIntegration
account_id
provider
display_name
base_url
app_key
encrypted_secret
scopes
status
```

Adaptar nombres a la arquitectura real de WACRM.

Permitir varias integrations por tenant.

El agente puede usar una integración activa/principal, sin perder la arquitectura multi-provider.

# FASE 3 — PROVIDER

Definir contrato común:

```text
CatalogProvider.searchCatalog()
CatalogProvider.getProduct()
CatalogProvider.getAvailability()
CatalogProvider.getMedia()
```

Implementar `BudunProvider`.

# FASE 4 — CLIENTE ERP

Consumir `/api/v1/catalog/`.

Autenticación:

```http
Authorization: Bearer <secret>
```

`app_key` identifica la integración; no sustituye al secreto.

No inventar otro esquema.

# FASE 5 — SETTINGS

Crear/reutilizar:

`Settings → Integrations → Inventory API`

Configurar:
- provider
- display name
- base URL
- app key
- secret
- scopes
- status
- Test Connection
- activate/deactivate
- rotate/revoke cuando aplique

# FASE 6 — SECRETS

Reutilizar AES-256-GCM existente.

No guardar secretos en texto plano.

No exponer secretos al browser, LLM, logs o auditoría.

# FASE 7 — TOOLS

Implementar las 4 Generic Catalog Tools.

Nunca aceptar `account_id`/tenant como autoridad desde el LLM.

# FASE 8 — RESOLVER

```text
account context
→ selected/active integration
→ provider
→ credentials
→ catalog call
```

# FASE 9 — WHITELIST

Resultado permitido:

```text
id
name
brand
model
sku
description
variants
colors
capacity
size
price
currency
available
available_quantity
primary_image
images
```

Bloquear:
IMEI, serial, cost, margin, supplier, movements, private customer data y datos financieros/RRHH.

# FASE 10 — TOOL CALLING

Construir loop real compatible con los providers existentes:

```text
LLM
→ tool call
→ executor
→ provider
→ ERP
→ filtered result
→ LLM
→ final
```

# FASE 11 — MEDIA

Reutilizar el sistema de media de WACRM.

`get_product_media` debe poder alimentar `engineSendMedia` para WhatsApp.

# FASE 12 — KNOWLEDGE BASE

No eliminar KB.

Documentar:

```text
KB = estático
ERP Catalog API = dinámico
```

# FASE 13 — TESTS

Probar:
- integration CRUD
- varias integrations por tenant
- selección activa/principal
- isolation
- secret encryption
- connection test
- provider resolver
- search
- product
- availability
- media
- malformed args
- timeout
- API error
- rate limit
- invalid/revoked secret
- scope denial
- no secret leak
- no IMEI/serial leak
- no cost/margin leak

# FASE 14 — AGENT

Playground:
- producto
- precio
- color
- variante
- stock
- foto

Verificar que no inventa datos.

# FASE 15 — WHATSAPP

Probar:
```text
pregunta → tool → ERP → texto
solicitar foto → tool media → WhatsApp
```

# FASE 16 — REGRESIÓN

Ejecutar según el proyecto:
- typecheck
- lint
- tests
- build
- smoke tests

# FASE 17 — DOCUMENTACIÓN

Actualizar `docs/integrations/` con:
- architecture
- credentials
- providers
- tools
- catalog contract
- media
- security
- testing
- operations

# FASE 18 — CIERRE

Reportar:
- archivos
- migraciones
- tablas
- providers
- tools
- settings
- credentials
- tests
- smoke
- build
- documentación
- commits
- estado final

DETENERSE.

No implementar otro provider funcional aparte de Budun.
