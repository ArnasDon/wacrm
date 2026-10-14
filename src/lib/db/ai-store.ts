import type { SqlConnection } from './transaction';
import { queryRows } from './rows';
import { RequestError } from '@/lib/api/local-route';
export interface AiConfigRow {
  id: string;
  provider: 'openai' | 'anthropic';
  model: string;
  api_key: string;
  system_prompt: string | null;
  is_active: boolean;
  auto_reply_enabled: boolean;
  auto_reply_max_per_conversation: number;
  handoff_agent_id: string | null;
  embeddings_api_key: string | null;
}
export interface KnowledgeDocument {
  id: string;
  title: string;
  content: string;
  updated_at: string;
}
export class AiStore {
  constructor(
    private db: SqlConnection,
    private accountId: string
  ) {}
  async config() {
    return (
      (
        await queryRows<AiConfigRow>(
          this.db,
          'SELECT * FROM public.ai_configs WHERE account_id=$1',
          [this.accountId]
        )
      )[0] ?? null
    );
  }
  async safeConfig() {
    const row = await this.config();
    if (!row) return { configured: false };
    const { api_key, embeddings_api_key, id, ...safe } = row;
    void id;
    return {
      ...safe,
      configured: true,
      has_key: !!api_key,
      has_embeddings_key: !!embeddings_api_key,
    };
  }
  async member(id: string) {
    return (
      (
        await queryRows(
          this.db,
          "SELECT user_id FROM public.profiles WHERE account_id=$1 AND user_id=$2 AND account_role IN ('owner','admin','agent')",
          [this.accountId, id]
        )
      ).length > 0
    );
  }
  async saveConfig(userId: string, input: Record<string, unknown>) {
    const existing = await this.config();
    const row = { ...existing, ...input };
    if (
      row.handoff_agent_id &&
      !(await this.member(String(row.handoff_agent_id)))
    )
      throw new RequestError('Handoff agent must belong to this account.');
    await this.db.query(
      `INSERT INTO public.ai_configs(account_id,created_by,provider,model,api_key,system_prompt,is_active,auto_reply_enabled,auto_reply_max_per_conversation,handoff_agent_id,embeddings_api_key)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(account_id) DO UPDATE SET provider=EXCLUDED.provider,model=EXCLUDED.model,api_key=EXCLUDED.api_key,system_prompt=EXCLUDED.system_prompt,is_active=EXCLUDED.is_active,auto_reply_enabled=EXCLUDED.auto_reply_enabled,auto_reply_max_per_conversation=EXCLUDED.auto_reply_max_per_conversation,handoff_agent_id=EXCLUDED.handoff_agent_id,embeddings_api_key=EXCLUDED.embeddings_api_key`,
      [
        this.accountId,
        userId,
        row.provider,
        row.model,
        row.api_key,
        row.system_prompt ?? null,
        row.is_active ?? false,
        row.auto_reply_enabled ?? false,
        row.auto_reply_max_per_conversation ?? 3,
        row.handoff_agent_id ?? null,
        row.embeddings_api_key ?? null,
      ]
    );
  }
  async deleteConfig() {
    await this.db.query('DELETE FROM public.ai_configs WHERE account_id=$1', [
      this.accountId,
    ]);
  }
  async conversation(id: string, contactId?: string) {
    return (
      (
        await queryRows<{
          id: string;
          assigned_agent_id: string | null;
          ai_autoreply_disabled: boolean;
          ai_reply_count: number;
        }>(
          this.db,
          'SELECT id,assigned_agent_id,ai_autoreply_disabled,ai_reply_count FROM public.conversations WHERE account_id=$1 AND id=$2 AND ($3::uuid IS NULL OR contact_id=$3)',
          [this.accountId, id, contactId ?? null]
        )
      )[0] ?? null
    );
  }
  async hasResponders() {
    return (
      (
        await queryRows(
          this.db,
          "SELECT id FROM public.automations WHERE account_id=$1 AND is_active AND trigger_type IN ('new_message_received','keyword_match') LIMIT 1",
          [this.accountId]
        )
      ).length > 0
    );
  }
  async claim(id: string, max: number) {
    return (
      (
        await queryRows(
          this.db,
          'UPDATE public.conversations SET ai_reply_count=ai_reply_count+1 WHERE account_id=$1 AND id=$2 AND assigned_agent_id IS NULL AND NOT ai_autoreply_disabled AND ai_reply_count<$3 RETURNING id',
          [this.accountId, id, max]
        )
      ).length > 0
    );
  }
  async handoff(id: string, summary: string, agentId: string | null) {
    await this.db.query(
      `UPDATE public.conversations SET ai_autoreply_disabled=true,ai_handoff_summary=$3,assigned_agent_id=COALESCE(assigned_agent_id,(SELECT user_id FROM public.profiles WHERE account_id=$1 AND user_id=$4 AND account_role IN ('owner','admin','agent'))) WHERE account_id=$1 AND id=$2`,
      [this.accountId, id, summary, agentId]
    );
  }
  async toggle(id: string, userId: string, paused: boolean, assign: boolean) {
    const rows = await queryRows(
      this.db,
      `UPDATE public.conversations SET ai_autoreply_disabled=$3,assigned_agent_id=CASE WHEN NOT $3 THEN NULL WHEN $4 THEN $5 ELSE assigned_agent_id END,ai_reply_count=CASE WHEN $3 THEN ai_reply_count ELSE 0 END,ai_handoff_summary=CASE WHEN $3 THEN ai_handoff_summary ELSE NULL END WHERE account_id=$1 AND id=$2 RETURNING id`,
      [this.accountId, id, paused, assign, userId]
    );
    if (!rows.length) throw new RequestError('Conversation not found.', 404);
  }
  documents() {
    return queryRows<KnowledgeDocument>(
      this.db,
      'SELECT id,title,content,updated_at FROM public.ai_knowledge_documents WHERE account_id=$1 ORDER BY updated_at DESC,id DESC',
      [this.accountId]
    );
  }
  async document(id: string) {
    return (
      (
        await queryRows<KnowledgeDocument>(
          this.db,
          'SELECT id,title,content,updated_at FROM public.ai_knowledge_documents WHERE account_id=$1 AND id=$2',
          [this.accountId, id]
        )
      )[0] ?? null
    );
  }
  async createDocument(userId: string, title: string, content: string) {
    return (
      await queryRows<KnowledgeDocument>(
        this.db,
        'INSERT INTO public.ai_knowledge_documents(account_id,created_by,title,content) VALUES($1,$2,$3,$4) RETURNING id,title,content,updated_at',
        [this.accountId, userId, title, content]
      )
    )[0];
  }
  async updateDocument(
    id: string,
    input: { title?: string; content?: string }
  ) {
    const [doc] = await queryRows<KnowledgeDocument>(
      this.db,
      'UPDATE public.ai_knowledge_documents SET title=COALESCE($3,title),content=COALESCE($4,content) WHERE account_id=$1 AND id=$2 RETURNING id,title,content,updated_at',
      [this.accountId, id, input.title ?? null, input.content ?? null]
    );
    if (!doc) throw new RequestError('Document not found.', 404);
    if (input.content !== undefined)
      await this.db.query(
        'DELETE FROM public.ai_knowledge_chunks WHERE account_id=$1 AND document_id=$2',
        [this.accountId, id]
      );
    return doc;
  }
  async deleteDocument(id: string) {
    await this.db.query(
      'DELETE FROM public.ai_knowledge_documents WHERE account_id=$1 AND id=$2',
      [this.accountId, id]
    );
  }
  async replaceChunks(
    id: string,
    expectedContent: string,
    chunks: { content: string; embedding: number[] | null }[]
  ) {
    const [doc] = await queryRows<{ content: string }>(
      this.db,
      'SELECT content FROM public.ai_knowledge_documents WHERE account_id=$1 AND id=$2 FOR UPDATE',
      [this.accountId, id]
    );
    if (!doc) throw new RequestError('Document not found.', 404);
    if (doc.content !== expectedContent)
      throw new RequestError('Document changed during indexing. Retry.', 409);
    await this.db.query(
      'DELETE FROM public.ai_knowledge_chunks WHERE account_id=$1 AND document_id=$2',
      [this.accountId, id]
    );
    for (const [index, chunk] of chunks.entries())
      await this.db.query(
        'INSERT INTO public.ai_knowledge_chunks(account_id,document_id,chunk_index,content,embedding) VALUES($1,$2,$3,$4,$5::real[])',
        [this.accountId, id, index, chunk.content, chunk.embedding]
      );
  }
  async hasChunks() {
    return (
      (
        await queryRows(
          this.db,
          'SELECT id FROM public.ai_knowledge_chunks WHERE account_id=$1 LIMIT 1',
          [this.accountId]
        )
      ).length > 0
    );
  }
  lexical(query: string, k: number) {
    return queryRows<{ id: string; content: string }>(
      this.db,
      "SELECT id,content FROM public.ai_knowledge_chunks WHERE account_id=$1 AND fts @@ websearch_to_tsquery('simple',$2) ORDER BY ts_rank(fts,websearch_to_tsquery('simple',$2)) DESC,id LIMIT $3",
      [this.accountId, query, k]
    );
  }
  semantic(embedding: number[], k: number) {
    return queryRows<{ id: string; content: string }>(
      this.db,
      `SELECT c.id,c.content FROM public.ai_knowledge_chunks c CROSS JOIN LATERAL
  (SELECT sum(v.x::double precision*q.x::double precision)/NULLIF(sqrt(sum(v.x::double precision*v.x::double precision))*sqrt(sum(q.x::double precision*q.x::double precision)),0) AS score FROM unnest(c.embedding) WITH ORDINALITY v(x,i) JOIN unnest($2::real[]) WITH ORDINALITY q(x,i) USING(i)) s
  WHERE c.account_id=$1 AND cardinality(c.embedding)=cardinality($2::real[]) AND s.score IS NOT NULL ORDER BY s.score DESC,c.id LIMIT $3`,
      [this.accountId, embedding, k]
    );
  }
}
