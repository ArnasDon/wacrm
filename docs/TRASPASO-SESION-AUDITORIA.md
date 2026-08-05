# TRASPASO DE SESIÓN — Auditoría integral del fork WACRM + correcciones aplicadas

**Fecha:** 2026-08-05 · **Repo:** `/home/daniel/Escritorio/wacrm` · **HEAD:** `615560f` (build(landing): regenerar static tras reinstalar deps)
**Autor del traspaso:** instancia de auditoría (orquestador opencode, modelo deepseek-v4-flash-free)
**Destinatario:** instancia que continúa (trabajando en analytics / Revenue Engine) + dueño del repo.

> ⚠️ **DOS instancias trabajaron en paralelo sobre este repo.** Este documento separa claramente:
> - **SECCIÓN A** — qué auditó y corrigió ESTA instancia (landing, seguridad endpoints, migraciones 049/051)
> - **SECCIÓN B** — trabajo que la OTRA instancia dejó en el working tree (analytics/CAPI/email — NO tocar, ya está)
> - **SECCIÓN C** — qué falta para cerrar (coordinar migraciones, aplicar a BD, fase 7)
>
> La regla de oro para quien continúe: **verificar con context7 antes de afirmar sintaxis técnica, citar archivo:línea en hallazgos, nunca inventar datos, y NO pisar los archivos de la otra instancia listados en la Sección B.**

---

## 1. Resumen ejecutivo

El fork de WACRM (basado en el core 001-037 del CRM original) **no es un frankenstein**, pero el fork (038-047) **fractura la disciplina del core en 4 frentes**: atribución rota en producción, build de Docker roto (ya resuelto por commits posteriores), seguridad en endpoints anónimos, y módulo analytics con escrituras sin lecturas (dark data).

**El bug más grave que existía:** la landing generaba leads pero fallaba silenciosamente en el 100% de los submits (`landingBase` ReferenceError) y no registraba atribución (`data-no-track`). Ambos fueron corregidos en esta sesión (Sección A).

Los 8 hallazgos sometidos a verificación adversarial salieron **todos CONFIRMADOS**.

---

## 2. Cómo se realizó la auditoría (metodología)

### 2.1 Origen
La auditoría fue iniciada originalmente en Claude Code (workflow `auditoria-wacrm-fork-wf_57376ed1-041.js`, 217 líneas, 3 fases, 9 agentes) antes de quedarse sin créditos. Esta sesión la replicó en opencode usando subagentes de tipo `plan` (solo lectura, NUNCA modifican archivos).

### 2.2 Proceso en 6 pasos
1. **Pre-flight** — context7 para verificar sintaxis/APIs antes de afirmar nada; plan escrito; schema del output definido.
2. **Evaluación de dominio** — delegación a subagente `plan` para explorar (nunca grep/read directo del orquestador en tareas de 2+ archivos).
3. **Contrato por subagente** — contexto compartido + rol calibrado + schema JSON exacto del output + quality gates (evidencia real archivo:línea, sin invención).
4. **7 especialistas en paralelo** (un subagente por dominio): landing/CRO, seguridad, devops, UI/i18n, SEO/SEM, calidad BD, arquitectura. Cada uno devolvió hallazgos estructurados JSON con evidencia literal.
5. **Verificación adversarial** — 8 hallazgos P0/P1 se refutaron contra el código real con subagentes independientes. Veredictos: CONFIRMED/PARTIAL/REFUTED. Todos CONFIRMED.
6. **Síntesis + decisión** — el ORQUESTADOR (no los subagentes) cruzó dominios, priorizó (P0 primero) y ejecutó las correcciones (Sección A). Los subagentes nunca editaron.

### 2.3 Verificación de cada cambio
- Typecheck (`pnpm typecheck`) EXIT 0 tras cada lote.
- Tests (`pnpm test`): 730/736 pasan; los 6 fallos son de módulos de la OTRA instancia (email/send, messages i18n, date-utils) — NO de esta sesión.
- Build de la landing (`pnpm build` en `landing/`) + verificación del artefacto compilado `public/landing/`.
- Prettier: se aplicó solo a los archivos propios; se evitó reformatear archivos con estilo pre-existente divergente (ver nota en Sección A, P2-templates).

---

## 3. Hallazgos de la auditoría (resumen consolidado, 7 dominios)

### 🔴 P0 — Críticos confirmados (acción inmediata)
| # | Hallazgo | Evidencia | Estado |
|---|----------|-----------|--------|
| 1 | **Funnel de landing roto** (doble bug): `landingBase` ReferenceError en submit + `data-no-track` anula atribución | `landing/src/components/LeadForm.astro:21,181`; `src/lib/analytics/god.ts:112`; artefacto `public/landing/index.html:4` | ✅ CORREGIDO (A) |
| 2 | `/api/events` y `/api/track` públicos sin rate-limit, con service-role, payload jsonb sin tope | `src/app/api/events/route.ts:25-81`; `src/app/api/track/route.ts:19-68`; `src/lib/analytics/track-event-schema.ts:60` | ✅ CORREGIDO (A) |
| 3 | Dockerfile no construía (`ERR_PNPM_OUTDATED_LOCKFILE`) | `Dockerfile:8-9` + `pnpm-workspace.yaml:3-8` + lockfile importers 124/142 | ⏭️ **OBSOLETO**: HEAD 615560f ya copia `pnpm-workspace.yaml`; reproducido → EXIT 0 |
| 4 | Trigger `_deal_on_interaction` `SECURITY DEFINER` sin tenencia (rama calls; también rama messages) | `supabase/migrations/047_analytics.sql:377-448` (ramas 390-396 y 422-428) | ✅ CORREGIDO en archivo 049 (pendiente aplicar BD) |
| 5 | `transition_deal` valida stage solo por id + `stage_id ON DELETE CASCADE` (046) → cross-tenant | `047_analytics.sql:285-288`; `046_deals_fk_consistency.sql:19-23` | ✅ CORREGIDO en archivo 049 (pendiente aplicar BD) |

### 🟠 P1 — Altos confirmados
| # | Hallazgo | Evidencia | Estado |
|---|----------|-----------|--------|
| 6 | `tracking_events` write-only; VIEW `deal_evidence` prometida en docs nunca creada | `docs/analytics.md:469,559`; 0 `CREATE VIEW` en supabase/ | ⏳ PENDIENTE (otra instancia/owner) |
| 7 | `guard_rules` rota por construcción (exige event_types que el CHECK ya no incluye) | `047_analytics.sql:90-91` vs `290-317` | ⏳ PENDIENTE |
| 8 | Placeholders indexables en home pública ("Tu Clínica", tel. falso, stats ficticias) | `landing/src/data/site.ts:1-20` | ✅ Mitigado (A): noindex+robots+OG+canonical; datos reales quedan TODO |
| 9 | Cero conversiones a plataformas (gtag/Meta CAPI/Google Ads) | grep 0 en src/; `god.ts:115-117` dataLayer sin listener | ⏳ La OTRA instancia adelantó `src/lib/analytics/meta-capi.ts` |
| 10 | `ON DELETE CASCADE` en `conversations.contact_id` (001:143) vs anti-CASCADE en 004:13-16 | `001_initial_schema.sql:143` | ⏳ PENDIENTE |
| 11 | Env vars del fork sin documentar (`TELNYX_WEBHOOK_PUBLIC_KEY`, `LANDING_ACCOUNT_ID`) | `src/lib/telnyx/webhook-signature.ts:14`; `src/lib/analytics/landing-account.ts:21` | ✅ CORREGIDO (A) en `.env.local.example` |
| 12 | 4 implementaciones de envío WhatsApp duplicadas | `src/lib/whatsapp/send-message.ts:1-19` + `automations/meta-send.ts:19-24` + `flows/meta-send.ts:23-28` + `broadcasts/broadcast-core.ts:263-288` | ⏳ Fase 7 (ver Sección C) |

### 🟡 P2/P3 destacados
- **i18n rota en el fork**: `/calls`, `/email` en inglés hardcodeado; ActivityFeed genera texto EN desde el server (`src/lib/dashboard/queries.ts:321-395`); builder renderiza `steps.send_sms` crudo. *(OJO: la otra instancia ya tocó `messages/*.json`)*
- **Idempotencia rota** en 038 (trigger), 040 (2 triggers), 046 (DROP CONSTRAINT sin IF EXISTS) → ✅ CORREGIDO (A).
- **Webhook Resend stub** sin firma Svix (`src/app/api/email/webhook/route.ts:13-23`).
- **Cron de automations sin aislamiento por fila** (un error aborta el lote; filas quedan 'running').
- `conversations.assigned_agent_id` sin FK + 3 convenciones de "agente" (`001:145`, `027:95`).
- `message_templates` UNIQUE por `user_id` nunca rescoped a `account_id` (`014:190-191` + TODO en `submit/route.ts:68-72`) → ✅ CORREGIDO (A, migración 051).
- **First-touch no preservado** (cada visita pisa utm/click_ids — atribución efectiva last-touch) → `src/lib/analytics/attribution.ts:87-97`.
- Cron sweeps manuales duplicados (automations + flows) con `AUTOMATION_CRON_SECRET` compartido.
- Arquitectura: doble ingesta `/api/track` vs `/api/events` (upsert casi idéntico); `/api/email/send` muerta (solo comentario en `email-templates-manager.tsx:36`); dependencia invertida `lib/automations/engine.ts:33` → `@/hooks/use-broadcast-sending` ('use client'); `flows/admin-client.ts:1-16` duplica singleton vs re-export de `telnyx/admin-client.ts:1-5`; `god.ts:26-35` `utmGetItem` código muerto + TTL reimplementado en `landing/src/scripts/wa-ref.ts:6-17`.

### ✅ Fortalezas confirmadas (NO tocar)
- RLS multi-tenant ejemplar (patrón `is_account_member`).
- Webhooks Meta (HMAC) y Telnyx (Ed25519) con firma verificada y fail-closed.
- API keys con hash SHA-256 + scopes + rate-limit.
- Dedup por `event_id` UNIQUE + zod en endpoints.
- 047 respeta patrón SECURITY DEFINER + search_path.
- Rate-limiting centralizado en `lib/rate-limit.ts`.
- i18n del core con test de paridad (1535 claves × 3 locales).
- noindex global del app Next + CWV impecable en la landing.

---

## SECCIÓN A — Correcciones aplicadas por ESTA instancia (13 archivos + 3 nuevos)

> Todo verificado: typecheck EXIT 0, tests rate-limit 7/7, build landing OK, prettier OK en archivos propios.

### A1. P0-1 Landing rota → CORREGIDO
- `landing/src/components/LeadForm.astro`:
  - quitado `data-no-track` del `<form id="lead-form">` (línea 21) → `god.ts:112` vuelve a rellenar los hidden fields (utm, click_ids, ref_code, visitor_id) en cada submit.
  - `<script>` → `<script define:vars={{ landingBase }}>` (línea ~100) → inyecta la variable del frontmatter al bundle cliente (verificado con context7: /withastro/docs, directives-reference).
- Rebuild: `public/landing/index.html` regenerado → verificado: `const landingBase = "/landing";` presente, 0 residuales de `data-no-track`.

### A2. P0-2 Rate-limit + payload acotado → CORREGIDO
- `src/lib/analytics/track-event-schema.ts`: `payloadSchema` de `z.record(z.string(), z.unknown())` sin tope → acotado (máx 24 claves, claves ≤64 chars, valores string ≤2000 chars, serializado ≤16KB) + `phoneSchema` E.164/nacional (regex `^\+[1-9]\d{6,14}$|^\d{7,15}$`).
- `src/lib/rate-limit.ts`: +2 budgets en `RATE_LIMITS`: `trackingPublic` (120/min/IP) y `trackingFormSubmit` (10/min/IP).
- `src/app/api/events/route.ts`: `getClientIp` (patrón de `invitations/[token]/peek/route.ts:45-51`) + rate-limit antes de tocar BD + bucket estrecho `trackingFormSubmit` para `form_submit`.
- `src/app/api/track/route.ts`: mismo `getClientIp` + rate-limit.

### A3. P1-4/5 Tenencia en triggers → CORREGIDO (archivo nuevo, NO aplicado a BD)
- **NUEVO** `supabase/migrations/049_tenancy_guards.sql` (idempotente, CREATE OR REPLACE + DROP TRIGGER IF EXISTS):
  - `transition_deal`: stage destino validado por `(pipeline.account_id = v_deal.account_id)` (JOIN con pipelines), no solo por id.
  - `_deal_on_interaction` rama messages: `JOIN conversations c ON c.id = d.conversation_id AND c.account_id = d.account_id`.
  - `_deal_on_interaction` rama calls: `AND d.account_id = new.account_id`.
  - Triggers `trg_deal_score_on_message` / `trg_deal_score_on_call` recreados.
- Verificación estructural: `conversations.account_id` (017:180), `calls.account_id` (039:26), `pipelines.account_id` (017:183) existen.

### A4. P1-8 SEO placeholders → MITIGADO (datos reales quedan TODO del dueño)
- `landing/src/data/site.ts`: +flag `indexable: false` (con TODO: pasar a true solo cuando el fork se despliegue con datos reales).
- `landing/src/layouts/BaseLayout.astro`: `<meta name="robots" content="noindex, nofollow">` condicional + OG tags (`og:title/description/site_name/url`) + `twitter:card` + `<link rel="canonical">`.
- **NUEVO** `landing/public/robots.txt`: `Disallow: /` (con comentario de cuándo invertir).
- Rebuild → artefacto verificado (noindex, OG, canonical, robots presentes).

### A5. P2 `message_templates` rescope → CORREGIDO (archivo nuevo, NO aplicado a BD)
- **NUEVO** `supabase/migrations/051_message_templates_account_scoped.sql` (renombrado desde 050 por colisión — ver Sección C):
  - Chequeo de duplicados bajo `(account_id, name, language)` (patrón de 014: falla con mensaje accionable).
  - `DROP INDEX IF EXISTS message_templates_user_name_language_key` + `CREATE UNIQUE INDEX ... message_templates_account_name_language_key`.
- `src/app/api/whatsapp/templates/submit/route.ts`: `onConflict: 'user_id,name,language'` → `'account_id,name,language'` + comentarios actualizados. Diff mínimo (5+/8-).
- Verificado: webhook (`template-webhook.ts:134-138`) usa `.update()` por `meta_template_id`; sync (`sync/route.ts:243-247`) busca por `(account_id,name,language)` — ninguno depende del índice legacy.

### A6. P2 Idempotencia de migraciones → CORREGIDO
- `supabase/migrations/038_telnyx_config.sql`: +`DROP TRIGGER IF EXISTS set_updated_at ON telnyx_config;` antes del CREATE TRIGGER.
- `supabase/migrations/040_email.sql`: ídem para `email_config` y `email_templates`.
- `supabase/migrations/046_deals_fk_consistency.sql`: `DROP CONSTRAINT` → `DROP CONSTRAINT IF EXISTS` (2 lugares).
- Verificado que `update_updated_at_column()` existe en `001:344` (el grep transformaba el nombre; confirmado por lectura directa).

### A7. P2 Env vars documentadas → CORREGIDO
- `.env.local.example`: +`TELNYX_WEBHOOK_PUBLIC_KEY` (base64 Ed25519, fail-closed si falta, `webhook-signature.ts:14`) y `LANDING_ACCOUNT_ID` (fallback = primera cuenta por created_at, `landing-account.ts:21-39`).

### A8. Nota operativa (error propio revertido)
- `prettier --write` reformateó `submit/route.ts` entero (142 líneas de ruido). Se revirtió a HEAD y se reaplicaron solo las 2 ediciones funcionales. **El archivo YA fallaba prettier en HEAD (estilo sin punto y coma pre-existente) — no fue introducido por esta sesión; no reformatearlo de nuevo para no pisar el estilo ajeno.**

---

## SECCIÓN B — Trabajo de la OTRA instancia (NO tocar, ya en el working tree)

La otra instancia trabaja en **analytics / Revenue Engine (Fase 2 Mautic)**. Estos archivos están modificados o nuevos en el working tree y NO son de esta sesión:

**Modificados:** `messages/en.json`, `messages/es.json`, `messages/ko.json`, `src/app/(dashboard)/pipelines/page.tsx`, `src/app/api/email/send/route.test.ts`, `src/app/api/email/send/route.ts`, `src/app/api/email/webhook/route.test.ts`, `src/app/api/email/webhook/route.ts`, `src/app/api/whatsapp/webhook/route.ts`, `src/components/layout/sidebar.tsx`, `src/components/pipelines/deal-form.tsx`, `src/components/pipelines/pipeline-analytics.tsx`, `src/lib/automations/engine.ts`, `src/lib/automations/trigger-meta.ts`, `src/lib/email/send.ts`, `src/types/index.ts`, `public/landing/thank-you/index.html` (regenerado por el build de esta sesión, sin conflicto).

**Nuevos (untracked):** `src/app/(dashboard)/reports/page.tsx`, `src/app/api/automations/queue/route.ts`, `src/app/api/deals/[id]/reactivate/route.ts`, `src/app/api/report/[tab]/route.ts`, `src/lib/analytics/meta-capi.ts`, `src/lib/automations/queue.ts`, `src/lib/pipelines/state-machine.test.ts`, `src/lib/pipelines/state-machine.ts`, `src/lib/reporting/queries.ts`, `supabase/migrations/048_email_webhook.sql`, `supabase/migrations/050_frequency_queue.sql`.

**Tests que fallan (6, todos de la otra instancia, NO de esta sesión):**
- `src/app/api/email/send/route.test.ts` (2) — espera 200/400, recibe 500 (work-in-progress de email/send).
- `src/i18n/messages.test.ts` (2) — paridad de catálogo rota (están editando `messages/*.json`).
- `src/lib/dashboard/date-utils.test.ts` (2) — labels `DOW_SHORT_MON_FIRST` (ligado a messages).

---

## SECCIÓN C — Qué falta para cerrar (pendientes priorizados)

### C1. ⚠️ INMEDIATO — Colisión de numeración de migraciones (ya resuelta en disco, verificar al commitear)
- La otra instancia creó `050_frequency_queue.sql` (Fase 2 Mautic) y esta sesión había creado `050_message_templates_account_scoped.sql`.
- **Resuelto:** el de esta sesión fue renombrado a `051_message_templates_account_scoped.sql` y sus referencias actualizadas (`submit/route.ts` comenta "migration 051").
- Orden final correcto: `048_email_webhook.sql` (otra) → `049_tenancy_guards.sql` (esta) → `050_frequency_queue.sql` (otra) → `051_message_templates_account_scoped.sql` (esta).
- **Al commitear, respetar este orden.** No renumerar archivos.

### C2. Aplicar migraciones 049 y 051 a la BD
- Ambas están como archivos listos, **NO aplicadas** (por coordinación con la otra instancia).
- Aplicar con supabase CLI (`supabase db push`) o coordinar para que una sola instancia las aplique. OJO: si la otra instancia aplica `050_frequency_queue.sql`, debe aplicar 049 y 051 en el mismo `db push`.
- 049 es **aditiva y no rompe nada** (redefine funciones con tenencia + recrea triggers). 051 requiere que no existan duplicados `(account_id,name,language)` en `message_templates` (falla con mensaje claro si los hay — borrar y reintentar).

### C3. Fase 7 (última, SOLO cuando la atribución funcione end-to-end)
- **Meta CAPI**: la otra instancia ya adelantó `src/lib/analytics/meta-capi.ts`. Conectar usando el `event_id` ya generado por god.ts. NO duplicar el trabajo.
- **Consolidar los 4 senders WhatsApp** en uno solo (`src/lib/whatsapp/send-message.ts` como canónico). Regla del dueño: NO hacer esto antes de que la atribución end-to-end funcione (el fix A1 ya la habilita — verificar con un submit real).

### C4. Resto de pendientes P1/P2 (sin dueño asignado)
- VIEW `deal_evidence` prometido en `docs/analytics.md:469,559` — crearlo o corregir la doc.
- `guard_rules` rota (047:90-91 vs 290-317).
- `ON DELETE CASCADE` en `conversations.contact_id` (001:143) vs SET NULL (004).
- First-touch en `attribution.ts:87-97`.
- Webhook Resend con firma Svix.
- Cron de automations con try/catch por fila.
- `assigned_agent_id` sin FK.
- i18n de `/calls`, `/email`, ActivityFeed (`queries.ts:321-395`) — **coordinar con la otra instancia, está tocando messages/*.**
- Refactors KISS: doble ingesta `/api/track` vs `/api/events`; `/api/email/send` muerta; `engine.ts:33` dependencia invertida; `flows/admin-client.ts` → re-export; borrar `utmGetItem` muerto (god.ts:26-35).

### C5. Verificación final antes de commitear
```bash
pnpm typecheck            # EXIT 0
pnpm test                 # esperado: 730/736 (6 fallos = otra instancia)
pnpm build                # next build
cd landing && pnpm build  # regenera public/landing
```

---

## 4. Decisiones del dueño registradas (no debatir)
1. **KISS / "usar lo que ya existe"** — 1 tabla nueva (`tracking_events`), columnas aditivas, cero motores nuevos. Filosofía DAD v8.
2. **Fase 7 (CAPI/consolidación senders) va al FINAL** — después de que la atribución funcione end-to-end. "Corregir todo antes de fase 7."
3. **La landing no es una clínica real** — placeholders de `site.ts` quedan como TODO; se mitiga con noindex (A4).
4. **pnpm SIEMPRE** para paquetes (nunca npm/bun) — regla de seguridad supply chain.
5. **Subagentes solo recopilan datos** — nunca editan ni deciden; el orquestador sintetiza/decide/ejecuta.
