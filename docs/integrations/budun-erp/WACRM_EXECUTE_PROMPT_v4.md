# WACRM — INSTRUCCIÓN DE EJECUCIÓN v4

## NO EJECUTAR HASTA AUTORIZACIÓN

Este documento queda guardado para la ejecución futura.

## CUANDO SE AUTORICE

Desde la raíz del proyecto WACRM:

### 1. Leer:

`docs/integrations/budun-erp/README.md`

### 2. Leer:

`docs/integrations/budun-erp/WACRM_ERP_CATALOG_INTEGRATION_SPEC_v4.md`

### 3. Ejecutar siguiendo:

`docs/integrations/budun-erp/WACRM_IMPLEMENTATION_PROMPT_v4.md`

## ORDEN OBLIGATORIO

1. Leer documentos.
2. Auditar código real.
3. Confirmar compatibilidad.
4. Implementar framework multi-provider.
5. Implementar provider Budun.
6. Implementar Generic Catalog Tools.
7. Implementar integración por tenant.
8. Implementar secrets.
9. Implementar tool-calling.
10. Integrar media con WhatsApp.
11. Tests.
12. Smoke.
13. Regresión.
14. Documentación.
15. Commit.
16. DETENERSE.

## RESTRICCIONES

No:
- crear Tools específicas de Budun;
- crear una integración global;
- aceptar `account_id` del LLM;
- revelar IMEI/serial/costo/margen/proveedor;
- almacenar secrets en texto plano;
- implementar escritura en ERP;
- implementar otro provider funcional;
- eliminar la Knowledge Base.

## COMANDO DE INICIO

Lee y comienza por:

`docs/integrations/budun-erp/WACRM_IMPLEMENTATION_PROMPT_v4.md`

La primera acción después de leer los documentos debe ser la auditoría del repositorio. No saltar directamente al código.

Al completar todo el proceso, entrega el reporte final y DETENTE.
