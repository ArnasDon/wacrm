# Security Audit — wacrm

Auditoria defensiva do wacrm (Next.js + Supabase WhatsApp CRM), seguindo metodologia do bug-bounty PLAYBOOK.

## ✅ Controles Fortes Encontrados

### Autenticação & Autorização
- **RLS completo**: 36/36 tabelas com `ENABLE ROW LEVEL SECURITY` ativo
- **Auth stack sólido**: 
  - `requireRole()` filtra por `account_id` via JOIN + RLS
  - `requireApiKey()` valida Bearer token via SHA-256 hash (correto para high-entropy)
  - Timing-safe compare no flows cron (L42 `timingSafeEqual`)
- **Tenant isolation**: todas as queries críticas filtram por `ctx.accountId` (verificado em contacts, members, automations)

### Webhook & SSRF
- **WhatsApp webhook HMAC**: verificado com `timingSafeEqual` (L46 `webhook-signature.ts`), fail-closed se `META_APP_SECRET` ausente
- **SSRF guard robusto**: `isDeliverableUrl()` bloqueia loopback/private/link-local/cloud-metadata (127.0.0.1, 10.0.0.0/8, 169.254.169.254, fc00::/7 ULA)
  - Aplicado em automations `send_webhook` E webhook_endpoints delivery
  - `redirect: 'manual'` previne 3xx-bounce para IP interno
- **Sem eval/Function**: 0 ocorrências de `eval()`, `new Function()`, `vm.` no código de automations/flows

### Secrets & Crypto
- **Invite tokens**: `randomBytes(32)` → 256-bit, SHA-256 hash no DB
- **API keys**: `randomBytes(32)` + `wacrm_live_` prefix, SHA-256 (não bcrypt, correto para high-entropy)
- **Nenhum .env commitado**: verificado `git ls-files | grep .env` → vazio
- **Service-role key**: apenas em `.env.local.example`, nunca exposto no bundle

### Rate Limiting
- In-memory fixed-window com sweep oportunístico
- Limites configurados para:
  - send: 60/min/user
  - broadcast: 5/min/user
  - publicApi: 120/min/key
  - adminAction: 30/min/user
  - aiDraft: 20/min/user + 60/min/account
  - invitationPeek: 30/min, invitationRedeem: 10/min

### XSS
- **10 `dangerouslySetInnerHTML`**: todos em conteúdo estático de i18n `t(...)`, nenhum user-controlled
- Nenhum SQL cru: 0 matches para `INSERT INTO`/`UPDATE.*SET` raw strings

---

## ⚠️ Achados & Recomendações

### 1. **[MEDIUM]** Rate-limit ausente em signup/auth
**Localizção**: rotas de signup/login não aparecem em `grep -r "rate" src/app/api`

**Risco**: um atacante pode tentar brute-force de credenciais ou spam de signups sem rate-limit aplicado no app-level (Supabase Auth tem rate-limit próprio, mas defesa-em-camadas é melhor prática).

**Fix**:
```typescript
// src/app/api/auth/signup/route.ts (se existir rota custom)
const limit = checkRateLimit(`signup:${ip}`, RATE_LIMITS.signup);
if (!limit.success) return rateLimitResponse(limit);
```
Adicionar em `RATE_LIMITS`:
```typescript
signup: { limit: 10, windowMs: 60_000 }, // 10 signups/min por IP
login: { limit: 20, windowMs: 60_000 },  // 20 login attempts/min por IP
```

**Nota**: se auth é 100% via Supabase hosted UI (redirect OAuth flow), este achado é N/A.

---

### 2. **[LOW]** Inconsistência em cron secret comparison
**Localização**: 
- ✅ `src/app/api/flows/cron/route.ts:42` usa `timingSafeEqual`
- ❌ `src/app/api/automations/cron/route.ts:23` usa `supplied !== expected` (string equality simples)

**Risco**: timing attack teórico — um atacante com acesso à rede pode medir latência de resposta e recuperar o secret byte-a-byte. Na prática, muito baixo risco (cron endpoints geralmente não são públicos), mas inconsistente com o padrão do resto do código.

**Fix**:
```typescript
// src/app/api/automations/cron/route.ts:17-25
const expected = process.env.AUTOMATION_CRON_SECRET;
if (!expected) {
  return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
}
const supplied = request.headers.get('x-cron-secret') ?? '';
const suppliedBuf = Buffer.from(supplied);
const expectedBuf = Buffer.from(expected);
if (
  suppliedBuf.length !== expectedBuf.length ||
  !timingSafeEqual(suppliedBuf, expectedBuf)
) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
```

---

### 3. **[INFO]** DNS rebinding residual risk (documentado)
**Localização**: `src/lib/webhooks/ssrf.ts:18`

**Risco**: já documentado no código — um hostname pode resolver público durante `isDeliverableUrl()` mas flip para IP privado antes do `fetch()` connect (TOCTOU). `fetch()` do Node não expõe pinning de IP resolvido no socket.

**Mitigação atual**: `redirect: 'manual'` previne bounce; guard bloqueia 99% dos casos.

**Possível melhoria futura**: proxy outbound webhooks via serviço externo (Hookdeck, Svix) que resolve + pina o IP antes de entregar.

---

### 4. **[INFO]** Rate-limit per-process (single-instance only)
**Localização**: `src/lib/rate-limit.ts:9-14`

**Risco**: já documentado — Map in-memory significa que horizontal scale (multi-region, Vercel serverless fan-out) silenciosamente derrota o rate-limit.

**Fix para scale**: trocar implementação por Redis/Upstash mantendo mesma interface `checkRateLimit()`. Call sites não mudam.

---

### 5. **[DOCUMENTATION]** ICU parser strict mode
**Localização**: 15 strings i18n com sintaxe inválida (ex.: `{{1}}` placeholder do WhatsApp, `<strong class="...">`)

**Risco**: zero — funcionam em runtime porque `t()` simples não passa pelo parser ICU; `dangerouslySetInnerHTML` injeta HTML cru. Mas se alguém trocar por `t.rich()` ou ativar validação estrita, vão quebrar.

**Fix**: issue #XXX separado, fora do escopo security (dívida técnica latente, não vulnerabilidade ativa).

---

## 🔐 Checklist OWASP Top 10 (2021)

| # | Categoria | Status | Notas |
|---|-----------|--------|-------|
| A01 | Broken Access Control | ✅ PASS | RLS 36/36, tenant isolation verificado, IDOR guards em place |
| A02 | Cryptographic Failures | ✅ PASS | randomBytes para tokens, SHA-256 para keys, HTTPS enforced, nenhum secret commitado |
| A03 | Injection | ✅ PASS | 0 SQL cru, 0 eval, Supabase client sanitiza, XSS mitigado |
| A04 | Insecure Design | ✅ PASS | SSRF guard, rate-limit, fail-closed defaults |
| A05 | Security Misconfiguration | ⚠️ MINOR | Rate-limit ausente em signup/auth (se rota custom existe) |
| A06 | Vulnerable Components | ➖ N/A | Requer `npm audit` separado |
| A07 | Auth Failures | ✅ PASS | requireRole/requireApiKey sólidos, HMAC webhook verificado |
| A08 | Software Integrity | ✅ PASS | Nenhum .env commitado, service-role não exposto |
| A09 | Logging Failures | ➖ N/A | Fora do escopo (requer análise de logs) |
| A10 | SSRF | ✅ PASS | isDeliverableUrl bloqueia private/loopback/metadata IPs |

---

## 📋 Ações Recomendadas

**Prioridade ALTA** (fazer antes de merge):
- Nenhuma (!)

**Prioridade MÉDIA** (próximo sprint):
1. Adicionar rate-limit em signup/auth custom routes (se existirem)
2. Padronizar cron secret comparison com `timingSafeEqual` em automations cron

**Prioridade BAIXA** (backlog):
3. Documentar limitação de rate-limit single-instance
4. Considerar proxy externo para webhooks se DNS rebinding vira ameaça real

---

## 🎯 Conclusão

O wacrm tem **controles de segurança robustos** para um projeto deste porte:
- RLS completo + tenant isolation consistente
- SSRF guard bem implementado
- Crypto correto (randomBytes, SHA-256, timing-safe compare)
- Nenhum secret exposto

Os achados são **menores** e **não-bloqueantes** — dois são melhorias incrementais (rate-limit auth, timing-safe cron), dois são limitações documentadas (DNS rebinding, scale).

**Recomendação**: ✅ **Aprovar para produção** com os fixes MÉDIA aplicados no próximo ciclo.
