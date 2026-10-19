@AGENTS.md
@docs/SANDIA_diagnostico_tecnico.md

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## Flujo de trabajo (sesiones en la nube y remotas)

Cada push a `main` despliega a producción (webhook de EasyPanel). Por eso:

1. Trabaja siempre en una rama nueva; nunca hagas push directo a `main`.
2. Antes de abrir el PR, valida todo: `npm run typecheck`, `npx eslint <archivos tocados>`, `npm run build`, `npm test`, y confirma que `package-lock.json` no cambió. Fallos que ya existían en `date-utils.test.ts` (`mondayIndex`/zona horaria) no son causados por tu cambio; cualquier otro fallo bloquea.
3. Abre el PR con un resumen corto en español de qué cambia y cómo se validó.
4. **Pregúntale a Angel si hace el merge y espera su "sí" explícito en el chat.** Un "deploy" o "hazlo" anterior no cuenta para este merge.
5. Con el sí, haz el merge del PR (squash). Luego verifica producción (`https://sandia-sandia-crm.kmencc.easypanel.host`): si existe `EASYPANEL_TOKEN`, consulta el estado del deploy y sus logs por la API; si no, usa `curl` a la ruta afectada. El deploy puede tardar ~10 min; ten paciencia antes de declararlo roto.
6. Agrega la entrada del día en `docs/SANDIA_plan_de_desarrollo.md` (por PR, igual que el cambio).
