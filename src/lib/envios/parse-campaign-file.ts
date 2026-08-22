/**
 * Parser for the real "Upload da campanha" JSON — the file the
 * Campanhas system already exports for a campaign, reused as the
 * single input for creating an Envio:
 *
 *   {
 *     "campaign": { "name": "...", ... },
 *     "creative": { "url": "..." },
 *     "messages": ["Variante A...", "Variante B...", "Variante C..."],
 *     "recipients": [
 *       { "name": "...", "phone": "...", "message": "...", "order": 1 }
 *     ]
 *   }
 *
 * `messages` (A/B/C+ variants) is optional. When present, it replaces
 * `recipients[i].message` entirely — WACRM rotates the variants
 * round-robin across leads within each lote (see
 * `src/lib/envios/lote-engine.ts`'s `variantIndexForPosition`), and
 * `recipients[i].message` is ignored / not required. When absent, the
 * legacy behavior applies: each recipient's `message` is already the
 * final, personalized text — there is no `{{placeholder}}` for WACRM
 * to fill in, so the message is per-lead, not a shared campaign-level
 * field.
 *
 * Shared by both the client (live preview on the "new envio" page)
 * and the server (POST /api/envios, the authoritative parse before
 * insert) — one place validates the format, so the two can never
 * drift. `id`, `contact_id`, `type`, `created_at`, `approved_at` are
 * read but intentionally not carried forward — they're the source
 * system's own bookkeeping, unused anywhere in the Envios flow.
 */

export interface ParsedCampaignLead {
  nome: string | null;
  telefone: string;
  /** Null when `messages` variants are used at the file level — the final per-lead text is chosen by round-robin rotation instead (see `ParsedCampaignFile.variants`). */
  mensagem: string | null;
}

export interface ParsedCampaignFile {
  /** Suggested envio name from `campaign.name` — the caller may still let the user edit it. */
  nome: string;
  /** Shared image URL (`creative.url`) — already hosted, used as-is. */
  imagemUrl: string;
  /** Sorted by `recipients[i].order` ascending — lote assignment must follow this sequence. */
  leads: ParsedCampaignLead[];
  /** A/B/C+ message variants from the file's `messages` field, or `null` when the file uses the legacy per-recipient `message` field instead. */
  variants: string[] | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

export function parseCampaignFile(raw: string): ParsedCampaignFile {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('Arquivo não é um JSON válido');
  }

  const root = asRecord(data);
  if (!root) throw new Error('Arquivo não é um JSON válido');

  const campaign = asRecord(root.campaign);
  const nome = campaign?.name;
  if (typeof nome !== 'string' || !nome.trim()) {
    throw new Error('Campo "campaign.name" ausente no arquivo');
  }

  const creative = asRecord(root.creative);
  const imagemUrl = creative?.url;
  if (typeof imagemUrl !== 'string' || !imagemUrl.trim()) {
    throw new Error('Campo "creative.url" ausente no arquivo');
  }

  let variants: string[] | null = null;
  if (root.messages !== undefined) {
    if (!Array.isArray(root.messages) || root.messages.length === 0) {
      throw new Error('Campo "messages" deve ser uma lista não vazia de variantes de mensagem');
    }
    variants = root.messages.map((m, i) => {
      if (typeof m !== 'string' || !m.trim()) {
        throw new Error(`messages[${i}] deve ser uma string não vazia`);
      }
      return m.trim();
    });
  }

  const recipients = root.recipients;
  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw new Error('Campo "recipients" ausente ou vazio no arquivo');
  }

  const withOrder = recipients.map((raw, i) => {
    const rec = asRecord(raw);
    const telefone = typeof rec?.phone === 'string' ? rec.phone.trim() : '';
    if (!telefone) throw new Error(`recipients[${i}].phone ausente no arquivo`);

    // With `messages` variants present, the per-recipient message is
    // unused — the final text is assigned later by round-robin
    // rotation (see ParsedCampaignFile.variants).
    let mensagem: string | null = null;
    if (!variants) {
      mensagem = typeof rec?.message === 'string' ? rec.message.trim() : '';
      if (!mensagem) throw new Error(`recipients[${i}].message ausente no arquivo`);
    }

    const order = typeof rec?.order === 'number' && Number.isFinite(rec.order) ? rec.order : i;
    const nome = typeof rec?.name === 'string' ? rec.name : null;

    return { nome, telefone, mensagem, order };
  });

  // Preserve the source system's sequence (recipients[i].order) — lote
  // assignment slices this sorted array, not raw file/insertion order.
  const leads = [...withOrder]
    .sort((a, b) => a.order - b.order)
    .map((lead) => ({ nome: lead.nome, telefone: lead.telefone, mensagem: lead.mensagem }));

  return { nome: nome.trim(), imagemUrl: imagemUrl.trim(), leads, variants };
}
