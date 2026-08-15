# 🍉 SANDÍA — MASTER PRODUCT VISION & DEVELOPMENT CONTEXT

> Copiado tal cual del documento que Angel (dueño del proyecto) compartió el 2026-08-15.
> Es la visión de producto de largo plazo. No implica que todo deba construirse ya —
> ver `docs/SANDIA_plan_de_desarrollo.md` para el plan concreto y en qué fase estamos.

## 1. VISIÓN GENERAL
Sandía es una plataforma SaaS de comercio inteligente para PYMES.
La visión de largo plazo NO es construir simplemente otro CRM.
El CRM es la infraestructura B2B que permite que las empresas afiliadas administren sus clientes, conversaciones, productos y ventas.
La visión final de Sandía es convertirse en una capa inteligente entre consumidores y empresas:
> "Pregúntale a Sandía antes de comprar."
Una persona podrá conversar con Sandía mediante WhatsApp, Instagram, Facebook u otros canales y decir qué necesita, qué quiere comprar, cuál es su presupuesto y para qué lo necesita.
La IA de Sandía analizará esa necesidad y podrá buscar entre las empresas afiliadas productos o servicios que realmente sean adecuados para esa persona.
Sandía no debe recomendar simplemente el producto que más dinero genere.
Debe priorizar:
1. Necesidad del usuario
2. Presupuesto
3. Compatibilidad
4. Disponibilidad
5. Ubicación/logística
6. Calidad/reputación
7. Precio/valor
8. Otros criterios relevantes
La confianza del consumidor es un activo fundamental.
---
# 2. EVOLUCIÓN DEL PRODUCTO
Sandía tendrá tres grandes capas:
## SANDÍA BUSINESS
Producto B2B para empresas.
Incluye:
- CRM
- WhatsApp
- Instagram
- Facebook
- IA
- Gestión de conversaciones
- Leads
- Clientes
- Pipeline/Kanban
- Catálogo
- Productos
- Inventario
- Precios
- Cotizaciones
- Pedidos
- Seguimiento
- Automatizaciones
- Métricas
- Usuarios
- Roles/permisos
- Integración con n8n
- Integración futura con FEL/SAT
- Configuración de cada empresa
La plataforma actual ya cuenta con integración de WhatsApp, Instagram y Facebook y automatización mediante IA.
NO reemplazar ni reconstruir innecesariamente esas integraciones.
Primero analizar el código existente y reutilizar lo que ya funciona.
---
# 3. SANDÍA INTELLIGENCE
Esta es la capa de inteligencia.
La IA debe dejar de ser solamente un chatbot que responde preguntas.
Debe convertirse progresivamente en un agente comercial capaz de:
- entender intención
- detectar necesidades
- identificar presupuesto
- recomendar productos
- consultar inventario
- consultar precios
- consultar características
- generar cotizaciones
- crear/actualizar clientes
- crear leads
- actualizar pipeline
- hacer seguimiento
- detectar oportunidades
- recuperar clientes
- responder preguntas
- transferir a humanos
- cerrar ventas cuando esté autorizado
- respetar límites de negociación
- aprender del resultado de las conversaciones
La IA debe poder trabajar con información estructurada de cada empresa.
---
# 4. SANDÍA MARKETPLACE — VISIÓN DE LARGO PLAZO
NO construir esto completamente ahora.
La arquitectura debe quedar preparada para ello.
La visión futura es que las empresas afiliadas proporcionen información autorizada sobre:
- productos
- servicios
- precios
- inventario
- características
- ubicación
- disponibilidad
- promociones
- condiciones
- financiamiento
- políticas
- horarios
- reputación
Una persona podrá preguntarle directamente a Sandía:
"Quiero comprar un carro. Tengo Q2,500 mensuales. Lo necesito para ir a trabajar y estudiar. ¿Qué me recomiendas?"
Sandía debe poder:
1. Entender la necesidad.
2. Hacer preguntas adicionales.
3. Determinar presupuesto y restricciones.
4. Analizar las opciones disponibles.
5. Consultar empresas afiliadas.
6. Hacer matching entre necesidad y productos.
7. Presentar las mejores opciones.
8. Explicar por qué recomienda cada opción.
9. Conectar al usuario con la empresa correspondiente.
10. Registrar el lead.
11. Medir si terminó en una venta.
Ejemplo:
"Por lo que me explicaste, no creo que necesites una camioneta grande. Te conviene priorizar consumo, mantenimiento y precio.
Encontré tres opciones de empresas afiliadas.
La opción 2 parece la más adecuada para tu presupuesto.
La tiene disponible una empresa afiliada a Sandía. ¿Quieres que te conecte con ellos?"
Este es el comportamiento que eventualmente queremos conseguir.
---
# 5. PRINCIPIO FUNDAMENTAL
Sandía NO debe intentar vender el producto que genere más comisión.
Debe recomendar lo que tenga mayor compatibilidad con la necesidad del usuario.
Si la mejor recomendación es NO COMPRAR, Sandía debe poder decirlo.
Ejemplo:
Usuario:
"Quiero comprar una laptop de Q15,000."
Sandía:
"¿Para qué la necesitas?"
Usuario:
"Universidad, Word, Excel, clases y Netflix."
Sandía:
"Honestamente, no considero necesario que gastes Q15,000 para ese uso. Hay opciones de aproximadamente Q4,000–Q5,000 que deberían satisfacer tus necesidades."
Esto construye confianza.
La confianza del consumidor es más importante que una venta individual.
---
# 6. MODELO DE NEGOCIO
Inicialmente Sandía será SaaS B2B.
Modelo actual planteado:
- Q150/mes — base por empresa
- Q350/mes — por cada número de WhatsApp contratado
- Q150/mes — por usuario
- máximo 10 números de WhatsApp por empresa
- máximo 20 usuarios por empresa
El costo real de WhatsApp/Meta debe manejarse separadamente y NO asumir que un modelo fijo de "Q65 por 100 conversaciones" representa necesariamente el costo real actual.
La arquitectura de facturación debe permitir modificar posteriormente el modelo de cobro.
A largo plazo:
SaaS B2B
+
Leads
+
Comisiones por ventas
+
Servicios premium
+
Publicidad/patrocinio claramente identificado
+
Posibles servicios de datos/analytics
Pero las comisiones NO deben alterar silenciosamente la calidad de las recomendaciones.
---
# 7. ESTRATEGIA DE CRECIMIENTO
NO intentar construir todo el Marketplace inmediatamente.
La estrategia es:
FASE 1:
CRM + WhatsApp + Instagram + Facebook + IA
FASE 2:
Catálogo + inventario + inteligencia comercial
FASE 3:
Matching de necesidades con productos de empresas afiliadas
FASE 4:
Sandía Consumer / "Pregúntale a Sandía"
FASE 5:
Leads y ventas atribuidas
FASE 6:
Marketplace / comercio conversacional
FASE 7:
Expansión regional
Primero Guatemala.
Después potencialmente:
El Salvador
Honduras
Nicaragua
Costa Rica
República Dominicana
México
Colombia
No construir infraestructura específica para otros países todavía.
Pero evitar decisiones de arquitectura que hagan imposible internacionalizar posteriormente.
---
# 8. CANALES
Actualmente Sandía integra:
- WhatsApp
- Instagram
- Facebook
Esto es importante.
NO construir una red social propia.
Utilizar las plataformas existentes como canales de adquisición y comunicación.
Modelo futuro:
Facebook/Instagram
        ↓
Descubrimiento
        ↓
WhatsApp
        ↓
Sandía AI
        ↓
Recomendación
        ↓
Empresa afiliada
        ↓
Venta
WhatsApp será inicialmente el canal principal de conversación.
---
# 9. MULTI-TENANCY
Sandía es multi-tenant.
Cada empresa debe tener aislamiento completo de:
- clientes
- conversaciones
- productos
- inventario
- usuarios
- configuraciones
- IA
- documentos
- métricas
- permisos
La IA de una empresa NO debe poder utilizar información privada de otra empresa salvo que esa información haya sido explícitamente autorizada para utilizarse en el futuro Marketplace.
Debe existir una separación conceptual:
PRIVATE BUSINESS DATA
vs.
MARKETPLACE-AVAILABLE DATA
Ejemplo:
Una empresa puede tener:
Producto A:
precio Q5,000
stock 3
visible públicamente: SÍ
Producto B:
precio negociado internamente
stock reservado
visible públicamente: NO
La IA del Marketplace solamente debe utilizar la información autorizada.
---
# 10. MODELO DE DATOS FUTURO
Diseñar la arquitectura pensando en entidades como:
companies
users
roles
customers
conversations
messages
channels
leads
pipelines
pipeline_stages
products
product_variants
categories
inventory
inventory_movements
prices
quotes
orders
sales
appointments
campaigns
automations
ai_agents
ai_actions
ai_permissions
company_knowledge
marketplace_products
marketplace_services
marketplace_visibility
recommendations
recommendation_events
marketplace_leads
attributed_sales
ratings
business_verification
No crear todas estas tablas inmediatamente si no son necesarias.
La prioridad es mantener una arquitectura limpia y extensible.
---
# 11. IA Y HERRAMIENTAS
La IA nunca debe inventar:
- precios
- inventario
- características
- promociones
- disponibilidad
- condiciones
- políticas
Debe consultar herramientas/datos estructurados.
Ejemplo conceptual:
User
↓
LLM
↓
Intent detection
↓
Tool selection
↓
Product search
↓
Inventory check
↓
Price check
↓
Recommendation engine
↓
LLM response
No confiar únicamente en embeddings/RAG para datos transaccionales.
Los datos críticos deben provenir de fuentes estructuradas.
---
# 12. MOTOR DE MATCHING
El futuro motor de matching deberá considerar:
Need
Budget
Category
Specifications
Preferences
Location
Availability
Price
Quality
Business reputation
Delivery
Financing
Other constraints
Resultado:
MATCH SCORE
Ejemplo:
Producto A: 94%
Producto B: 88%
Producto C: 79%
Pero la IA debe poder explicar el motivo:
"Recomiendo A porque cumple tu presupuesto, tiene disponibilidad inmediata y satisface las características que mencionaste."
No simplemente:
"A tiene score 94."
---
# 13. ATRIBUCIÓN
Una parte crítica del futuro Marketplace será saber:
¿De dónde salió la venta?
Ejemplo:
Facebook Ad
↓
WhatsApp
↓
Sandía AI
↓
Producto X
↓
Empresa Y
↓
Lead
↓
Venta
Sandía debe registrar esta cadena.
Esto permitirá medir:
- leads generados
- leads calificados
- conexiones
- cotizaciones
- ventas
- ingresos atribuidos
- comisión
- conversión
La atribución será fundamental para monetizar el Marketplace.
---
# 14. NORTH STAR METRIC
La métrica principal de largo plazo será:
"Decisiones de compra ayudadas exitosamente por Sandía."
No solamente:
- usuarios registrados
- mensajes
- empresas
- conversaciones
Queremos saber:
¿Sandía realmente ayudó a alguien a tomar una mejor decisión y conectar con una empresa?
---
# 15. PRINCIPIOS DE DESARROLLO
1. NO sobreingeniería.
2. NO reconstruir funcionalidades que ya funcionan.
3. NO crear funcionalidades solo porque son interesantes.
4. Cada funcionalidad debe tener un propósito comercial.
5. Priorizar ventas, clientes, conversaciones y datos.
6. Mantener multi-tenancy desde el principio.
7. Mantener seguridad y permisos.
8. Mantener separación entre datos privados y datos Marketplace.
9. Diseñar APIs/módulos desacoplados.
10. Evitar hardcodear reglas comerciales.
11. Documentar decisiones arquitectónicas.
12. Cada cambio debe ser testeable.
13. No romper funcionalidades existentes.
14. Antes de modificar una parte importante, analizar dependencias.
15. Si una decisión técnica puede afectar la visión futura de Marketplace, documentarla.
---
# 16. METODOLOGÍA DE DESARROLLO
Antes de programar:
1. Analizar el código existente.
2. Analizar arquitectura.
3. Identificar funcionalidades ya implementadas.
4. Identificar bugs.
5. Identificar deuda técnica.
6. Crear lista priorizada.
7. No asumir que algo está roto sin probarlo.
8. No reemplazar componentes funcionales innecesariamente.
Trabajar en pequeñas iteraciones.
Cada etapa debe terminar con:
- código funcionando
- pruebas
- documentación
- commit claro
- cambios revisables
No hacer grandes refactors sin necesidad.
---
# 17. PRIORIDAD ACTUAL
La prioridad AHORA NO ES EL MARKETPLACE.
Prioridad:
P0:
Estabilizar CRM existente.
P0:
WhatsApp + Instagram + Facebook.
P0:
IA funcional.
P0:
Multi-tenancy.
P0:
Clientes/conversaciones/leads.
P1:
Catálogo.
P1:
Inventario.
P1:
Pipeline.
P1:
Automatizaciones.
P1:
Métricas.
P2:
Estructura para Marketplace.
P2:
Datos públicos/autorizados de productos.
P3:
Motor inicial de matching.
P4:
Consumer Sandía.
P5:
Marketplace completo.
---
# 18. OBJETIVO DE LOS PRÓXIMOS 12 MESES
No intentar "dominar Guatemala".
Objetivo:
100 empresas afiliadas.
De ellas, una proporción significativa debe ser activa y pagar.
Demostrar que Sandía:
- atiende clientes
- genera leads
- genera cotizaciones
- recupera oportunidades
- ayuda a cerrar ventas
- reduce trabajo humano
Después probar:
"Pregúntale a Sandía qué comprar."
Con empresas reales y productos reales.
Si los consumidores empiezan a utilizar Sandía para decidir qué comprar, entonces comenzar la construcción formal del Marketplace.
---
# 19. POSICIONAMIENTO
Sandía no debe presentarse únicamente como:
"CRM con IA."
Ese mercado ya existe.
La visión es:
> "Sandía es la inteligencia comercial que conecta empresas y consumidores."
Y la visión de largo plazo:
> "Pregúntale a Sandía antes de comprar."
---
# 20. VISIÓN FINAL
El ecosistema final debe verse así:
                 CONSUMIDORES
                       ↓
               WhatsApp / Social
                       ↓
                🍉 SANDÍA AI
                       ↓
             NECESIDAD / INTENCIÓN
                       ↓
              MATCHING INTELIGENTE
                       ↓
             EMPRESAS AFILIADAS
                       ↓
             PRODUCTO / SERVICIO
                       ↓
                    VENTA
                       ↓
                 ATRIBUCIÓN
                       ↓
                 APRENDIZAJE
                     🍉 SANDÍA
                         |
        ┌────────────────┼────────────────┐
        ↓                ↓                ↓
 Sandía Business   Intelligence      Marketplace
        ↓                ↓                ↓
    Empresas          IA             Consumidores
OBJETIVO FINAL:
Que cuando una persona en Guatemala piense:
"Quiero comprar algo, pero no sé qué me conviene."
Su primera reacción sea:
"Voy a preguntarle a Sandía."
IMPORTANTE:
Este documento representa la visión estratégica de producto.
NO significa que se deba implementar todo inmediatamente.
La prioridad es construir, medir y validar cada etapa.
La regla principal es:
BUILD → MEASURE → LEARN → IMPROVE → SCALE
No:
BUILD EVERYTHING → HOPE.
Cuando una decisión de implementación no esté clara, priorizar la opción que:
1. Mantenga el producto simple.
2. Preserve la arquitectura multi-tenant.
3. Proteja los datos de las empresas.
4. Permita reutilizar la funcionalidad existente.
5. Mantenga abierta la posibilidad del Marketplace.
6. Genere valor comercial inmediato.
Sandía debe evolucionar de:
CRM
→ AI CRM
→ AI Sales Platform
→ Intelligent Commerce Layer
→ Consumer Marketplace
→ Regional Commerce Network.
