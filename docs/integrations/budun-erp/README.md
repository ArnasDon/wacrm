# WACRM ↔ ERP Inventory API Integration Kit

## Nomenclatura

**ERP:** módulo genérico `Inventory API`.

**Integración concreta en WACRM:** `Budun ERP`.

Esto evita que la API del ERP quede acoplada a un único CRM.

## Archivos

- `WACRM_ERP_INVENTORY_API_INTEGRATION_SPEC.md`
- `WACRM_IMPLEMENTATION_PROMPT.md`

## Resultado esperado

WACRM tendrá:

`Settings → Integrations → Budun ERP`

con:
- ERP Inventory API Base URL
- Application ID / App Key
- Application Secret
- Catalog API Key / Access Credential
- scopes
- prueba de conexión
- estado

El agente usará:
- `buscar_producto_budun`
- `consultar_disponibilidad_budun`
- `obtener_producto_budun`

## Información comercial permitida

- producto
- variantes
- colores
- precio
- moneda
- disponibilidad
- cantidad
- fotos

## Información prohibida

- IMEI
- Serial
- costo
- margen
- proveedor
- movimientos internos
- clientes privados
- pagos
- caja
- contabilidad
- RRHH
- nómina

## Integración de imágenes

Budun entrega la URL de la foto comercial.
WACRM usa su infraestructura de medios para enviarla por WhatsApp.

## Importante

Este kit es para el repositorio WACRM. No modifica el ERP.

La implementación concreta debe inspeccionar el código actual de WACRM antes de cambiarlo.
