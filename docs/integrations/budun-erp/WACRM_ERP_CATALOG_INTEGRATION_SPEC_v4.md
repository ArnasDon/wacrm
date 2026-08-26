# WACRM ↔ ERP Catalog API — Especificación v4

## 1. Contrato del ERP

El ERP tiene dos capas:

### Inventory API
Administrativa:
`/api/v1/`

### Catalog API
Comercial:
`/api/v1/catalog/`

WACRM debe consumir **Catalog API** para el agente.

## 2. Autenticación

La entidad es `Integration`.

- `app_key`: identificador público; no autentica.
- secreto: credencial real.
- autenticación: `Authorization: Bearer <secret>`.
- ERP conserva `secret_hash`; el secreto no puede recuperarse del ERP.

WACRM debe guardar el secreto recibido al crear/rotar la integración con su almacenamiento seguro.

## 3. Multi-tenant / multi-provider

Varias integrations por tenant.

Ejemplo:

```text
Tenant A → Budun ERP
Tenant B → Otro ERP
Tenant C → Budun ERP
```

El `account_id` proviene del contexto autenticado de WACRM. Nunca del LLM.

## 4. Provider vs Tool

Budun es `provider/adapter`.

Tools genéricas:

```text
search_catalog
get_product
get_availability
get_product_media
```

No crear Tools permanentes con nombres de Budun.

## 5. Endpoints del catálogo

Capacidades confirmadas:

```text
/api/v1/catalog/search/
/api/v1/catalog/products/
/api/v1/catalog/products/{id}/
/api/v1/catalog/availability/
/api/v1/catalog/variants/
/api/v1/catalog/media/
/api/v1/catalog/media/{uuid}/
```

Antes de hardcodear, verificar las rutas reales en el repositorio/documentación del ERP.

## 6. Información comercial permitida

- id
- name
- brand
- model
- sku
- description
- variants
- colors
- capacity
- size
- price
- currency
- available
- available_quantity
- primary_image
- images

## 7. Información prohibida

Nunca exponer al LLM/cliente:

- IMEI
- IMEI_1
- IMEI_2
- serial
- serial_number
- unit_cost
- purchase_cost
- cost
- margin
- supplier
- supplier_id
- stock movements
- private customers
- payments
- cash
- accounting
- payroll
- sensitive HR

Siempre construir respuestas mediante whitelist server-side.

## 8. Stock serializado

Catalog API debe devolver disponibilidad agregada. Nunca unidades individuales, IMEI o serial.

## 9. Variantes

Soportar color, capacidad, almacenamiento, talla, presentación y atributos futuros.

## 10. Media

Usar `ProductImage` / media pública del ERP.

El flujo en WACRM será:

```text
ERP public image URL
→ Catalog Tool
→ WACRM
→ engineSendMedia
→ WhatsApp
```

No exponer archivos privados.

## 11. Knowledge Base

Mantener la KB:

```text
KB → información estable
Catalog API → precio, stock, variantes y fotos dinámicas
```

## 12. Settings WACRM

Sección:

`Settings → Integrations → Inventory API`

Debe permitir:
- display name
- provider
- base URL
- app key
- secret
- scopes
- status
- test connection
- activate/deactivate
- rotate/revoke si corresponde

## 13. Scopes

- `catalog:read`
- `catalog:availability:read`
- `catalog:media:read`

No solicitar escritura.

## 14. Tool calling

```text
LLM
→ Tool Call
→ server-side executor
→ integration resolver
→ provider adapter
→ ERP
→ whitelist
→ LLM
→ respuesta
```

## 15. Seguridad

Probar aislamiento de cuentas, credenciales, scopes y ausencia de datos sensibles.

## 16. Extensibilidad

Agregar un ERP nuevo debe requerir adapter + configuración + pruebas. Las Tools no deben duplicarse.

## 17. Resultado comercial esperado

Ejemplo:

```text
Tenemos el Samsung S25 256 GB.

Color: Negro
Precio: RD$34,900
Disponible: 4 unidades
```

Foto cuando corresponda.

## 18. Regla

No ejecutar aún. Esta especificación queda preparada para la implementación futura.
