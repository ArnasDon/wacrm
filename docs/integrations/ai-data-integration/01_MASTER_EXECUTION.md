# INSTRUCCIÓN MAESTRA DE EJECUCIÓN

## OBJETIVO

Corregir e implementar el sistema mediante el cual el AI Agent obtiene información real antes de responder.

Las fuentes soportadas deben poder coexistir por account/tenant:

- Knowledge Base existente.
- Google Sheets público.
- Remote CSV.
- Uploaded CSV.
- Budun ERP Catalog API.

Cada cliente puede usar una, varias o ninguna integración adicional. La Knowledge Base existente debe continuar funcionando.

## RESULTADO ESPERADO

El agente debe poder responder con datos correctos y no inventar:

- precios;
- stock;
- disponibilidad;
- variantes;
- colores;
- capacidad;
- fotografías.

Debe utilizar la fuente configurada para el tenant y el tipo de pregunta.

## AUDITORÍA OBLIGATORIA

Antes de modificar código, localizar y seguir el flujo real:

Mensaje cliente
→ conversación/sesión
→ account/tenant context
→ AI Agent
→ prompt/context construction
→ Knowledge Base retrieval
→ tool registration
→ LLM tool call
→ tool executor
→ source/integration resolver
→ provider/data source
→ server-side validation/filter
→ tool result
→ LLM final response

También revisar:
- auto reply;
- Playground;
- OpenAI/Anthropic/OpenRouter adapters existentes;
- Supabase/RLS;
- secret storage;
- media;
- engineSendMedia;
- WhatsApp flow.

No asumir que una fuente que funciona en el CRM ya está disponible para el AI Agent. Verificar el punto exacto donde los datos deben entrar en la sesión/tool loop.

## ARQUITECTURA OBJETIVO

Mantener separación conceptual:

Knowledge Base
→ información estable y retrieval existente.

Data Sources
→ Google Sheets / remote CSV / uploaded CSV.
→ pueden contener productos, servicios, horarios, promociones, FAQs u otra información.

Catalog Integrations
→ proveedores dinámicos de catálogo/inventario.
→ primera implementación: Budun ERP.

El AI Agent no debe depender de una sola fuente.

## HERRAMIENTAS DE CATÁLOGO

Mantener herramientas genéricas equivalentes a:

- search_catalog
- get_product
- get_availability
- get_product_media

Budun es provider/adapter, no una Tool.

No crear tools permanentes:
- search_budun
- get_budun_product
- check_budun_stock

Google Sheets puede participar como fuente de catálogo solamente cuando la fuente esté configurada para uso catalog o both.

## DATA SOURCES

Permitir por account/tenant:

- google_sheets
- remote_csv
- uploaded_csv

Configuración equivalente:

- display_name
- source_type
- URL o archivo
- usage: knowledge | catalog | both
- status
- priority
- is_primary cuando corresponda
- fallback_policy
- test_connection
- refresh/cache metadata
- last_updated

No asumir un esquema único para todos los Sheets/CSV.

La implementación debe:
- descargar correctamente;
- validar HTTP;
- parsear CSV;
- detectar headers;
- preservar filas;
- manejar columnas faltantes;
- manejar campos vacíos;
- manejar caracteres especiales;
- normalizar únicamente cuando exista mapeo seguro;
- evitar mezclar filas o variantes;
- soportar cambios de orden de columnas.

## CATALOG PROVIDER

Crear o adaptar una interfaz equivalente:

CatalogProvider.searchCatalog()
CatalogProvider.getProduct()
CatalogProvider.getAvailability()
CatalogProvider.getMedia()

Providers autorizados en esta ejecución:
- GoogleSheetsCatalogProvider, si es necesario para fuentes configuradas como catalog/both.
- BudunProvider.

No implementar otros ERP funcionales.

## BUDUN ERP

Seguir además los documentos existentes en:

docs/integrations/budun-erp/README.md
docs/integrations/budun-erp/WACRM_ERP_CATALOG_INTEGRATION_SPEC_v4.md
docs/integrations/budun-erp/WACRM_IMPLEMENTATION_PROMPT_v4.md

Usar Catalog API bajo:

/api/v1/catalog/

No usar la Inventory API administrativa para respuestas comerciales del agente.

Autenticación real:

Authorization: Bearer <secret>

app_key identifica la integración pero no reemplaza al secreto.

Guardar secretos mediante el mecanismo seguro existente.

## MULTI-TENANT

account_id debe provenir del contexto autenticado de la conversación o sesión.

Nunca:
- aceptar account_id como autoridad desde el LLM;
- permitir selección arbitraria de otro tenant;
- exponer credenciales al LLM.

Todas las consultas de Data Sources e Integrations deben estar aisladas por tenant.

## RESOLUCIÓN DE FUENTES

Resolver según:
1. tipo de pregunta;
2. capacidades de la fuente;
3. configuración del account;
4. status;
5. priority;
6. is_primary;
7. fallback_policy.

Políticas equivalentes:
- primary_only
- fallback_on_not_found
- search_all_active

No consultar todas las fuentes obligatoriamente.

Ejemplo:
ERP activo como catálogo principal.
Google Sheets configurado como knowledge.
→ precio/stock/variante/foto: ERP.
→ horario/política/servicio: KB o Sheets según retrieval.

Si Sheets también está configurado como catalog:
→ puede ser fallback o fuente seleccionada por política.

## REGLA DE NO MEZCLA

Por defecto:

Un resultado comercial = una fuente seleccionada.

Nunca formar automáticamente una ficha así:

nombre de Sheets
+ precio de ERP
+ stock de CSV
+ foto de otro producto.

Solo combinar fuentes si existe una política explícita y una coincidencia de identidad segura. Esa combinación no es necesaria para esta primera implementación.

Conservar internamente:
- provider/source;
- integration/source id;
- source_product_id;
- updated_at cuando exista.

## REGLA CRÍTICA DE PRECIOS

Para preguntas de:
- precio;
- cuánto cuesta;
- cuánto vale;
- stock;
- disponibilidad;
- color;
- variante;
- capacidad;
- foto;

usar herramientas o fuentes reales configuradas.

El LLM no debe:
- inventar;
- estimar;
- calcular;
- reutilizar un precio de otro producto;
- sustituir una variante.

Si el precio no llega desde una fuente válida:
“No tengo un precio confirmado para ese producto en este momento.”

No confiar únicamente en el prompt. La protección debe venir del flujo real de tool calling y resultados estructurados.

## VARIANTES

Identificar correctamente atributos como:
- color;
- storage;
- capacity;
- RAM;
- size;
- presentation;
- variant.

No mezclar 128 GB con 256 GB.

Si hay varias variantes y la consulta no permite identificar una:
- devolver opciones reales o;
- solicitar aclaración.

## KNOWLEDGE BASE

No eliminar ni reemplazar.

Mantener:
KB → información estable.

Data Sources → información configurable adicional.

Catalog → datos comerciales dinámicos.

Si la KB contiene un precio antiguo y una fuente dinámica devuelve el precio actual, para una pregunta específica de precio debe prevalecer la fuente dinámica.

La KB no debe bloquear ni reemplazar resultados reales de herramientas.

## WHITELIST ERP

Antes de entregar datos al LLM, filtrar server-side.

Permitido:
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

Nunca pasar:
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

Nunca devolver la respuesta cruda del ERP directamente al LLM.

## MEDIA Y WHATSAPP

Cuando el usuario solicite una foto:

cliente
→ get_product_media
→ Integration Resolver
→ BudunProvider
→ ERP Catalog API
→ whitelist/public commercial media
→ mecanismo de media existente de WACRM
→ engineSendMedia
→ WhatsApp

No crear un segundo sistema de envío de media.

La imagen debe corresponder al producto/variante realmente resuelto.

No exponer documentos privados.

## SETTINGS

Separar claramente:

Settings → Data Sources
para:
- Google Sheets;
- Remote CSV;
- Uploaded CSV.

Settings → Integrations → Inventory API
para:
- provider;
- display name;
- base URL;
- app key;
- secret;
- scopes;
- status;
- priority;
- primary/fallback;
- test connection;
- activate/deactivate;
- rotate/revoke si corresponde.

No obligar al cliente a usar ambas áreas.

## TOOL CALLING

Implementar o corregir el loop real:

LLM
→ tool call
→ server-side executor
→ account context
→ source/integration resolver
→ provider/data source
→ validation/whitelist
→ tool result
→ LLM
→ final response

Debe funcionar con los proveedores de IA actualmente soportados por WACRM, adaptándose al código real.

## PRUEBAS OBLIGATORIAS

Data Sources:
- Google Sheets válido/inválido;
- CSV válido/inválido;
- headers diferentes;
- columnas faltantes;
- campos vacíos;
- precios;
- caracteres especiales;
- variantes;
- refresh/cache;
- source disabled;
- wrong tenant;
- multiple sources;
- priority;
- fallback.

ERP:
- integration create/update;
- tenant isolation;
- multiple integrations;
- encryption;
- connection test;
- resolver;
- search;
- product;
- availability;
- variants;
- media;
- invalid/revoked credentials;
- wrong scope;
- timeout;
- API error;
- rate limit;
- no secret leakage;
- no IMEI/serial/cost/margin/supplier leakage.

Agent:
- ¿Tienen Samsung S25?
- ¿Cuánto cuesta?
- ¿Cuánto cuesta el Samsung S25 de 256 GB?
- ¿Qué colores tienen?
- ¿Cuántos tienen disponibles?
- ¿Tienen 256 GB?
- Muéstrame una foto.
- ¿Cuál es el horario?
- ¿Qué formas de pago aceptan?
- ¿Cuál es la garantía?

Verificar:
- producto/precio/stock/variante/foto usan la fuente correcta;
- horarios/políticas pueden venir de KB/Data Sources;
- ningún precio es inventado;
- una variante no usa precio de otra.

## REGRESIÓN

Antes de finalizar:
- typecheck;
- lint;
- tests;
- build;
- smoke tests relevantes.

No aceptar regresiones reales.

## DOCUMENTACIÓN Y CIERRE

Actualizar documentación solo de esta funcionalidad:
- flujo del agente;
- KB;
- Data Sources;
- Google Sheets/CSV;
- Catalog Providers;
- Budun;
- Tools;
- resolver;
- prioridad/fallback;
- seguridad;
- media/WhatsApp;
- testing;
- troubleshooting.

Crear commit con cambios de esta tarea.

Reporte final obligatorio:
1. archivos modificados;
2. archivos creados;
3. migraciones;
4. tablas;
5. flujo del agente encontrado;
6. cómo se integró cada fuente;
7. providers;
8. tools;
9. settings;
10. media;
11. tests ejecutados y resultados;
12. regresiones encontradas/corregidas;
13. riesgos pendientes;
14. commit;
15. estado final.

Después del reporte final: DETENERSE.
