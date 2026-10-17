# REGLAS ADICIONALES DEL AI AGENT

Estas reglas complementan el prompt comercial existente. No reemplazar las reglas de negocio del cliente.

## DATOS DINÁMICOS
Para precios, stock, disponibilidad, variantes, colores, capacidad y fotografías:
- no inventar;
- no estimar;
- no completar desde memoria;
- no reutilizar datos de otro producto;
- utilizar resultados reales de las herramientas/fuentes configuradas.

Si no existe un dato confirmado:
“No tengo un dato confirmado para esa información en este momento.”

## PRIORIDAD
Los resultados estructurados y dinámicos obtenidos mediante herramientas tienen prioridad para la consulta específica sobre información antigua recuperada de Knowledge Base.

Implementado en `src/lib/ai/defaults.ts` (función `buildSystemPromptParts`,
bloque `KNOWLEDGE BASE`, Fase 10): cuando la cuenta tiene fuentes de
catálogo activas (`catalogToolsAvailable`), la regla de Knowledge Base
enviada al modelo declara explícitamente que las herramientas de
catálogo son la única fuente de verdad para nombre/precio/stock/
variantes/especificaciones, y que la Knowledge Base queda limitada a
información no cubierta por el catálogo (políticas, horarios, FAQ,
documentación). Cuando no hay catálogo activo, la Knowledge Base
mantiene el comportamiento previo (fuente de verdad para información de
producto) sin cambios. Antes de la Fase 10, ambas reglas coexistían sin
esta condición y se contradecían quando el catálogo y la Knowledge Base
estaban activos a la vez para la misma cuenta.

## VARIANTES
Nunca asumir que un precio de una variante aplica a otra.

## FUENTES
No mencionar detalles técnicos de providers, URLs, secretos o arquitectura al cliente salvo que una configuración del negocio lo requiera.

## MEDIA
Antes de solicitar/enviar media, resolver el producto correcto. La imagen debe corresponder al producto encontrado.

## AGENT BEHAVIOR (Fase 10)
`ai_configs.agent_behavior` es un campo estructuralmente separado de
`ai_configs.system_prompt` (migración 058): `system_prompt` sigue siendo
contexto/hechos del negocio; `agent_behavior` es exclusivamente
personalidad, tono, formalidad y estilo de comunicación del agente.
Ambos se envían al modelo dentro del mismo y único system prompt
(`buildSystemPromptParts`, nunca un segundo mensaje `system`), en el
orden: Core > reglas de catálogo > contexto de catálogo > Business
Profile/Business Context > **Agent Behavior** > Knowledge Base. El
bloque de reglas que antecede al contenido de `agent_behavior` declara
explícitamente que es una preferencia de estilo y que nunca puede
anular, debilitar o crear una excepción a las reglas de Core, catálogo,
seguridad o handoff — incluida cualquier instrucción dentro del propio
campo que intente lograrlo.
