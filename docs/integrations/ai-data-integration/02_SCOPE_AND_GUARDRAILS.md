# ALCANCE Y GUARDRAILS — OBLIGATORIO

## Alcance permitido
Solo trabajar en:
- AI Agent runtime y construcción de contexto cuando sea necesario para conectar fuentes reales.
- Knowledge Base retrieval, sin eliminar ni reemplazar la KB.
- Tool registration, tool executor y tool result loop.
- Google Sheets/CSV data sources.
- Catalog integration framework.
- Integration resolver.
- Budun ERP provider.
- Settings y persistencia estrictamente necesarias para estas fuentes.
- Media de catálogo hacia el mecanismo existente de WhatsApp.
- Tests, migraciones y documentación directamente relacionados.

## Fuera de alcance por defecto
No modificar ni refactorizar:
- autenticación;
- sistema general de usuarios;
- roles y permisos;
- CRM y pipelines;
- pagos;
- facturación;
- mensajería general;
- WhatsApp fuera del punto de integración de media existente;
- UI no relacionada;
- otros providers;
- arquitectura general de Supabase;
- módulos no relacionados.

## Regla de mínima intervención
Antes de crear un sistema nuevo, buscar si WACRM ya tiene una abstracción reutilizable.

Preferir:
1. extender;
2. adaptar;
3. encapsular;
4. crear código nuevo solo si no existe una extensión segura.

## Prohibido
- No hacer una migración o refactor masivo.
- No cambiar contratos públicos existentes sin compatibilidad.
- No eliminar funcionalidades.
- No sustituir la Knowledge Base.
- No crear un segundo sistema paralelo de WhatsApp/media.
- No permitir que el LLM controle account_id, tenant o credenciales.
- No exponer secretos.
- No implementar escritura en el ERP.

## Stop conditions
Detener la implementación y reportar si:
- la arquitectura real contradice de forma importante estos documentos;
- falta una dependencia crítica;
- los documentos del ERP no coinciden con el código real;
- una modificación necesaria puede causar una regresión amplia;
- no es posible identificar de forma segura el account_id de una conversación.

No improvisar una solución global en esos casos.
