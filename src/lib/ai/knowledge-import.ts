/**
 * Bulk import for the AI knowledge base.
 *
 * Accepts either `{ "documents": [{ "title", "content" }, …] }` or a bare
 * array of the same. Pure (no I/O) so the route and tests share it.
 * Titles are the identity: importing a title that already exists
 * replaces that document's content, so re-running an import after
 * editing the file updates the knowledge base instead of duplicating it.
 */

export const MAX_IMPORT_DOCS = 50
export const MAX_TITLE_LEN = 200
export const MAX_CONTENT_LEN = 20_000

export interface ImportDoc {
  title: string
  content: string
}

export type KnowledgeImportParse =
  | { ok: true; documents: ImportDoc[] }
  | { ok: false; errors: string[] }

export function parseKnowledgeImport(input: unknown): KnowledgeImportParse {
  const raw = Array.isArray(input)
    ? input
    : input && typeof input === 'object'
      ? (input as { documents?: unknown }).documents
      : undefined
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, errors: ['Expected a non-empty "documents" array.'] }
  }
  if (raw.length > MAX_IMPORT_DOCS) {
    return { ok: false, errors: [`At most ${MAX_IMPORT_DOCS} documents per import.`] }
  }

  const errors: string[] = []
  const seen = new Set<string>()
  const documents: ImportDoc[] = []
  raw.forEach((d: unknown, i: number) => {
    const o = (d ?? {}) as { title?: unknown; content?: unknown }
    const title = typeof o.title === 'string' ? o.title.trim() : ''
    const content = typeof o.content === 'string' ? o.content.trim() : ''
    if (!title || !content) {
      errors.push(`documents[${i}] needs a non-empty title and content.`)
      return
    }
    if (title.length > MAX_TITLE_LEN) {
      errors.push(`documents[${i}] title is longer than ${MAX_TITLE_LEN} characters.`)
      return
    }
    if (content.length > MAX_CONTENT_LEN) {
      errors.push(`documents[${i}] ("${title}") is longer than ${MAX_CONTENT_LEN} characters.`)
      return
    }
    const key = title.toLowerCase()
    if (seen.has(key)) {
      errors.push(`Duplicate title "${title}".`)
      return
    }
    seen.add(key)
    documents.push({ title, content })
  })
  return errors.length ? { ok: false, errors } : { ok: true, documents }
}
