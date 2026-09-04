# WACRM — AI Data Sources + Knowledge Base + Inventory Integration Kit

## Objetivo
Implementar y corregir únicamente el flujo de información que utiliza el AI Agent para responder correctamente usando:

1. Knowledge Base existente.
2. Google Sheets público.
3. CSV remoto o cargado.
4. ERP Catalog API mediante provider/adapter.
5. Media comercial del ERP para envío por WhatsApp.

## Regla de seguridad del alcance
No hacer refactors globales ni rediseñar WACRM completo.

Primero auditar el flujo existente. Modificar solamente los módulos necesarios para:
- lectura y consulta de fuentes de datos;
- tool calling;
- resolución de fuentes;
- integración de catálogo;
- media relacionada con catálogo;
- settings estrictamente necesarios;
- tests y documentación asociados.

No modificar autenticación, conversaciones, WhatsApp, CRM, pagos, usuarios, roles, UI no relacionada ni otros módulos salvo que una dependencia directa sea indispensable.

Antes de modificar un módulo fuera de este alcance, documentar la dependencia y usar la mínima modificación compatible.

## Orden
1. Leer 01_MASTER_EXECUTION.md.
2. Leer 02_SCOPE_AND_GUARDRAILS.md.
3. Leer 03_ARCHITECTURE_AND_RULES.md.
4. Si existen, leer los documentos Budun ERP ya presentes.
5. Auditar el código real.
6. Implementar.
7. Ejecutar pruebas.
8. Reportar cambios y detenerse.

No inventar APIs internas ni reemplazar arquitectura existente sin necesidad.
