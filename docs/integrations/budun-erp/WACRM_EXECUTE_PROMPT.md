# WACRM — INSTRUCCIÓN DE EJECUCIÓN

## IMPORTANTE

Este archivo es el que debe ejecutar Claude cuando llegue el momento.

### Ejecuta primero:

`docs/integrations/budun-erp/WACRM_IMPLEMENTATION_PROMPT.md`

### Lee también antes de modificar código:

`docs/integrations/budun-erp/WACRM_ERP_INVENTORY_API_INTEGRATION_SPEC.md`

`docs/integrations/budun-erp/README.md`

## ORDEN

1. Lee los tres documentos.
2. Audita el repositorio actual.
3. Verifica que la arquitectura real coincide.
4. Implementa primero la infraestructura genérica multi-provider.
5. Implementa el adapter de `Budun ERP`.
6. Implementa las Generic Catalog Tools.
7. Implementa configuración y credenciales por tenant.
8. Implementa el tool-calling loop.
9. Integra imágenes con WhatsApp.
10. Ejecuta tests/typecheck/lint/build.
11. Ejecuta smoke tests.
12. Documenta.
13. Commit.
14. DETENTE.

## NO HACER

- No crear Tools con nombre Budun.
- No usar credenciales globales.
- No permitir que el LLM controle `account_id`.
- No devolver IMEI/serial/costo/margen/proveedor.
- No implementar escritura en el ERP.
- No implementar otro provider funcional ahora.

## INICIO

En Claude Code, desde la raíz de WACRM, ejecuta/lee:

`docs/integrations/budun-erp/WACRM_IMPLEMENTATION_PROMPT.md`

Empieza el proceso siguiendo exactamente ese archivo.
