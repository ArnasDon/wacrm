# AI RAG Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add account-scoped RAG grounding, auditable AI runs, and a bounded multi-agent registry to the existing `wacrm` AI agent without replacing the current deterministic CRM execution path.

**Architecture:** The implementation extends the existing Next.js 16 + Supabase + BYOK AI stack. RAG is restored as a new post-`040_custom_field_types.sql` schema because `037_drop_ai.sql` intentionally removed the old AI knowledge tables and RPCs. Multi-agent starts as a coordinator selecting one CRM specialist per event, while all CRM writes continue through backend validation and existing helpers.

**Tech Stack:** Next.js 16 App Router route handlers, Supabase Postgres/RLS/pgvector, TypeScript 6, Vitest 4, existing `generateJson<T>()`, existing encrypted BYOK config, existing automations and WhatsApp/Z-API helpers.

## Global Constraints

- Read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` before implementing any new or modified Next.js route handler.
- Do not add `openai`, `@anthropic-ai/sdk`, LangChain, or Vercel AI SDK dependencies; follow the existing hand-rolled `fetch()` provider pattern.
- Every table, RPC, and query that stores or retrieves customer/knowledge/agent data must be scoped by `account_id`.
- Do not trust any model-returned ID, action name, stage ID, tag ID, user ID, document ID, or chunk ID; validate against account-owned data before writes.
- Keep WhatsApp webhook AI work fire-and-forget; slow RAG or model calls must not block the provider acknowledgement.
- Keep existing deterministic execution helpers as the only way to perform CRM writes.
- Store secrets encrypted with the existing encrypted-key pattern; never return plaintext keys from APIs.
- Preserve current dirty worktree state, including the existing branch `codex/custom-field-types`, its `ahead 1` commit, and untracked `supabase/.temp/`.
- Use `npm run typecheck` and focused `npm test -- <path>` or `npx vitest run <path>` gates after each code task; use full `npm test` and `npm run build` only at the final branch gate.

---

## File Structure

| File | Responsibility |
|---|---|
| `docs/ai-rag-agents-implementation.md` | Human-readable architecture and rollout decisions. |
| `supabase/migrations/041_ai_knowledge_rag.sql` | Knowledge documents/chunks/jobs, AI run logs, retrieval events, agent definitions, and RLS/RPCs. |
| `src/lib/ai/knowledge/chunk.ts` | Deterministic text chunking and normalization. |
| `src/lib/ai/knowledge/chunk.test.ts` | Chunking unit tests. |
| `src/lib/ai/knowledge/embeddings.ts` | OpenAI-compatible embedding generation using `fetch()`. |
| `src/lib/ai/knowledge/embeddings.test.ts` | Embedding adapter tests. |
| `src/lib/ai/knowledge/retrieve.ts` | Hybrid FTS/semantic retrieval and snippet shaping. |
| `src/lib/ai/knowledge/retrieve.test.ts` | Retrieval ranking, dedupe, and tenant argument tests. |
| `src/lib/ai/knowledge/ingest.ts` | Document upsert, chunk replacement, and optional embedding population. |
| `src/lib/ai/knowledge/ingest.test.ts` | Ingestion tests with mocked Supabase calls. |
| `src/app/api/ai/knowledge/route.ts` | List/create knowledge documents for the current account. |
| `src/app/api/ai/knowledge/route.test.ts` | Route tests for auth, validation, and no cross-account inputs. |
| `src/app/api/ai/knowledge/[id]/route.ts` | Update/delete one account-owned knowledge document. |
| `src/app/api/ai/knowledge/[id]/route.test.ts` | Route tests for update/delete. |
| `src/lib/ai/run-log.ts` | AI run, retrieval, and tool-call logging helpers. |
| `src/lib/ai/run-log.test.ts` | Logging helper tests. |
| `src/lib/ai/agent-registry.ts` | Built-in agent role definitions and account override loader. |
| `src/lib/ai/agent-registry.test.ts` | Specialist registry and sanitizer tests. |
| `src/lib/ai/agent-router.ts` | Coordinator routing to one specialist per event. |
| `src/lib/ai/agent-router.test.ts` | Routing tests for known/unknown roles and fallback behavior. |
| `src/lib/ai/agent-context.ts` | Add retrieved knowledge snippets to WhatsApp agent context. |
| `src/lib/ai/agent-decide.ts` | Add knowledge/citation and specialist prompt support to decisions. |
| `src/lib/ai/agent-dispatch.ts` | Record AI runs and execute decisions through existing helpers. |
| `src/lib/ai/agent-context.test.ts` | Updated context tests. |
| `src/lib/ai/agent-decide.test.ts` | Updated sanitizer/citation tests. |
| `src/lib/ai/agent-dispatch.test.ts` | Updated dispatch/logging tests. |
| `src/components/settings/agent-config.tsx` | Link to knowledge and agent-role configuration in existing AI settings. |
| `src/components/settings/knowledge-manager.tsx` | Small admin UI for text knowledge documents. |
| `messages/en.json` | English strings for knowledge and agent-role UI. |
| `messages/ko.json` | Korean strings for knowledge and agent-role UI. |

---

### Task 1: RAG and Agent Observability Schema

**Files:**
- Create: `supabase/migrations/041_ai_knowledge_rag.sql`

**Interfaces:**
- Produces: tables `ai_knowledge_documents`, `ai_knowledge_chunks`, `ai_knowledge_ingestion_jobs`, `ai_runs`, `ai_retrieval_events`, `ai_tool_calls`, `ai_agent_definitions`.
- Produces: RPCs `match_ai_knowledge_fts(uuid, text, integer)` and `match_ai_knowledge_semantic(uuid, text, integer, integer)`.
- Consumed by Tasks 3, 4, 6, 7, 8, and 9.

- [ ] **Step 1: Create the migration**

Create `supabase/migrations/041_ai_knowledge_rag.sql` with:

```sql
-- ============================================================
-- 041_ai_knowledge_rag.sql - RAG grounding, AI run logs, and
-- account-scoped agent definitions.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS knowledge_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS embeddings_model text NOT NULL DEFAULT 'text-embedding-3-small',
  ADD COLUMN IF NOT EXISTS embeddings_api_key_encrypted text;

CREATE TABLE IF NOT EXISTS ai_knowledge_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title text NOT NULL,
  content text NOT NULL,
  source_type text NOT NULL DEFAULT 'manual'
    CHECK (source_type IN ('manual', 'url', 'file', 'api')),
  source_uri text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_knowledge_documents_account
  ON ai_knowledge_documents(account_id, updated_at DESC);

ALTER TABLE ai_knowledge_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_knowledge_documents_select ON ai_knowledge_documents;
CREATE POLICY ai_knowledge_documents_select ON ai_knowledge_documents FOR SELECT
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS ai_knowledge_documents_insert ON ai_knowledge_documents;
CREATE POLICY ai_knowledge_documents_insert ON ai_knowledge_documents FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_knowledge_documents_update ON ai_knowledge_documents;
CREATE POLICY ai_knowledge_documents_update ON ai_knowledge_documents FOR UPDATE
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_knowledge_documents_delete ON ai_knowledge_documents;
CREATE POLICY ai_knowledge_documents_delete ON ai_knowledge_documents FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_ai_knowledge_documents_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ai_knowledge_documents_updated_at ON ai_knowledge_documents;
CREATE TRIGGER trg_ai_knowledge_documents_updated_at
  BEFORE UPDATE ON ai_knowledge_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_ai_knowledge_documents_updated_at();

CREATE TABLE IF NOT EXISTS ai_knowledge_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES ai_knowledge_documents(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  content text NOT NULL,
  token_estimate integer NOT NULL DEFAULT 0,
  fts tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
  embedding vector(1536),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(document_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_ai_knowledge_chunks_account
  ON ai_knowledge_chunks(account_id, document_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_ai_knowledge_chunks_fts
  ON ai_knowledge_chunks USING gin(fts);
CREATE INDEX IF NOT EXISTS idx_ai_knowledge_chunks_embedding
  ON ai_knowledge_chunks USING hnsw (embedding vector_cosine_ops);

ALTER TABLE ai_knowledge_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_knowledge_chunks_select ON ai_knowledge_chunks;
CREATE POLICY ai_knowledge_chunks_select ON ai_knowledge_chunks FOR SELECT
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS ai_knowledge_chunks_write ON ai_knowledge_chunks;
CREATE POLICY ai_knowledge_chunks_write ON ai_knowledge_chunks FOR ALL
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

CREATE TABLE IF NOT EXISTS ai_knowledge_ingestion_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  document_id uuid REFERENCES ai_knowledge_documents(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_ai_knowledge_ingestion_jobs_account_status
  ON ai_knowledge_ingestion_jobs(account_id, status, created_at DESC);

ALTER TABLE ai_knowledge_ingestion_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_knowledge_ingestion_jobs_select ON ai_knowledge_ingestion_jobs;
CREATE POLICY ai_knowledge_ingestion_jobs_select ON ai_knowledge_ingestion_jobs FOR SELECT
  USING (is_account_member(account_id, 'admin'));

CREATE TABLE IF NOT EXISTS ai_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  surface text NOT NULL CHECK (surface IN ('whatsapp_agent', 'automation_copilot', 'knowledge_ingest', 'manual_test')),
  agent_role text NOT NULL DEFAULT 'coordinator',
  provider text,
  model text,
  status text NOT NULL DEFAULT 'started'
    CHECK (status IN ('started', 'completed', 'failed', 'skipped')),
  input_tokens integer,
  output_tokens integer,
  error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_ai_runs_account_created
  ON ai_runs(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_runs_conversation
  ON ai_runs(conversation_id, created_at DESC);

ALTER TABLE ai_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_runs_select ON ai_runs;
CREATE POLICY ai_runs_select ON ai_runs FOR SELECT
  USING (is_account_member(account_id, 'admin'));

CREATE TABLE IF NOT EXISTS ai_retrieval_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ai_run_id uuid REFERENCES ai_runs(id) ON DELETE CASCADE,
  query text NOT NULL,
  retrieval_mode text NOT NULL CHECK (retrieval_mode IN ('fts', 'semantic', 'hybrid')),
  chunk_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  scores jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_retrieval_events_run
  ON ai_retrieval_events(ai_run_id);

ALTER TABLE ai_retrieval_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_retrieval_events_select ON ai_retrieval_events;
CREATE POLICY ai_retrieval_events_select ON ai_retrieval_events FOR SELECT
  USING (is_account_member(account_id, 'admin'));

CREATE TABLE IF NOT EXISTS ai_tool_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ai_run_id uuid REFERENCES ai_runs(id) ON DELETE CASCADE,
  tool_name text NOT NULL,
  arguments jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK (status IN ('proposed', 'executed', 'rejected', 'skipped', 'failed')),
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_tool_calls_run
  ON ai_tool_calls(ai_run_id);

ALTER TABLE ai_tool_calls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_tool_calls_select ON ai_tool_calls;
CREATE POLICY ai_tool_calls_select ON ai_tool_calls FOR SELECT
  USING (is_account_member(account_id, 'admin'));

CREATE TABLE IF NOT EXISTS ai_agent_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  role text NOT NULL,
  name text NOT NULL,
  instructions text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  allowed_actions text[] NOT NULL DEFAULT '{}'::text[],
  knowledge_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(account_id, role)
);

CREATE INDEX IF NOT EXISTS idx_ai_agent_definitions_account
  ON ai_agent_definitions(account_id, role);

ALTER TABLE ai_agent_definitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_agent_definitions_select ON ai_agent_definitions;
CREATE POLICY ai_agent_definitions_select ON ai_agent_definitions FOR SELECT
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_agent_definitions_write ON ai_agent_definitions;
CREATE POLICY ai_agent_definitions_write ON ai_agent_definitions FOR ALL
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.match_ai_knowledge_fts(
  p_account_id uuid,
  p_query text,
  p_match_count integer
)
RETURNS TABLE (id uuid, document_id uuid, content text, rank real) AS $$
  SELECT c.id,
         c.document_id,
         c.content,
         ts_rank(c.fts, plainto_tsquery('simple', p_query)) AS rank
  FROM ai_knowledge_chunks c
  WHERE c.account_id = p_account_id
    AND c.fts @@ plainto_tsquery('simple', p_query)
  ORDER BY rank DESC
  LIMIT GREATEST(p_match_count, 0);
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.match_ai_knowledge_semantic(
  p_account_id uuid,
  p_query_embedding text,
  p_match_count integer
)
RETURNS TABLE (id uuid, document_id uuid, content text, distance real) AS $$
  SELECT c.id,
         c.document_id,
         c.content,
         (c.embedding <=> p_query_embedding::vector(1536)) AS distance
  FROM ai_knowledge_chunks c
  WHERE c.account_id = p_account_id
    AND c.embedding IS NOT NULL
  ORDER BY c.embedding <=> p_query_embedding::vector(1536)
  LIMIT GREATEST(p_match_count, 0);
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.match_ai_knowledge_fts(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_ai_knowledge_fts(uuid, text, integer) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.match_ai_knowledge_semantic(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_ai_knowledge_semantic(uuid, text, integer) TO authenticated, service_role;
```

- [ ] **Step 2: Validate the migration file statically**

Run:

```powershell
Select-String -Path .\supabase\migrations\041_ai_knowledge_rag.sql -Pattern 'DROP TABLE|DROP COLUMN'
```

Expected: no output.

- [ ] **Step 3: Review migration ordering**

Run:

```powershell
Get-ChildItem .\supabase\migrations\*.sql | Sort-Object Name | Select-Object -Last 5 -ExpandProperty Name
```

Expected: output includes `040_custom_field_types.sql` followed by `041_ai_knowledge_rag.sql`.

- [ ] **Step 4: Commit**

Run:

```powershell
git add .\supabase\migrations\041_ai_knowledge_rag.sql
git commit -m "feat(ai): add rag and agent observability schema"
```

Expected: commit succeeds. If there are pre-existing unrelated changes, stage only this migration.

---

### Task 2: Deterministic Knowledge Chunking

**Files:**
- Create: `src/lib/ai/knowledge/chunk.ts`
- Create: `src/lib/ai/knowledge/chunk.test.ts`

**Interfaces:**
- Produces: `normalizeKnowledgeText(input: string): string`
- Produces: `chunkKnowledgeText(input: string, opts?: { maxChars?: number; overlapChars?: number }): KnowledgeChunk[]`
- Produces: `KnowledgeChunk = { chunkIndex: number; content: string; tokenEstimate: number }`
- Consumed by Task 4.

- [ ] **Step 1: Write the failing test**

Create `src/lib/ai/knowledge/chunk.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { chunkKnowledgeText, normalizeKnowledgeText } from './chunk'

describe('normalizeKnowledgeText', () => {
  it('normalizes whitespace without losing paragraph boundaries', () => {
    expect(normalizeKnowledgeText(' A  B\r\n\r\n C\tD ')).toBe('A B\n\nC D')
  })
})

describe('chunkKnowledgeText', () => {
  it('returns no chunks for blank input', () => {
    expect(chunkKnowledgeText('   ')).toEqual([])
  })

  it('creates stable indexed chunks with token estimates', () => {
    const chunks = chunkKnowledgeText('Alpha beta gamma.\n\nDelta epsilon zeta.', {
      maxChars: 24,
      overlapChars: 6,
    })

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0]).toMatchObject({ chunkIndex: 0 })
    expect(chunks.every((chunk, index) => chunk.chunkIndex === index)).toBe(true)
    expect(chunks.every((chunk) => chunk.content.length <= 24)).toBe(true)
    expect(chunks.every((chunk) => chunk.tokenEstimate > 0)).toBe(true)
  })

  it('rejects invalid chunk options', () => {
    expect(() => chunkKnowledgeText('hello', { maxChars: 10, overlapChars: 10 })).toThrow(
      'overlapChars must be smaller than maxChars',
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npx vitest run src/lib/ai/knowledge/chunk.test.ts
```

Expected: FAIL because `src/lib/ai/knowledge/chunk.ts` does not exist.

- [ ] **Step 3: Implement chunking**

Create `src/lib/ai/knowledge/chunk.ts`:

```ts
export interface KnowledgeChunk {
  chunkIndex: number
  content: string
  tokenEstimate: number
}

const DEFAULT_MAX_CHARS = 1200
const DEFAULT_OVERLAP_CHARS = 160

export function normalizeKnowledgeText(input: string): string {
  return input
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n\n')
    .map((paragraph) => paragraph.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n')
}

export function chunkKnowledgeText(
  input: string,
  opts: { maxChars?: number; overlapChars?: number } = {},
): KnowledgeChunk[] {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS
  const overlapChars = opts.overlapChars ?? DEFAULT_OVERLAP_CHARS

  if (maxChars < 20) throw new Error('maxChars must be at least 20')
  if (overlapChars < 0) throw new Error('overlapChars must be non-negative')
  if (overlapChars >= maxChars) throw new Error('overlapChars must be smaller than maxChars')

  const text = normalizeKnowledgeText(input)
  if (!text) return []

  const chunks: KnowledgeChunk[] = []
  let start = 0

  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length)
    if (end < text.length) {
      const paragraphBreak = text.lastIndexOf('\n\n', end)
      const sentenceBreak = Math.max(text.lastIndexOf('. ', end), text.lastIndexOf('? ', end), text.lastIndexOf('! ', end))
      const whitespaceBreak = text.lastIndexOf(' ', end)
      const candidate = [paragraphBreak, sentenceBreak > -1 ? sentenceBreak + 1 : -1, whitespaceBreak]
        .filter((index) => index > start + Math.floor(maxChars * 0.5))
        .sort((a, b) => b - a)[0]
      if (candidate) end = candidate
    }

    const content = text.slice(start, end).trim()
    if (content) {
      chunks.push({
        chunkIndex: chunks.length,
        content,
        tokenEstimate: Math.max(1, Math.ceil(content.length / 4)),
      })
    }

    if (end >= text.length) break
    start = Math.max(0, end - overlapChars)
  }

  return chunks
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
npx vitest run src/lib/ai/knowledge/chunk.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```powershell
git add .\src\lib\ai\knowledge\chunk.ts .\src\lib\ai\knowledge\chunk.test.ts
git commit -m "feat(ai): add knowledge chunking"
```

---

### Task 3: Embedding Adapter

**Files:**
- Create: `src/lib/ai/knowledge/embeddings.ts`
- Create: `src/lib/ai/knowledge/embeddings.test.ts`

**Interfaces:**
- Consumes: `AiError` from `src/lib/ai/types.ts`.
- Produces: `generateOpenAiEmbedding(args: { apiKey: string; model: string; input: string; timeoutMs?: number }): Promise<number[]>`
- Consumed by Tasks 4 and 5.

- [ ] **Step 1: Write the failing test**

Create `src/lib/ai/knowledge/embeddings.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AiError } from '../types'
import { generateOpenAiEmbedding } from './embeddings'

describe('generateOpenAiEmbedding', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('calls OpenAI embeddings and returns the vector', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }), { status: 200 }),
    )

    await expect(
      generateOpenAiEmbedding({ apiKey: 'sk-test', model: 'text-embedding-3-small', input: 'hello' }),
    ).resolves.toEqual([0.1, 0.2, 0.3])

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/embeddings',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer sk-test' }),
      }),
    )
  })

  it('throws AiError for provider failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('bad key', { status: 401 }))

    await expect(
      generateOpenAiEmbedding({ apiKey: 'bad', model: 'text-embedding-3-small', input: 'hello' }),
    ).rejects.toMatchObject({ code: 'embedding_provider_error' } satisfies Partial<AiError>)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npx vitest run src/lib/ai/knowledge/embeddings.test.ts
```

Expected: FAIL because `embeddings.ts` does not exist.

- [ ] **Step 3: Implement embedding adapter**

Create `src/lib/ai/knowledge/embeddings.ts`:

```ts
import { AiError } from '../types'

const DEFAULT_TIMEOUT_MS = 30_000

export async function generateOpenAiEmbedding(args: {
  apiKey: string
  model: string
  input: string
  timeoutMs?: number
}): Promise<number[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), args.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  let res: Response
  try {
    res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${args.apiKey}`,
      },
      body: JSON.stringify({ model: args.model, input: args.input }),
      signal: controller.signal,
    })
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new AiError('Embedding request timed out.', { code: 'embedding_timeout', status: 504 })
    }
    throw new AiError('Could not reach the embeddings provider.', {
      code: 'embedding_provider_unreachable',
      status: 502,
    })
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new AiError(`Embedding request failed (${res.status}): ${body.slice(0, 300)}`, {
      code: 'embedding_provider_error',
      status: 502,
    })
  }

  const json = (await res.json()) as { data?: { embedding?: unknown }[] }
  const embedding = json.data?.[0]?.embedding
  if (!Array.isArray(embedding) || !embedding.every((value) => typeof value === 'number')) {
    throw new AiError('Embedding provider returned an invalid vector.', {
      code: 'embedding_invalid_response',
      status: 502,
    })
  }

  return embedding
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
npx vitest run src/lib/ai/knowledge/embeddings.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```powershell
git add .\src\lib\ai\knowledge\embeddings.ts .\src\lib\ai\knowledge\embeddings.test.ts
git commit -m "feat(ai): add embeddings adapter"
```

---

### Task 4: Knowledge Ingestion

**Files:**
- Create: `src/lib/ai/knowledge/ingest.ts`
- Create: `src/lib/ai/knowledge/ingest.test.ts`

**Interfaces:**
- Consumes: `chunkKnowledgeText(input: string): KnowledgeChunk[]` from Task 2.
- Consumes: `generateOpenAiEmbedding(...)` from Task 3.
- Produces: `ingestKnowledgeDocument(supabase, args): Promise<{ documentId: string; chunkCount: number; embeddedCount: number }>`

- [ ] **Step 1: Write the failing test**

Create `src/lib/ai/knowledge/ingest.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ generateOpenAiEmbedding: vi.fn() }))
vi.mock('./embeddings', () => ({ generateOpenAiEmbedding: h.generateOpenAiEmbedding }))

import { ingestKnowledgeDocument } from './ingest'

function client() {
  const calls: { table: string; op: string; value?: unknown }[] = []
  return {
    calls,
    from(table: string) {
      return {
        upsert(value: unknown) {
          calls.push({ table, op: 'upsert', value })
          return { select: () => ({ single: async () => ({ data: { id: 'doc-1' }, error: null }) }) }
        },
        delete() {
          calls.push({ table, op: 'delete' })
          return { eq: () => ({ eq: async () => ({ error: null }) }) }
        },
        insert(value: unknown) {
          calls.push({ table, op: 'insert', value })
          return Promise.resolve({ error: null })
        },
      }
    },
  }
}

describe('ingestKnowledgeDocument', () => {
  it('upserts the document, replaces chunks, and embeds when a key exists', async () => {
    h.generateOpenAiEmbedding.mockResolvedValue([0.1, 0.2, 0.3])
    const db = client()

    const result = await ingestKnowledgeDocument(db as never, {
      accountId: 'acct-1',
      userId: 'user-1',
      title: 'Refund policy',
      content: 'Refunds are available within 7 days.',
      embedding: { apiKey: 'sk-test', model: 'text-embedding-3-small' },
    })

    expect(result).toEqual({ documentId: 'doc-1', chunkCount: 1, embeddedCount: 1 })
    expect(db.calls.map((call) => `${call.table}:${call.op}`)).toEqual([
      'ai_knowledge_documents:upsert',
      'ai_knowledge_chunks:delete',
      'ai_knowledge_chunks:insert',
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npx vitest run src/lib/ai/knowledge/ingest.test.ts
```

Expected: FAIL because `ingest.ts` does not exist.

- [ ] **Step 3: Implement ingestion**

Create `src/lib/ai/knowledge/ingest.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { chunkKnowledgeText } from './chunk'
import { generateOpenAiEmbedding } from './embeddings'

export interface IngestKnowledgeDocumentArgs {
  accountId: string
  userId: string
  documentId?: string
  title: string
  content: string
  sourceType?: 'manual' | 'url' | 'file' | 'api'
  sourceUri?: string | null
  metadata?: Record<string, unknown>
  embedding?: { apiKey: string; model: string } | null
}

export async function ingestKnowledgeDocument(
  supabase: SupabaseClient,
  args: IngestKnowledgeDocumentArgs,
): Promise<{ documentId: string; chunkCount: number; embeddedCount: number }> {
  const title = args.title.trim()
  const content = args.content.trim()
  if (!title) throw new Error('title is required')
  if (!content) throw new Error('content is required')

  const { data: document, error: documentError } = await supabase
    .from('ai_knowledge_documents')
    .upsert({
      ...(args.documentId ? { id: args.documentId } : {}),
      account_id: args.accountId,
      created_by: args.userId,
      title,
      content,
      source_type: args.sourceType ?? 'manual',
      source_uri: args.sourceUri ?? null,
      metadata: args.metadata ?? {},
    })
    .select('id')
    .single()

  if (documentError) throw new Error(`Failed to save knowledge document: ${documentError.message}`)

  const documentId = (document as { id: string }).id
  const { error: deleteError } = await supabase
    .from('ai_knowledge_chunks')
    .delete()
    .eq('account_id', args.accountId)
    .eq('document_id', documentId)

  if (deleteError) throw new Error(`Failed to replace knowledge chunks: ${deleteError.message}`)

  const chunks = chunkKnowledgeText(content)
  let embeddedCount = 0
  const rows = []

  for (const chunk of chunks) {
    let embedding: string | null = null
    if (args.embedding) {
      const vector = await generateOpenAiEmbedding({
        apiKey: args.embedding.apiKey,
        model: args.embedding.model,
        input: chunk.content,
      })
      embedding = `[${vector.join(',')}]`
      embeddedCount += 1
    }

    rows.push({
      account_id: args.accountId,
      document_id: documentId,
      chunk_index: chunk.chunkIndex,
      content: chunk.content,
      token_estimate: chunk.tokenEstimate,
      embedding,
    })
  }

  if (rows.length > 0) {
    const { error: insertError } = await supabase.from('ai_knowledge_chunks').insert(rows)
    if (insertError) throw new Error(`Failed to insert knowledge chunks: ${insertError.message}`)
  }

  return { documentId, chunkCount: chunks.length, embeddedCount }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
npx vitest run src/lib/ai/knowledge/ingest.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```powershell
git add .\src\lib\ai\knowledge\ingest.ts .\src\lib\ai\knowledge\ingest.test.ts
git commit -m "feat(ai): add knowledge ingestion"
```

---

### Task 5: Hybrid Knowledge Retrieval

**Files:**
- Create: `src/lib/ai/knowledge/retrieve.ts`
- Create: `src/lib/ai/knowledge/retrieve.test.ts`

**Interfaces:**
- Consumes: `generateOpenAiEmbedding(...)` from Task 3.
- Produces: `retrieveKnowledge(supabase, args): Promise<RetrievedKnowledge[]>`
- Produces: `RetrievedKnowledge = { chunkId: string; documentId: string; content: string; score: number; mode: 'fts' | 'semantic' }`
- Consumed by Tasks 7 and 9.

- [ ] **Step 1: Write the failing test**

Create `src/lib/ai/knowledge/retrieve.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ generateOpenAiEmbedding: vi.fn() }))
vi.mock('./embeddings', () => ({ generateOpenAiEmbedding: h.generateOpenAiEmbedding }))

import { retrieveKnowledge } from './retrieve'

function rpcClient() {
  const calls: { name: string; args: unknown }[] = []
  return {
    calls,
    rpc(name: string, args: unknown) {
      calls.push({ name, args })
      if (name === 'match_ai_knowledge_fts') {
        return Promise.resolve({
          data: [{ id: 'c1', document_id: 'd1', content: 'Refunds within 7 days', rank: 0.8 }],
          error: null,
        })
      }
      return Promise.resolve({
        data: [{ id: 'c1', document_id: 'd1', content: 'Refunds within 7 days', distance: 0.1 }],
        error: null,
      })
    },
  }
}

describe('retrieveKnowledge', () => {
  it('runs FTS only when no embedding config is provided', async () => {
    const db = rpcClient()
    const results = await retrieveKnowledge(db as never, {
      accountId: 'acct-1',
      query: 'refund',
      matchCount: 4,
    })

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ chunkId: 'c1', mode: 'fts' })
    expect(db.calls.map((call) => call.name)).toEqual(['match_ai_knowledge_fts'])
  })

  it('dedupes hybrid results by chunk id and keeps the strongest score', async () => {
    h.generateOpenAiEmbedding.mockResolvedValue([0.1, 0.2, 0.3])
    const db = rpcClient()
    const results = await retrieveKnowledge(db as never, {
      accountId: 'acct-1',
      query: 'refund',
      matchCount: 4,
      embedding: { apiKey: 'sk-test', model: 'text-embedding-3-small' },
    })

    expect(results).toHaveLength(1)
    expect(results[0].score).toBeGreaterThan(0.8)
    expect(db.calls.map((call) => call.name)).toEqual(['match_ai_knowledge_fts', 'match_ai_knowledge_semantic'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npx vitest run src/lib/ai/knowledge/retrieve.test.ts
```

Expected: FAIL because `retrieve.ts` does not exist.

- [ ] **Step 3: Implement retrieval**

Create `src/lib/ai/knowledge/retrieve.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { generateOpenAiEmbedding } from './embeddings'

export interface RetrievedKnowledge {
  chunkId: string
  documentId: string
  content: string
  score: number
  mode: 'fts' | 'semantic'
}

export async function retrieveKnowledge(
  supabase: SupabaseClient,
  args: {
    accountId: string
    query: string
    matchCount?: number
    embedding?: { apiKey: string; model: string } | null
  },
): Promise<RetrievedKnowledge[]> {
  const query = args.query.trim()
  if (!query) return []

  const matchCount = args.matchCount ?? 6
  const { data: ftsRows, error: ftsError } = await supabase.rpc('match_ai_knowledge_fts', {
    p_account_id: args.accountId,
    p_query: query,
    p_match_count: matchCount,
  })

  if (ftsError) throw new Error(`Knowledge FTS retrieval failed: ${ftsError.message}`)

  const results = new Map<string, RetrievedKnowledge>()
  for (const row of (ftsRows ?? []) as { id: string; document_id: string; content: string; rank: number }[]) {
    results.set(row.id, {
      chunkId: row.id,
      documentId: row.document_id,
      content: row.content,
      score: row.rank,
      mode: 'fts',
    })
  }

  if (args.embedding) {
    const embedding = await generateOpenAiEmbedding({
      apiKey: args.embedding.apiKey,
      model: args.embedding.model,
      input: query,
    })
    const { data: semanticRows, error: semanticError } = await supabase.rpc('match_ai_knowledge_semantic', {
      p_account_id: args.accountId,
      p_query_embedding: `[${embedding.join(',')}]`,
      p_match_count: matchCount,
    })

    if (semanticError) throw new Error(`Knowledge semantic retrieval failed: ${semanticError.message}`)

    for (const row of (semanticRows ?? []) as { id: string; document_id: string; content: string; distance: number }[]) {
      const score = 1 - row.distance
      const existing = results.get(row.id)
      if (!existing || score > existing.score) {
        results.set(row.id, {
          chunkId: row.id,
          documentId: row.document_id,
          content: row.content,
          score,
          mode: 'semantic',
        })
      }
    }
  }

  return [...results.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, matchCount)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
npx vitest run src/lib/ai/knowledge/retrieve.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```powershell
git add .\src\lib\ai\knowledge\retrieve.ts .\src\lib\ai\knowledge\retrieve.test.ts
git commit -m "feat(ai): add hybrid knowledge retrieval"
```

---

### Task 6: Knowledge Management API

**Files:**
- Create: `src/app/api/ai/knowledge/route.ts`
- Create: `src/app/api/ai/knowledge/route.test.ts`
- Create: `src/app/api/ai/knowledge/[id]/route.ts`
- Create: `src/app/api/ai/knowledge/[id]/route.test.ts`

**Interfaces:**
- Consumes: `ingestKnowledgeDocument(...)` from Task 4.
- Produces: `GET /api/ai/knowledge`, `POST /api/ai/knowledge`, `PUT /api/ai/knowledge/[id]`, `DELETE /api/ai/knowledge/[id]`.
- Consumed by Task 10 UI.

- [ ] **Step 1: Re-read Next.js route handler docs**

Run:

```powershell
Get-Content -LiteralPath '.\node_modules\next\dist\docs\01-app\03-api-reference\03-file-conventions\route.md' | Select-Object -First 120
```

Expected: confirms route handlers use exported HTTP methods and dynamic route `params` are a Promise.

- [ ] **Step 2: Write route tests**

Create `src/app/api/ai/knowledge/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  ingestKnowledgeDocument: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: h.requireRole,
  toErrorResponse: (err: unknown) => new Response(JSON.stringify({ error: String(err) }), { status: 500 }),
}))
vi.mock('@/lib/ai/knowledge/ingest', () => ({ ingestKnowledgeDocument: h.ingestKnowledgeDocument }))

import { GET, POST } from './route'

function req(body: unknown): Request {
  return new Request('http://localhost/api/ai/knowledge', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.requireRole.mockResolvedValue({
    accountId: 'acct-1',
    userId: 'user-1',
    supabase: {
      from: () => ({
        select: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }),
      }),
    },
  })
})

describe('GET /api/ai/knowledge', () => {
  it('requires agent role and lists account documents', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect(h.requireRole).toHaveBeenCalledWith('agent')
  })
})

describe('POST /api/ai/knowledge', () => {
  it('400s on blank content', async () => {
    const res = await POST(req({ title: 'Refunds', content: '   ' }))
    expect(res.status).toBe(400)
  })

  it('ingests an admin-owned document', async () => {
    h.ingestKnowledgeDocument.mockResolvedValue({ documentId: 'doc-1', chunkCount: 2, embeddedCount: 0 })
    const res = await POST(req({ title: 'Refunds', content: 'Refunds are available.' }))
    expect(res.status).toBe(201)
    expect(h.requireRole).toHaveBeenCalledWith('admin')
    expect(h.ingestKnowledgeDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ accountId: 'acct-1', userId: 'user-1' }),
    )
  })
})
```

Create `src/app/api/ai/knowledge/[id]/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ requireRole: vi.fn(), ingestKnowledgeDocument: vi.fn() }))
vi.mock('@/lib/auth/account', () => ({
  requireRole: h.requireRole,
  toErrorResponse: (err: unknown) => new Response(JSON.stringify({ error: String(err) }), { status: 500 }),
}))
vi.mock('@/lib/ai/knowledge/ingest', () => ({ ingestKnowledgeDocument: h.ingestKnowledgeDocument }))

import { DELETE, PUT } from './route'

function req(body: unknown): Request {
  return new Request('http://localhost/api/ai/knowledge/doc-1', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.requireRole.mockResolvedValue({
    accountId: 'acct-1',
    userId: 'user-1',
    supabase: {
      from: () => ({
        delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
      }),
    },
  })
})

describe('PUT /api/ai/knowledge/[id]', () => {
  it('updates through ingestion with the route id', async () => {
    h.ingestKnowledgeDocument.mockResolvedValue({ documentId: 'doc-1', chunkCount: 1, embeddedCount: 0 })
    const res = await PUT(req({ title: 'Updated', content: 'Updated content' }), {
      params: Promise.resolve({ id: 'doc-1' }),
    })
    expect(res.status).toBe(200)
    expect(h.ingestKnowledgeDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ documentId: 'doc-1', accountId: 'acct-1' }),
    )
  })
})

describe('DELETE /api/ai/knowledge/[id]', () => {
  it('deletes only by id and current account', async () => {
    const res = await DELETE(new Request('http://localhost/api/ai/knowledge/doc-1'), {
      params: Promise.resolve({ id: 'doc-1' }),
    })
    expect(res.status).toBe(200)
    expect(h.requireRole).toHaveBeenCalledWith('admin')
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```powershell
npx vitest run src/app/api/ai/knowledge/route.test.ts 'src/app/api/ai/knowledge/[id]/route.test.ts'
```

Expected: FAIL because route modules do not exist.

- [ ] **Step 4: Implement collection route**

Create `src/app/api/ai/knowledge/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { ingestKnowledgeDocument } from '@/lib/ai/knowledge/ingest'

const MAX_CONTENT_LENGTH = 200_000

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const { data, error } = await supabase
      .from('ai_knowledge_documents')
      .select('id, title, source_type, source_uri, metadata, created_at, updated_at')
      .eq('account_id', accountId)
      .order('updated_at', { ascending: false })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ documents: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const body = await request.json().catch(() => null)
    const title = typeof body?.title === 'string' ? body.title.trim() : ''
    const content = typeof body?.content === 'string' ? body.content.trim() : ''

    if (!title) return NextResponse.json({ error: 'title is required' }, { status: 400 })
    if (!content) return NextResponse.json({ error: 'content is required' }, { status: 400 })
    if (content.length > MAX_CONTENT_LENGTH) {
      return NextResponse.json({ error: `content is too long (max ${MAX_CONTENT_LENGTH} characters)` }, { status: 400 })
    }

    const result = await ingestKnowledgeDocument(supabase, {
      accountId,
      userId,
      title,
      content,
      sourceType: 'manual',
      metadata: {},
      embedding: null,
    })

    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
```

- [ ] **Step 5: Implement item route**

Create `src/app/api/ai/knowledge/[id]/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { ingestKnowledgeDocument } from '@/lib/ai/knowledge/ingest'

const MAX_CONTENT_LENGTH = 200_000

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const { supabase, accountId, userId } = await requireRole('admin')
    const body = await request.json().catch(() => null)
    const title = typeof body?.title === 'string' ? body.title.trim() : ''
    const content = typeof body?.content === 'string' ? body.content.trim() : ''

    if (!title) return NextResponse.json({ error: 'title is required' }, { status: 400 })
    if (!content) return NextResponse.json({ error: 'content is required' }, { status: 400 })
    if (content.length > MAX_CONTENT_LENGTH) {
      return NextResponse.json({ error: `content is too long (max ${MAX_CONTENT_LENGTH} characters)` }, { status: 400 })
    }

    const result = await ingestKnowledgeDocument(supabase, {
      accountId,
      userId,
      documentId: id,
      title,
      content,
      sourceType: 'manual',
      metadata: {},
      embedding: null,
    })

    return NextResponse.json(result)
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const { supabase, accountId } = await requireRole('admin')
    const { error } = await supabase
      .from('ai_knowledge_documents')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run:

```powershell
npx vitest run src/app/api/ai/knowledge/route.test.ts 'src/app/api/ai/knowledge/[id]/route.test.ts'
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```powershell
git add .\src\app\api\ai\knowledge .\src\lib\ai\knowledge\ingest.ts
git commit -m "feat(ai): add knowledge management api"
```

---

### Task 7: AI Run Logging

**Files:**
- Create: `src/lib/ai/run-log.ts`
- Create: `src/lib/ai/run-log.test.ts`

**Interfaces:**
- Produces: `createAiRun(supabase, input): Promise<string | null>`
- Produces: `completeAiRun(supabase, input): Promise<void>`
- Produces: `logAiRetrievalEvent(supabase, input): Promise<void>`
- Produces: `logAiToolCall(supabase, input): Promise<void>`
- Consumed by Task 9.

- [ ] **Step 1: Write tests**

Create `src/lib/ai/run-log.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { completeAiRun, createAiRun, logAiRetrievalEvent, logAiToolCall } from './run-log'

function client() {
  const calls: { table: string; op: string; value?: unknown }[] = []
  return {
    calls,
    from(table: string) {
      return {
        insert(value: unknown) {
          calls.push({ table, op: 'insert', value })
          return { select: () => ({ single: async () => ({ data: { id: 'run-1' }, error: null }) }) }
        },
        update(value: unknown) {
          calls.push({ table, op: 'update', value })
          return { eq: async () => ({ error: null }) }
        },
      }
    },
  }
}

describe('run-log helpers', () => {
  it('creates and completes an AI run without throwing', async () => {
    const db = client()
    await expect(
      createAiRun(db as never, {
        accountId: 'acct-1',
        surface: 'whatsapp_agent',
        agentRole: 'support',
        provider: 'openai',
        model: 'gpt-test',
      }),
    ).resolves.toBe('run-1')

    await completeAiRun(db as never, { runId: 'run-1', status: 'completed', inputTokens: 1, outputTokens: 2 })
    expect(db.calls.map((call) => `${call.table}:${call.op}`)).toEqual(['ai_runs:insert', 'ai_runs:update'])
  })

  it('logs retrieval events and tool calls', async () => {
    const db = client()
    await logAiRetrievalEvent(db as never, {
      accountId: 'acct-1',
      runId: 'run-1',
      query: 'refund',
      retrievalMode: 'fts',
      chunkIds: ['chunk-1'],
      scores: [{ chunkId: 'chunk-1', score: 0.8 }],
    })
    await logAiToolCall(db as never, {
      accountId: 'acct-1',
      runId: 'run-1',
      toolName: 'send_message',
      arguments: { text: 'hello' },
      status: 'proposed',
      result: {},
    })

    expect(db.calls.map((call) => `${call.table}:${call.op}`)).toEqual([
      'ai_retrieval_events:insert',
      'ai_tool_calls:insert',
    ])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
npx vitest run src/lib/ai/run-log.test.ts
```

Expected: FAIL because `run-log.ts` does not exist.

- [ ] **Step 3: Implement logging helpers**

Create `src/lib/ai/run-log.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'

type AiRunSurface = 'whatsapp_agent' | 'automation_copilot' | 'knowledge_ingest' | 'manual_test'
type AiRunStatus = 'started' | 'completed' | 'failed' | 'skipped'
type ToolStatus = 'proposed' | 'executed' | 'rejected' | 'skipped' | 'failed'

export async function createAiRun(
  supabase: SupabaseClient,
  input: {
    accountId: string
    conversationId?: string | null
    userId?: string | null
    surface: AiRunSurface
    agentRole: string
    provider?: string | null
    model?: string | null
    metadata?: Record<string, unknown>
  },
): Promise<string | null> {
  const { data, error } = await supabase
    .from('ai_runs')
    .insert({
      account_id: input.accountId,
      conversation_id: input.conversationId ?? null,
      user_id: input.userId ?? null,
      surface: input.surface,
      agent_role: input.agentRole,
      provider: input.provider ?? null,
      model: input.model ?? null,
      metadata: input.metadata ?? {},
    })
    .select('id')
    .single()

  if (error) {
    console.error('[ai-run-log] createAiRun failed:', error)
    return null
  }
  return (data as { id: string }).id
}

export async function completeAiRun(
  supabase: SupabaseClient,
  input: {
    runId: string | null
    status: AiRunStatus
    inputTokens?: number | null
    outputTokens?: number | null
    error?: string | null
  },
): Promise<void> {
  if (!input.runId) return
  const { error } = await supabase
    .from('ai_runs')
    .update({
      status: input.status,
      input_tokens: input.inputTokens ?? null,
      output_tokens: input.outputTokens ?? null,
      error: input.error ?? null,
      completed_at: new Date().toISOString(),
    })
    .eq('id', input.runId)

  if (error) console.error('[ai-run-log] completeAiRun failed:', error)
}

export async function logAiRetrievalEvent(
  supabase: SupabaseClient,
  input: {
    accountId: string
    runId: string | null
    query: string
    retrievalMode: 'fts' | 'semantic' | 'hybrid'
    chunkIds: string[]
    scores: unknown[]
  },
): Promise<void> {
  if (!input.runId) return
  const { error } = await supabase.from('ai_retrieval_events').insert({
    account_id: input.accountId,
    ai_run_id: input.runId,
    query: input.query,
    retrieval_mode: input.retrievalMode,
    chunk_ids: input.chunkIds,
    scores: input.scores,
  })
  if (error) console.error('[ai-run-log] logAiRetrievalEvent failed:', error)
}

export async function logAiToolCall(
  supabase: SupabaseClient,
  input: {
    accountId: string
    runId: string | null
    toolName: string
    arguments: Record<string, unknown>
    status: ToolStatus
    result?: Record<string, unknown>
    error?: string | null
  },
): Promise<void> {
  if (!input.runId) return
  const { error } = await supabase.from('ai_tool_calls').insert({
    account_id: input.accountId,
    ai_run_id: input.runId,
    tool_name: input.toolName,
    arguments: input.arguments,
    status: input.status,
    result: input.result ?? {},
    error: input.error ?? null,
  })
  if (error) console.error('[ai-run-log] logAiToolCall failed:', error)
}
```

- [ ] **Step 4: Run tests**

Run:

```powershell
npx vitest run src/lib/ai/run-log.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```powershell
git add .\src\lib\ai\run-log.ts .\src\lib\ai\run-log.test.ts
git commit -m "feat(ai): add ai run logging helpers"
```

---

### Task 8: Agent Registry and Coordinator Routing

**Files:**
- Create: `src/lib/ai/agent-registry.ts`
- Create: `src/lib/ai/agent-registry.test.ts`
- Create: `src/lib/ai/agent-router.ts`
- Create: `src/lib/ai/agent-router.test.ts`

**Interfaces:**
- Produces: `AgentRole = 'coordinator' | 'triage' | 'support' | 'sales' | 'retention' | 'automation_builder'`
- Produces: `loadAgentDefinitions(supabase, accountId): Promise<AgentDefinition[]>`
- Produces: `routeAgentRole(args): Promise<AgentRole>`
- Consumed by Task 9.

- [ ] **Step 1: Write tests**

Create `src/lib/ai/agent-registry.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { BUILT_IN_AGENT_DEFINITIONS, sanitizeAgentDefinition } from './agent-registry'

describe('agent registry', () => {
  it('includes the expected built-in roles', () => {
    expect(BUILT_IN_AGENT_DEFINITIONS.map((agent) => agent.role)).toEqual([
      'coordinator',
      'triage',
      'support',
      'sales',
      'retention',
      'automation_builder',
    ])
  })

  it('drops unsupported actions from overrides', () => {
    const sanitized = sanitizeAgentDefinition({
      role: 'support',
      name: 'Support',
      instructions: 'Answer with knowledge.',
      enabled: true,
      allowedActions: ['send_message', 'drop_database'],
      knowledgeEnabled: true,
    })

    expect(sanitized.allowedActions).toEqual(['send_message'])
  })
})
```

Create `src/lib/ai/agent-router.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ generateJson: vi.fn() }))
vi.mock('./generate-json', () => ({ generateJson: h.generateJson }))

import { routeAgentRole } from './agent-router'

const config = {
  accountId: 'acct-1',
  provider: 'openai' as const,
  model: 'gpt-test',
  apiKey: 'sk-test',
  agentEnabled: true,
  pipelineMoveEnabled: false,
  autoReplyMaxPerConversation: 3,
  handoffAgentId: null,
}

describe('routeAgentRole', () => {
  it('returns a known role from the coordinator response', async () => {
    h.generateJson.mockResolvedValue({ data: { role: 'support' }, usage: null })
    await expect(routeAgentRole({ config, message: 'What is your refund policy?' })).resolves.toBe('support')
  })

  it('falls back to triage for unknown roles', async () => {
    h.generateJson.mockResolvedValue({ data: { role: 'unknown' }, usage: null })
    await expect(routeAgentRole({ config, message: 'hello' })).resolves.toBe('triage')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
npx vitest run src/lib/ai/agent-registry.test.ts src/lib/ai/agent-router.test.ts
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement registry**

Create `src/lib/ai/agent-registry.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'

export type AgentRole = 'coordinator' | 'triage' | 'support' | 'sales' | 'retention' | 'automation_builder'

export type AgentActionName =
  | 'send_message'
  | 'add_tag'
  | 'remove_tag'
  | 'move_deal_stage'
  | 'assign_conversation'
  | 'create_deal'
  | 'create_automation_draft'
  | 'create_followup_task'

export interface AgentDefinition {
  role: AgentRole
  name: string
  instructions: string
  enabled: boolean
  allowedActions: AgentActionName[]
  knowledgeEnabled: boolean
}

export const ALLOWED_AGENT_ACTIONS: AgentActionName[] = [
  'send_message',
  'add_tag',
  'remove_tag',
  'move_deal_stage',
  'assign_conversation',
  'create_deal',
  'create_automation_draft',
  'create_followup_task',
]

export const BUILT_IN_AGENT_DEFINITIONS: AgentDefinition[] = [
  {
    role: 'coordinator',
    name: 'Coordinator',
    instructions: 'Choose exactly one specialist for the current CRM event.',
    enabled: true,
    allowedActions: [],
    knowledgeEnabled: false,
  },
  {
    role: 'triage',
    name: 'Triage',
    instructions: 'Classify customer intent and decide whether a human should take over.',
    enabled: true,
    allowedActions: ['assign_conversation', 'add_tag'],
    knowledgeEnabled: true,
  },
  {
    role: 'support',
    name: 'Support',
    instructions: 'Answer customer questions using account knowledge. Hand off when evidence is missing.',
    enabled: true,
    allowedActions: ['send_message', 'assign_conversation'],
    knowledgeEnabled: true,
  },
  {
    role: 'sales',
    name: 'Sales',
    instructions: 'Qualify leads and propose safe pipeline movement based on customer intent.',
    enabled: true,
    allowedActions: ['send_message', 'add_tag', 'move_deal_stage', 'create_deal'],
    knowledgeEnabled: true,
  },
  {
    role: 'retention',
    name: 'Retention',
    instructions: 'Detect complaint or churn risk and prioritize human handoff.',
    enabled: true,
    allowedActions: ['send_message', 'assign_conversation', 'add_tag'],
    knowledgeEnabled: true,
  },
  {
    role: 'automation_builder',
    name: 'Automation Builder',
    instructions: 'Draft editable automations from plain-language requests.',
    enabled: true,
    allowedActions: ['create_automation_draft'],
    knowledgeEnabled: false,
  },
]

const ROLE_SET = new Set(BUILT_IN_AGENT_DEFINITIONS.map((agent) => agent.role))
const ACTION_SET = new Set(ALLOWED_AGENT_ACTIONS)

export function sanitizeAgentDefinition(raw: AgentDefinition): AgentDefinition {
  return {
    role: ROLE_SET.has(raw.role) ? raw.role : 'triage',
    name: raw.name.trim().slice(0, 80) || raw.role,
    instructions: raw.instructions.trim().slice(0, 4000),
    enabled: raw.enabled === true,
    allowedActions: raw.allowedActions.filter((action) => ACTION_SET.has(action)),
    knowledgeEnabled: raw.knowledgeEnabled === true,
  }
}

export async function loadAgentDefinitions(
  supabase: SupabaseClient,
  accountId: string,
): Promise<AgentDefinition[]> {
  const { data, error } = await supabase
    .from('ai_agent_definitions')
    .select('role, name, instructions, enabled, allowed_actions, knowledge_enabled')
    .eq('account_id', accountId)

  if (error) throw new Error(`Failed to load agent definitions: ${error.message}`)

  const overrides = new Map<string, AgentDefinition>()
  for (const row of (data ?? []) as {
    role: AgentRole
    name: string
    instructions: string
    enabled: boolean
    allowed_actions: AgentActionName[]
    knowledge_enabled: boolean
  }[]) {
    overrides.set(
      row.role,
      sanitizeAgentDefinition({
        role: row.role,
        name: row.name,
        instructions: row.instructions,
        enabled: row.enabled,
        allowedActions: row.allowed_actions ?? [],
        knowledgeEnabled: row.knowledge_enabled,
      }),
    )
  }

  return BUILT_IN_AGENT_DEFINITIONS.map((builtIn) => overrides.get(builtIn.role) ?? builtIn)
}
```

- [ ] **Step 4: Implement router**

Create `src/lib/ai/agent-router.ts`:

```ts
import { generateJson } from './generate-json'
import type { AiConfig } from './types'
import type { AgentRole } from './agent-registry'

const ROUTABLE_ROLES: AgentRole[] = ['triage', 'support', 'sales', 'retention']

interface RawRoute {
  role?: unknown
}

export async function routeAgentRole(args: { config: AiConfig; message: string }): Promise<AgentRole> {
  const systemPrompt =
    'You are a CRM AI coordinator. Choose exactly one specialist for this WhatsApp customer message. ' +
    `Allowed roles: ${ROUTABLE_ROLES.join(', ')}. ` +
    'Choose support for factual questions, sales for buying/qualification/pipeline intent, retention for complaints or cancellation risk, and triage when unclear.'

  const userPrompt = `Customer message:\n${args.message}\n\nReturn {"role":"support|sales|retention|triage"}.`
  const { data } = await generateJson<RawRoute>({ config: args.config, systemPrompt, userPrompt })
  return ROUTABLE_ROLES.includes(data.role as AgentRole) ? (data.role as AgentRole) : 'triage'
}
```

- [ ] **Step 5: Run tests**

Run:

```powershell
npx vitest run src/lib/ai/agent-registry.test.ts src/lib/ai/agent-router.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```powershell
git add .\src\lib\ai\agent-registry.ts .\src\lib\ai\agent-registry.test.ts .\src\lib\ai\agent-router.ts .\src\lib\ai\agent-router.test.ts
git commit -m "feat(ai): add agent registry and routing"
```

---

### Task 9: Ground WhatsApp Agent with RAG and Logs

**Files:**
- Modify: `src/lib/ai/agent-context.ts`
- Modify: `src/lib/ai/agent-decide.ts`
- Modify: `src/lib/ai/agent-dispatch.ts`
- Modify: `src/lib/ai/agent-context.test.ts`
- Modify: `src/lib/ai/agent-decide.test.ts`
- Modify: `src/lib/ai/agent-dispatch.test.ts`

**Interfaces:**
- Consumes: `retrieveKnowledge(...)` from Task 5.
- Consumes: `createAiRun(...)`, `completeAiRun(...)`, `logAiRetrievalEvent(...)`, `logAiToolCall(...)` from Task 7.
- Consumes: `routeAgentRole(...)` from Task 8.
- Produces: `AgentContext.knowledge: { chunkId: string; documentId: string; content: string; score: number; mode: 'fts' | 'semantic' }[]`.
- Produces: `AgentDecision.citations: string[]`.

- [ ] **Step 1: Update context tests**

In `src/lib/ai/agent-context.test.ts`, add a test that mocks `retrieveKnowledge` and expects `buildAgentContext` to include returned snippets when called with `knowledge` options:

```ts
it('includes retrieved knowledge when knowledge options are provided', async () => {
  // Use the existing Supabase mock shape in this file.
  // Mock retrieveKnowledge to resolve [{ chunkId: 'c1', documentId: 'd1', content: 'Refunds within 7 days', score: 0.8, mode: 'fts' }].
  // Expect context.knowledge[0].chunkId toBe('c1').
})
```

Replace the comments with the existing test file's local mock style; do not create a second mocking framework in this file.

- [ ] **Step 2: Update `AgentContext` and `buildAgentContext`**

Modify `src/lib/ai/agent-context.ts`:

```ts
import type { RetrievedKnowledge } from './knowledge/retrieve'
import { retrieveKnowledge } from './knowledge/retrieve'
```

Extend the interface:

```ts
knowledge: RetrievedKnowledge[]
```

Extend the function args:

```ts
args: {
  accountId: string
  conversationId: string
  knowledge?: {
    enabled: boolean
    query: string
    embedding?: { apiKey: string; model: string } | null
  }
}
```

After messages and deal load:

```ts
const knowledge =
  args.knowledge?.enabled === true
    ? await retrieveKnowledge(supabase, {
        accountId: args.accountId,
        query: args.knowledge.query,
        embedding: args.knowledge.embedding ?? null,
      })
    : []
```

Return `knowledge`.

- [ ] **Step 3: Update decision tests**

In `src/lib/ai/agent-decide.test.ts`, add:

```ts
it('passes knowledge snippets into the prompt and sanitizes citations', async () => {
  h.generateJson.mockResolvedValue({
    data: {
      reply_text: 'Refunds are available within 7 days.',
      add_tags: [],
      remove_tags: [],
      move_to_stage_id: null,
      handoff: false,
      handoff_reason: null,
      citations: ['c1', 'not-real'],
    },
    usage: null,
  })

  const decision = await decideAgentAction({
    config: config(),
    resources: resources(),
    context: {
      messages: [{ role: 'customer', text: 'Can I get a refund?' }],
      dealId: null,
      currentPipelineId: null,
      currentStageId: null,
      knowledge: [{ chunkId: 'c1', documentId: 'd1', content: 'Refunds within 7 days.', score: 0.8, mode: 'fts' }],
    },
  })

  expect(decision.citations).toEqual(['c1'])
  expect(h.generateJson).toHaveBeenCalledWith(expect.objectContaining({
    userPrompt: expect.stringContaining('Refunds within 7 days.'),
  }))
})
```

- [ ] **Step 4: Update `AgentDecision` and prompts**

Modify `src/lib/ai/agent-decide.ts`:

```ts
citations: string[]
```

Add `citations?: unknown` to `RawDecision`.

Add knowledge prompt text:

```ts
const knowledgeList =
  context.knowledge.map((k) => `- ${k.chunkId}: ${k.content}`).join('\n') || '(no knowledge matched)'
```

Include in `userPrompt`:

```ts
`Relevant knowledge:\n${knowledgeList}\n\n`
```

Update the JSON shape to include:

```ts
"citations": ["chunk-id"]
```

In `sanitize`, add:

```ts
const validChunkIds = new Set(resourcesFromContext)
```

Use the actual `context.knowledge` set in the sanitizer signature, and return only citation IDs that match retrieved chunks.

- [ ] **Step 5: Update dispatch logging tests**

In `src/lib/ai/agent-dispatch.test.ts`, mock `createAiRun`, `completeAiRun`, `logAiRetrievalEvent`, `logAiToolCall`, and `routeAgentRole`. Add expectations that:

- `createAiRun` is called once when the agent is enabled.
- `completeAiRun` is called with `completed` when dispatch succeeds.
- `logAiToolCall` records at least `send_message` when a reply is sent.

- [ ] **Step 6: Update `agent-dispatch.ts`**

Modify `run()` to:

1. Create an AI run after config/rate-limit gating:

```ts
const runId = await createAiRun(db, {
  accountId,
  conversationId,
  userId,
  surface: 'whatsapp_agent',
  agentRole: 'coordinator',
  provider: config.provider,
  model: config.model,
})
```

2. Route to a specialist using the latest inbound text from context or message history:

```ts
const agentRole = await routeAgentRole({ config, message: context.messages.at(-1)?.text ?? '' })
```

3. Log retrieved chunks:

```ts
await logAiRetrievalEvent(db, {
  accountId,
  runId,
  query: context.messages.at(-1)?.text ?? '',
  retrievalMode: context.knowledge.some((k) => k.mode === 'semantic') ? 'hybrid' : 'fts',
  chunkIds: context.knowledge.map((k) => k.chunkId),
  scores: context.knowledge.map((k) => ({ chunkId: k.chunkId, score: k.score, mode: k.mode })),
})
```

4. Log tool calls before/after executing each proposed CRM action.

5. Call `completeAiRun` with `completed` or `failed` in the top-level try/catch of `run()`.

- [ ] **Step 7: Run focused tests**

Run:

```powershell
npx vitest run src/lib/ai/agent-context.test.ts src/lib/ai/agent-decide.test.ts src/lib/ai/agent-dispatch.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```powershell
git add .\src\lib\ai\agent-context.ts .\src\lib\ai\agent-context.test.ts .\src\lib\ai\agent-decide.ts .\src\lib\ai\agent-decide.test.ts .\src\lib\ai\agent-dispatch.ts .\src\lib\ai\agent-dispatch.test.ts
git commit -m "feat(ai): ground whatsapp agent with knowledge"
```

---

### Task 10: Knowledge Settings UI

**Files:**
- Create: `src/components/settings/knowledge-manager.tsx`
- Modify: `src/components/settings/agent-config.tsx`
- Modify: `messages/en.json`
- Modify: `messages/ko.json`

**Interfaces:**
- Consumes: knowledge API from Task 6.
- Produces: admin UI for manual text knowledge documents.

- [ ] **Step 1: Inspect existing settings component style**

Run:

```powershell
Get-Content -LiteralPath .\src\components\settings\agent-config.tsx | Select-Object -First 220
```

Expected: identify existing `Card`, `Input`, `Textarea`, `Button`, toast, and translation patterns.

- [ ] **Step 2: Create `knowledge-manager.tsx`**

Implement a client component with:

- `GET /api/ai/knowledge` on mount.
- A title input, content textarea, and save button.
- A compact list of existing documents.
- Edit and delete actions.
- No nested cards; use one unframed section or simple bordered rows.
- Admin-only failure messages from the API shown through existing toast style.

- [ ] **Step 3: Wire into `agent-config.tsx`**

Import and render:

```tsx
import { KnowledgeManager } from './knowledge-manager'
```

Place below provider/key/toggles:

```tsx
<KnowledgeManager />
```

- [ ] **Step 4: Add i18n strings**

Add English strings under `Settings.agent.knowledge`:

```json
{
  "title": "Knowledge base",
  "description": "Add trusted answers, policies, and product details the AI agent can use before replying.",
  "documentTitle": "Title",
  "documentContent": "Content",
  "save": "Save knowledge",
  "saving": "Saving...",
  "empty": "No knowledge documents yet.",
  "edit": "Edit",
  "delete": "Delete",
  "saved": "Knowledge saved",
  "deleted": "Knowledge deleted"
}
```

Mirror the keys in `messages/ko.json` with Korean copy.

- [ ] **Step 5: Run focused UI validation**

Run:

```powershell
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```powershell
git add .\src\components\settings\knowledge-manager.tsx .\src\components\settings\agent-config.tsx .\messages\en.json .\messages\ko.json
git commit -m "feat(ai): add knowledge settings manager"
```

---

### Task 11: Final Validation

**Files:** none.

**Interfaces:**
- Verifies all prior tasks.

- [ ] **Step 1: Check worktree**

Run:

```powershell
git status --short --branch
```

Expected: only intended changes are staged/committed; pre-existing `supabase/.temp/` remains untracked unless the user explicitly wants it staged.

- [ ] **Step 2: Run focused AI tests**

Run:

```powershell
npx vitest run src/lib/ai src/app/api/ai
```

Expected: PASS.

- [ ] **Step 3: Run full tests**

Run:

```powershell
npm test
```

Expected: PASS.

- [ ] **Step 4: Run typecheck**

Run:

```powershell
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Run build**

Run:

```powershell
npm run build
```

Expected: PASS.

- [ ] **Step 6: Inspect diff summary**

Run:

```powershell
git log --oneline --decorate -8
git status --short
```

Expected: recent commits correspond to Tasks 1-10; no unrelated files are staged.

---

## Self-Review Notes

- Spec coverage: RAG schema, retrieval, ingestion, APIs, UI, agent grounding, run logs, and multi-agent registry are covered.
- Placeholder scan: no unfinished placeholder markers or unspecified implementation steps are intentionally left in the plan.
- Type consistency: task interfaces use the same names across producer and consumer tasks: `retrieveKnowledge`, `RetrievedKnowledge`, `ingestKnowledgeDocument`, `createAiRun`, `logAiRetrievalEvent`, `AgentRole`, and `routeAgentRole`.
- Scope control: this plan does not add full autonomous tool loops, external MCP connector execution, file upload parsing, URL crawling, or flow generation. Those remain follow-up work after RAG quality is proven.
