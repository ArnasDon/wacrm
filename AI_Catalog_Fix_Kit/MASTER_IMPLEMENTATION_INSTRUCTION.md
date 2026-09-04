# INSTRUCCIÓN MAESTRA — WACRM AI AGENT + CATÁLOGO

## OBJETIVO
Unificar y corregir las fuentes de datos del agente AI sin romper funcionalidades existentes.

El resultado debe permitir desde AI Agents → Setup configurar:
- Knowledge Base.
- Catálogo desde Google Sheets.
- Catálogo desde CSV/Excel.
- Integraciones externas, actualmente Budun ERP.
- Una o varias fuentes simultáneamente.
- Prioridades y fallback entre fuentes.

La implementación ya existente con `ai_data_sources`, `ai_catalog_products`, `catalog_integrations`, `CatalogProvider`, `DataSourceCatalogProvider`, `BudunProvider`, resolver y tools debe reutilizarse. No crear un sistema paralelo.

## ALCANCE
Modificar solamente lo relacionado con:
1. AI Agents.
2. Knowledge Base.
3. Inventario/Catálogo.
4. Google Sheets/CSV/Excel.
5. Data Sources.
6. Catalog Integrations/Budun.
7. Contexto conversacional.
8. Tool calling.
9. Búsqueda y normalización de consultas.
10. Media de productos.

No tocar auth, roles, pagos, automatizaciones, flujos, WhatsApp salvo la integración ya existente de media, ni otras áreas no relacionadas.

No hacer push, deploy o aplicar cambios remotos sin autorización.

---

# FASE 1 — AUDITORÍA

Antes de modificar código:

1. Localizar el inventario antiguo dentro de AI Agents.
2. Localizar el parser CSV/Excel, Google Sheets, detección de columnas y preview.
3. Localizar endpoints legacy e ingestión a Knowledge Base.
4. Localizar Data Sources e Integrations nuevos.
5. Localizar el flujo real de Playground.
6. Localizar el flujo real de auto-reply de WhatsApp.
7. Verificar cómo se conserva el historial conversacional.
8. Verificar cómo el inventario antiguo llega a KB y cómo el nuevo llega a `CatalogProvider`.

Documentar brevemente el flujo antes del refactor.

---

# FASE 2 — UNIFICAR LA UI

Actualmente existen dos caminos:

1. Inventario antiguo dentro de AI Agents, con:
   - CSV/Excel.
   - Google Sheets.
   - detección automática de columnas.
   - preview de datos.
   - visualización del contenido importado.

2. Data Sources e Integrations nuevos dentro de Configuración.

Esto debe unificarse.

## Resultado esperado

Dentro de `AI Agents → Setup` deben quedar agrupadas:

- Configuración general.
- Knowledge Base.
- Fuentes de datos / Data Sources.
- Catálogo / Inventario.
- Integraciones externas.

Los paneles nuevos Data Sources e Integrations no deben permanecer como secciones aisladas de Configuración si pertenecen exclusivamente a las fuentes que consulta el agente.

Mover o reutilizar componentes; no duplicar interfaces.

## i18n

Usar el sistema de internacionalización existente.

No dejar:
- claves visibles como `Settings.sections.data-sources`;
- textos nuevos hardcodeados en inglés.

---

# FASE 3 — UN SOLO PIPELINE DE INVENTARIO

La UI antigua tiene ventajas que deben conservarse.

La carga antigua debe convertirse en frontend del nuevo sistema de Data Sources/Catalog.

Arquitectura objetivo:

Google Sheets / CSV / Excel
→ detección de columnas
→ preview y confirmación
→ normalización
→ `ai_data_sources`
→ `ai_catalog_products`
→ opcionalmente documento asociado a Knowledge Base si hace falta para información textual.

No deben coexistir dos catálogos estructurados independientes.

Los endpoints legacy pueden mantenerse como compatibilidad, pero internamente deben usar el pipeline nuevo.

No eliminar datos existentes sin una ruta segura de migración.

---

# FASE 4 — DETECCIÓN DE COLUMNAS

Conservar y mejorar la detección automática.

Reconocer:

Principales:
- SKU / código / id.
- nombre / producto / descripción.
- precio / precio venta / price.
- stock / cantidad / existencia / unidades.

Opcionales:
- marca.
- modelo.
- categoría.
- color.
- capacidad.
- RAM.
- tamaño.
- pulgadas.
- talla.
- almacenamiento.
- imagen / foto / image / image_url / media.
- descripción.

Tolerar mayúsculas, minúsculas, espacios, acentos y equivalencias.

Si no hay SKU, generar una identidad estable sin fusionar variantes.

Cada fila conserva su precio real.

Ejemplo:
- IPHONE 11 PRO MAX 256GB DORADO → 17,500
- IPHONE 11 PRO MAX 256GB NEGRO → 20,000

Ambos precios son válidos si la fuente los contiene. Nunca igualarlos ni deducir un precio común.

---

# FASE 5 — BÚSQUEDA NATURAL Y TOLERANTE

Corregir casos donde el producto existe pero la expresión del cliente no coincide literalmente.

Crear normalización de consultas preservando siempre el texto original.

Reconocer equivalencias:

- `50"` ↔ `50 pulgadas` ↔ `50 inch`.
- `tv` ↔ `televisor` ↔ `smart tv` cuando aplique.
- `64 gb` ↔ `64GB`.
- `128 gb` ↔ `128GB`.
- variaciones de espacios y guiones.
- mayúsculas/minúsculas.
- errores ortográficos razonables como `dispnible`.

Ejemplos que deben encontrar el mismo producto cuando exista:

- `TCL 50`
- `TCL de 50 pulgadas`
- `TCL 50"`
- `smart tv TCL`
- nombre completo exacto.

Para:
`TV TCL GOOGLE TV SMART 50 4K ULTRA HD RESOLUTION`

la búsqueda `la TCL de 50 pulgadas` debe poder recuperarlo aunque el Sheet no contenga literalmente “pulgadas”.

Implementar retrieval progresivo:
1. exacto.
2. normalizado.
3. tokens significativos.
4. sinónimos controlados.
5. atributos: marca/modelo/tamaño/capacidad.
6. ranking.

No devolver falsos positivos como coincidencias confirmadas.

---

# FASE 6 — CONTEXTO CONVERSACIONAL

El agente debe seguir el hilo entre turnos.

Ejemplo:

Usuario: `¿Tienen Samsung A07?`
Agente: muestra variantes.

Usuario: `¿Cuánto cuesta el negro de 64?`

Debe resolver:
- Samsung A07.
- color negro.
- 64GB.
- variante exacta.

Después:

Usuario: `¿Y el morado cuánto cuesta?`

Debe usar el contexto del Samsung A07.

Si existen varias variantes moradas con precios distintos:
- listar opciones relevantes; o
- pedir aclaración.

Nunca escoger arbitrariamente.

No depender solo de la memoria del LLM. Mantener o mejorar contexto estructurado por conversación con:

- último producto/familia.
- marca.
- modelo.
- color.
- capacidad.
- tamaño.
- IDs de productos devueltos por `search_catalog`.

Mantener aislamiento por cuenta/conversación.

Investigar específicamente el problema observado donde Playground mostró un producto en un turno y el turno siguiente dijo no tener información confirmada. Corregir la discontinuidad entre resultados de tools y el siguiente mensaje.

---

# FASE 7 — AUTORIDAD DE LOS TOOLS

Los tools:

- `search_catalog`
- `get_product`
- `get_availability`
- `get_product_media`

son la autoridad para catálogo.

## Precio

Nunca responder un precio desde memoria, KB o inferencia cuando el catálogo estructurado sea aplicable.

Secuencia:
1. resolver producto/variante.
2. obtener el producto exacto.
3. responder el precio devuelto.

## Stock

Nunca asumir disponibilidad.

- 0 → agotado/sin unidades.
- sin dato → no hay información confirmada.

## Variantes

Nunca transferir precio entre:
- 128GB y 64GB;
- colores;
- tamaños;
- productos similares.

## Ambigüedad

Si `el morado` puede referirse a más de una variante, pedir precisión o mostrar las opciones.

## No encontrado

No declarar que un producto no existe antes de intentar las estrategias de búsqueda permitidas.

---

# FASE 8 — KNOWLEDGE BASE + CATÁLOGO + BUDUN

Mantener coexistencia:

Knowledge Base:
- FAQ.
- políticas.
- horarios.
- condiciones.
- información no estructurada.

Sheets/CSV/Excel:
- productos.
- precios.
- stock.
- variantes.
- imágenes.

Budun:
- catálogo.
- producto.
- disponibilidad.
- media.

Respetar `priority`, `is_primary` y `fallback_policy`.

No mezclar fuentes accidentalmente. Un producto de Sheets no debe tomar stock de Budun por simple similitud de nombre.

Conservar IDs compuestos y aislamiento de tenant.

---

# FASE 9 — CONFIGURACIÓN DE FUENTES

Permitir claramente:

- activar/desactivar.
- nombre.
- tipo.
- uso: knowledge, catalog o both.
- prioridad.
- fuente primaria.
- fallback.

Casos:

### Solo Sheets
Catálogo completo desde Sheets.

### Solo Budun
Catálogo completo desde Budun.

### Ambos
Ejemplo:
- Budun como primaria.
- Sheets como fallback o fuente complementaria.

La UI debe mostrar claramente qué fuente se utiliza.

---

# FASE 10 — MEDIA Y WHATSAPP

Si existe media confirmada:

1. obtenerla mediante `get_product_media`;
2. en auto-reply real reutilizar `engineSendMedia`;
3. Playground nunca debe enviar WhatsApp.

No crear un sistema paralelo.

Si no hay imagen, nunca inventar URL.

---

# FASE 11 — REGLAS DEL PROMPT

Actualizar el prompt para que el agente:

1. Mantenga el contexto de conversación.
2. Resuelva referencias cortas con historial y estado estructurado.
3. Use tools como autoridad para precio/stock/variantes.
4. Use Knowledge Base para información textual.
5. Nunca invente datos.
6. No cambie moneda arbitrariamente.
7. Pida aclaración ante ambigüedad.
8. Interprete lenguaje informal, abreviaturas y errores.
9. Permita cambio de tema.

Ejemplo:
El usuario hablaba de teléfonos y luego pregunta:
`¿y la TCL de 50?`

El agente debe cambiar al nuevo producto y buscarlo, no seguir hablando de teléfonos.

---

# FASE 12 — TESTS

Agregar pruebas para:

## Multi-turn

1. `¿Tienen Samsung A07?`
2. `¿Cuánto cuesta el negro de 64?`
3. `¿Y el morado?`

Validar continuidad y ambigüedad.

## Lenguaje natural

- `TCL 50`.
- `TCL de 50 pulgadas`.
- `TCL 50"`.
- `smart tv TCL`.
- nombre exacto.

## Precios diferentes

Dos colores del mismo modelo con precios distintos deben conservar ambos valores.

## Seguridad

Validar:
- no mezcla Sheets/Budun;
- IDs fabricados no devuelven datos;
- no hay acceso cross-tenant;
- secretos/costos/márgenes/IMEI/seriales no llegan al LLM.

## Playground

Validar que una búsqueda del turno anterior sirve para resolver el siguiente.

## Media

- Playground sin side effects.
- Auto-reply usa el mecanismo existente.
- sin imagen no inventa URL.

---

# FASE 13 — BASE DE DATOS

La migración 044 ya está aplicada.

No modificar migraciones aplicadas.

Si se requiere base de datos, crear una migración nueva con el siguiente número disponible y compatible con producción.

No borrar datos existentes.

---

# CRITERIOS DE ACEPTACIÓN

- [ ] Data Sources e Integrations dentro de AI Agents → Setup.
- [ ] Sin claves de traducción visibles ni textos nuevos incorrectamente en inglés.
- [ ] La UI antigua conserva detección de columnas y preview.
- [ ] La UI antigua usa el pipeline nuevo, sin catálogo paralelo.
- [ ] Sheets/CSV/Excel alimentan `ai_catalog_products`.
- [ ] Knowledge Base sigue funcionando.
- [ ] Budun sigue aislado por provider/resolver.
- [ ] El agente conserva contexto entre turnos.
- [ ] `el negro de 64` se resuelve correctamente.
- [ ] `la TCL de 50 pulgadas` encuentra el producto existente.
- [ ] `50"` funciona como `50 pulgadas`.
- [ ] No se inventan precios, stock ni imágenes.
- [ ] Las variantes pueden tener precios diferentes.
- [ ] Ambigüedad produce aclaración u opciones.
- [ ] Cambio de tema funciona.
- [ ] Media reutiliza el sistema WhatsApp existente.
- [ ] Playground no envía mensajes reales.
- [ ] typecheck pasa.
- [ ] lint no introduce errores.
- [ ] tests pasan.
- [ ] build pasa.

## REPORTE FINAL

Al terminar entregar:

1. Resumen de arquitectura antes/después.
2. Archivos creados y modificados.
3. Migraciones nuevas, si existen.
4. Cómo quedó la migración del inventario antiguo.
5. Casos de búsqueda natural soportados.
6. Pruebas ejecutadas y resultados.
7. Riesgos pendientes.

No hacer push ni deploy sin autorización explícita.
