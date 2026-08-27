# CHECKLIST DE EJECUCIÓN

## Antes de código
- [ ] Leídos documentos Budun existentes.
- [ ] Auditado AI Agent.
- [ ] Identificado flujo de conversación/sesión.
- [ ] Identificado origen seguro de account_id.
- [ ] Auditado KB.
- [ ] Auditado tool loop.
- [ ] Auditado Google Sheets/CSV actual.
- [ ] Auditado media/engineSendMedia.
- [ ] Auditado RLS y secrets.

## Implementación
- [ ] Data Sources aislados por tenant.
- [ ] Google Sheets/CSV lectura correcta.
- [ ] usage knowledge/catalog/both.
- [ ] Catalog provider interface.
- [ ] BudunProvider.
- [ ] Integration Resolver.
- [ ] Generic Catalog Tools.
- [ ] Whitelist server-side.
- [ ] Precio sin invención.
- [ ] Variante segura.
- [ ] KB preservada.
- [ ] Priority/fallback.
- [ ] Media ERP → engineSendMedia.

## Validación
- [ ] Data Source tests.
- [ ] ERP tests.
- [ ] Agent Playground tests.
- [ ] WhatsApp media tests.
- [ ] typecheck.
- [ ] lint.
- [ ] tests.
- [ ] build.
- [ ] smoke.

## Cierre
- [ ] Documentación.
- [ ] Commit.
- [ ] Reporte final.
- [ ] Detenerse.
