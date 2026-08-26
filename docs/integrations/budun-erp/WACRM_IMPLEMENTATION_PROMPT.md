# Prompt para Claude Code — WACRM ↔ ERP Inventory API / Budun ERP

Lee primero `WACRM_ERP_INVENTORY_API_INTEGRATION_SPEC.md`.

Después inspecciona el repositorio WACRM real antes de modificar código.

## OBJETIVO

Implementar en WACRM una integración configurable con un ERP externo cuya integración concreta actual es `Budun ERP`.

IMPORTANTE:
- En el ERP, la capacidad se llama `Inventory API` y es genérica.
- En WACRM, la integración concreta se llama `Budun ERP`.
- No acoplar el diseño de WACRM a una futura marca adicional.
- El código debe permitir, si el proyecto lo soporta, añadir otros proveedores/ERP posteriormente.

## INTEGRACIÓN WACRM

Agregar:

`Settings → Integrations → Budun ERP`

Campos:
- ERP Inventory API Base URL
- Application ID / App Key
- Application Secret
- Catalog API Key / Access Credential
- scopes
- estado
- última prueba
- último error

Acciones:
- Probar conexión
- Rotar credencial
- Revocar credencial
- Guardar configuración

## SEGURIDAD

Guardar credenciales solo server-side usando el patrón cifrado existente de WACRM.

Nunca:
- poner secretos en prompts;
- enviar secretos al LLM;
- exponer secretos al navegador;
- escribir secretos en logs.

## CLIENTE HTTP

Crear un servicio server-side para consumir:
- Catalog API
- Availability API

Usar timeout, manejo de errores, validación de respuesta y logging seguro.

No inventar APIs internas de WACRM.

## TOOL DEL AGENTE

Crear una integración de Tools llamada:

`Budun Catalog`

Tools:

1. `buscar_producto_budun`
2. `consultar_disponibilidad_budun`
3. `obtener_producto_budun`

La Tool solo podrá devolver:

- nombre;
- marca;
- modelo;
- SKU;
- descripción;
- variantes;
- colores;
- capacidad/talla;
- precio;
- moneda;
- cantidad disponible;
- disponibilidad;
- imágenes.

NO devolver:
- IMEI;
- Serial;
- costo;
- margen;
- proveedor;
- movimientos internos;
- clientes privados;
- pagos;
- caja;
- contabilidad;
- RRHH;
- nómina.

El endpoint comercial debe ser tratado como una fuente de catálogo, no como inventario administrativo completo.

## REGLAS DEL AGENTE

Si el usuario pregunta sobre:
- productos;
- precio;
- color;
- variante;
- disponibilidad;

usar las Tools de Budun Catalog.

Nunca inventar datos.

No usar Knowledge Base para stock dinámico.

## FOTOS

La Tool recibirá URLs absolutas de fotos comerciales.

Reutilizar el mecanismo de WACRM para enviar imágenes por WhatsApp.

No exponer IMEI/Serial ni datos internos.

## KNOWLEDGE BASE

Mantener allí información estable:
- horarios;
- políticas;
- garantías;
- devoluciones;
- envíos;
- métodos de pago;
- FAQ.

Inventario, stock, precios y fotos deben venir del ERP.

## CONEXIÓN

Implementar `Probar conexión` y validar:
- URL;
- credencial;
- auth;
- scope;
- endpoint;
- respuesta;
- latencia;
- error seguro.

## SCOPES

Para el agente:
- catalog:read
- catalog:availability:read
- catalog:media:read

No habilitar escritura.

## TESTS

Crear tests para:
- guardar configuración;
- cifrado de secretos;
- conexión;
- búsqueda;
- disponibilidad;
- detalle;
- imágenes;
- errores;
- scopes;
- no leakage de IMEI/Serial;
- no leakage de costos/margen;
- no leakage de secretos;
- permisos;
- tenant/account isolation cuando aplique.

## BUILD / CHECK

Ejecutar:
- tests;
- lint/typecheck;
- build;
- regresión apropiada;
- smoke de integración.

Antes de modificar, inspeccionar la implementación actual de:
- AI Agent
- tools
- settings/integrations
- secret storage
- outbound media
- Playground/auto-reply

## NO IMPLEMENTAR

No implementar:
- reservas;
- pedidos;
- ventas;
- pagos;
- modificaciones de inventario.

La primera integración es READ-ONLY.

## CIERRE

Entregar:
- arquitectura;
- archivos modificados;
- configuración;
- Tool;
- seguridad;
- tests;
- build;
- documentación;
- problemas;
- correcciones.

DETENTE al terminar.
