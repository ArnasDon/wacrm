# WACRM — Prompt de implementación v3

## Objetivo

Implementar la infraestructura genérica de integración de catálogo para tenants de WACRM. La primera conexión real será `Budun ERP`.

## Regla arquitectónica

Crear Tools genéricas:
- `search_catalog`
- `get_product`
- `get_availability`
- `get_product_media`

Budun es un provider/adapter, nunca el nombre permanente de una Tool.

## 1. Inspección

Leer primero los documentos del directorio y auditar:
- AI Agent
- AI providers
- settings
- Supabase/RLS
- secret storage
- media
- WhatsApp
- playground
- auto-reply
- tests

No inventar nombres internos.

## 2. Integración por tenant

Implementar una entidad/servicio equivalente a:
```text
InventoryIntegration
  provider
  account_id
  credentials
  scopes
  status
```

Resolver:
```text
account_id
 → active integration
 → provider
 → credentials
 → adapter
```

## 3. Providers

Crear interfaz de catálogo y `BudunProvider`. Preparar estructura para otros providers.

## 4. Settings

`Settings → Integrations → Inventory API`

Configurable por tenant:
- provider
- name
- base URL
- app key
- app secret
- API key/access credential
- scopes
- status
- connection test
- rotate/revoke

## 5. Secrets

Reutilizar AES-256-GCM existente.

## 6. Tools

Implementar las cuatro Generic Catalog Tools. No acoplarlas a Budun.

## 7. Whitelist

Construir manualmente el resultado para el LLM. Bloquear IMEI, serial, costo, margen, proveedor y otros datos internos.

## 8. Tool-calling

Construir el loop real:
```text
LLM
→ tool call
→ executor
→ filtered result
→ LLM
→ final answer
```
Compatibilizar con los providers soportados actualmente.

## 9. Media

Integrar `get_product_media` con el mecanismo existente de WACRM para enviar imágenes por WhatsApp.

## 10. Knowledge Base

Mantener la KB existente. Dejar clara la separación:
```text
KB = conocimiento estable
ERP = catálogo dinámico
```

## 11. Seguridad

Aislamiento estricto:
```text
Tenant A → solo A
Tenant B → solo B
```
El LLM no controla `account_id`.

## 12. Tests

Cubrir:
- settings
- provider resolver
- tenant isolation
- secret encryption
- tool schemas/execution
- search
- product
- availability
- media
- malformed args
- timeout/API error/rate limit
- revoked credentials
- scope denial
- no IMEI/serial/cost/margin leak
- no secret leak

## 13. Playground y WhatsApp

Probar producto, precio, color, variante, stock y foto. Validar texto e imagen por WhatsApp.

## 14. Build

Ejecutar typecheck, lint, tests y build según el proyecto.

## 15. Documentación

Actualizar `docs/integrations/` con arquitectura, providers, credentials, tools, media, security, testing y operations.

## 16. Cierre

Entregar archivos modificados, migraciones, providers, tools, settings, secretos, tests, build, smoke, seguridad, documentación y commits.

DETENTE al terminar. No implementar otro provider funcional aparte de Budun.
