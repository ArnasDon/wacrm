# WACRM ↔ ERP Inventory API — Especificación v3

## Arquitectura

```text
WhatsApp
  ↓
WACRM
  ↓
AI Agent
  ↓
Generic Catalog Tools
  ↓
Integration Resolver
  ↓
Tenant / Account Context
  ↓
Provider Adapter
  ├── Budun ERP
  ├── Otro ERP
  └── Futuro provider
  ↓
Inventory API / Catalog API
```

## Tools oficiales

- `search_catalog`
- `get_product`
- `get_availability`
- `get_product_media`

No crear Tools permanentes llamadas `buscar_producto_budun`, `consultar_disponibilidad_budun`, `obtener_producto_budun` ni `Budun Catalog`.

## Resolución por tenant

```text
Tenant A → Budun ERP
Tenant B → Otro ERP
Tenant C → Budun ERP
```

El `account_id`/tenant siempre proviene del contexto autenticado, nunca del LLM.

El resolver obtiene:
1. tenant actual;
2. integración activa;
3. provider;
4. credenciales;
5. scopes;
6. adapter.

## Settings

`Settings → Integrations → Inventory API`

Campos:
- Provider
- Display Name
- Base URL
- Application ID / App Key
- Application Secret
- API Key / Access Credential
- Scopes
- Status
- Last Test
- Last Error

## Credenciales

Reutilizar AES-256-GCM existente en WACRM. No usar hash-only para secretos que el servidor debe recuperar. Nunca exponer secretos al LLM, navegador o logs.

## Contrato comercial

Las Tools solo pueden entregar:
- public id
- name
- brand
- model
- SKU
- commercial description
- variants
- colors
- capacity
- size
- price
- currency
- available_quantity
- available
- primary_image
- images

Nunca entregar:
- IMEI
- serial
- cost
- margin
- supplier
- internal movements
- private customer data
- payments
- cash
- accounting
- payroll
- sensitive HR

El payload debe construirse con whitelist explícita, nunca devolver la respuesta cruda del ERP.

## Media

Las URLs son públicas, absolutas, estables y exclusivamente comerciales. No publicar documentos privados.

```text
Provider → image URL → Tool → WACRM → engineSendMedia → WhatsApp
```

## Knowledge Base

La KB actual permanece para información estable: horarios, FAQ, políticas, garantías, envíos. Precio, stock, variantes y fotos dinámicas deben venir del ERP.

## Provider adapters

Las Tools llaman una interfaz común, conceptualmente:

```text
CatalogProvider.searchCatalog()
CatalogProvider.getProduct()
CatalogProvider.getAvailability()
CatalogProvider.getMedia()
```

Budun implementa ese contrato.

Primera versión operativa: un provider activo por tenant. Arquitectura: multi-provider desde el inicio.

## Scopes

Mínimo:
- `catalog:read`
- `catalog:availability:read`
- `catalog:media:read`

No habilitar escritura.

## Seguridad y pruebas

Probar:
- tenant isolation
- provider resolution
- credential encryption
- invalid/revoked credentials
- search/product/availability/media
- malformed args
- provider failure/timeout/rate-limit
- no IMEI/serial/cost/margin leakage
- no secret leakage

## Extensibilidad

Agregar un ERP nuevo debe requerir principalmente un adapter y configuración, no nuevas Tools ni cambios del agente.
