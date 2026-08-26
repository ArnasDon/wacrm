# INSTRUCCIÓN DE EJECUCIÓN — WACRM + ERP CATALOG API v4

Vamos a implementar ahora la integración de WACRM con el ERP.

## DOCUMENTACIÓN OBLIGATORIA

Desde la raíz del proyecto WACRM, primero lee estos archivos:

`docs/integrations/budun-erp/README.md`

`docs/integrations/budun-erp/WACRM_ERP_CATALOG_INTEGRATION_SPEC_v4.md`

Después ejecuta el plan contenido en:

`docs/integrations/budun-erp/WACRM_IMPLEMENTATION_PROMPT_v4.md`

## REGLA PRINCIPAL

No improvises una arquitectura distinta.

Primero audita el código real existente de WACRM y después implementa siguiendo los tres documentos anteriores, adaptando únicamente nombres o estructuras cuando la arquitectura real del repositorio lo requiera.

## ARQUITECTURA QUE DEBE QUEDAR

La integración debe ser:

```text
WACRM
  ↓
Generic Catalog Tools
  ↓
Integration Resolver
  ↓
Tenant / Account
  ↓
Provider Adapter
  ↓
Budun ERP
  ↓
Catalog API
```

Las Tools son genéricas:

```text
search_catalog
get_product
get_availability
get_product_media
```

**Budun ERP es un provider/adapter, no una Tool.**

## MULTI-TENANT

La integración debe ser independiente por tenant/account.

Ejemplo:

```text
Tenant A → Budun ERP
Tenant B → Otro ERP
Tenant C → Budun ERP
```

El `account_id` nunca debe ser controlado por el LLM.

Debe provenir del contexto autenticado de la conversación.

## CREDENCIALES DEL ERP

El ERP utiliza:

```text
app_key
secret
```

La autenticación real es:

```http
Authorization: Bearer <secret>
```

El `app_key` identifica la integración, pero no sustituye al secreto.

Guardar el secreto de forma segura utilizando el mecanismo de cifrado ya existente en WACRM.

Nunca exponerlo:

* al navegador;
* al LLM;
* a logs;
* a respuestas;
* a auditoría.

## API A CONSUMIR

La integración debe utilizar la:

```text
Catalog API
```

bajo:

```text
/api/v1/catalog/
```

No utilizar la Inventory API administrativa para las respuestas comerciales del agente.

## INFORMACIÓN QUE EL AGENTE PUEDE MOSTRAR

Solo información comercial:

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

## INFORMACIÓN PROHIBIDA

Nunca enviar al LLM ni mostrar al cliente:

```text
IMEI
IMEI_1
IMEI_2
serial
serial_number
unit_cost
purchase_cost
cost
margin
supplier
supplier_id
stock_movements
private_customer_data
payments
cash
accounting
payroll
sensitive_HR_data
```

El filtrado debe realizarse server-side mediante whitelist.

Nunca devolver directamente la respuesta cruda de la API del ERP.

## KNOWLEDGE BASE

No eliminar el sistema actual de Knowledge Base.

Mantener la separación:

```text
Knowledge Base
→ información estable

ERP Catalog API
→ información dinámica
```

Precio, stock, colores, variantes y fotografías deben proceder del ERP.

## MEDIA / WHATSAPP

La integración debe permitir que:

```text
get_product_media
```

obtenga las fotografías comerciales del ERP y que WACRM pueda enviarlas por WhatsApp utilizando el mecanismo de media ya existente.

Flujo:

```text
ERP
→ imagen pública
→ WACRM
→ engineSendMedia
→ WhatsApp
```

No exponer documentos privados.

## TOOL-CALLING

Implementar el flujo real:

```text
LLM
→ Tool Call
→ Tool Executor
→ Integration Resolver
→ Provider Adapter
→ ERP
→ Whitelist
→ Tool Result
→ LLM
→ Respuesta
```

Debe funcionar con los proveedores de IA que actualmente soporta WACRM.

## SETTINGS

Crear o ampliar:

```text
Settings
→ Integrations
→ Inventory API
```

Debe permitir configurar por tenant:

* provider;
* display name;
* base URL;
* app key;
* secret;
* scopes;
* estado;
* test connection;
* activar/desactivar;
* rotar/revocar según corresponda.

La arquitectura debe permitir varias integrations por tenant.

La primera operación puede utilizar una integración activa/principal.

## PROVIDER

Implementar ahora únicamente:

```text
Budun ERP
```

como adapter/provider.

La arquitectura debe quedar preparada para futuros ERP.

No implementar otro ERP ahora.

## SCOPES

Utilizar los scopes comerciales definidos por el ERP:

```text
catalog:read
catalog:availability:read
catalog:media:read
```

No solicitar ni utilizar scopes de escritura.

## TESTS OBLIGATORIOS

Probar como mínimo:

```text
integration creation
integration update
integration isolation
multiple integrations per tenant
credential encryption
connection test
provider resolver
catalog search
product detail
availability
variants
media
invalid credentials
revoked credentials
wrong tenant
wrong scope
timeout
API error
rate limit
no secret leakage
no IMEI leakage
no serial leakage
no cost leakage
no margin leakage
no supplier leakage
```

## PRUEBAS DEL AGENTE

Usar el Playground para probar:

```text
¿Tienen Samsung S25?
¿Cuánto cuesta?
¿Qué colores tienen?
¿Cuántos tienen disponibles?
¿Tienen 256 GB?
Muéstrame una foto.
```

Verificar que:

* consulta el ERP;
* no inventa datos;
* devuelve precio real;
* devuelve disponibilidad real;
* devuelve variantes reales;
* puede entregar imagen;
* nunca muestra IMEI;
* nunca muestra serial;
* nunca muestra costo;
* nunca muestra margen.

## WHATSAPP

Probar ambos escenarios:

```text
cliente
→ pregunta de producto
→ Tool
→ ERP
→ respuesta de texto
```

y:

```text
cliente
→ solicita foto
→ Tool media
→ WhatsApp
```

## REGRESIÓN

Antes del cierre ejecutar las validaciones del proyecto:

```text
typecheck
lint
tests
build
smoke tests
```

No aceptar regresiones reales.

## DOCUMENTACIÓN

Actualizar la documentación de integración con:

* arquitectura;
* configuración;
* credenciales;
* provider;
* Tools;
* Catalog API;
* media;
* seguridad;
* multi-tenant;
* testing;
* troubleshooting.

## REGLAS DE NO IMPLEMENTACIÓN

No:

* crear Tools específicas de Budun;
* crear una integración global;
* permitir que el LLM controle el tenant;
* devolver IMEI/serial/costo/margen/proveedor;
* almacenar secretos en texto plano;
* implementar escritura en el ERP;
* eliminar la Knowledge Base;
* implementar otro ERP funcional.

## ORDEN DE EJECUCIÓN

1. Leer `README.md`.
2. Leer `WACRM_ERP_CATALOG_INTEGRATION_SPEC_v4.md`.
3. Leer `WACRM_IMPLEMENTATION_PROMPT_v4.md`.
4. Auditar el repositorio real.
5. Implementar.
6. Ejecutar tests.
7. Ejecutar smoke.
8. Ejecutar regresión.
9. Documentar.
10. Crear commit.
11. Entregar reporte final.
12. DETENERSE.

## INICIO

Empieza ahora leyendo:

`docs/integrations/budun-erp/WACRM_ERP_CATALOG_INTEGRATION_SPEC_v4.md`

y luego:

`docs/integrations/budun-erp/WACRM_IMPLEMENTATION_PROMPT_v4.md`

No saltes directamente al código.
