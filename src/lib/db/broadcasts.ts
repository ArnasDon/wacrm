import type { SqlConnection } from './transaction';
import { queryRows } from './rows';
import type { Broadcast, BroadcastRecipient, Contact } from '@/types';
import { RequestError } from '@/lib/api/local-route';
export interface CreateCampaign {
  name: string;
  templateName: string;
  language: string;
  recipients: { contactId: string; params: string[] }[];
  variables: Record<string, unknown>;
  audience: Record<string, unknown>;
  draft?: boolean;
}
export class BroadcastStore {
  constructor(
    private db: SqlConnection,
    private accountId: string
  ) {}
  list() {
    return queryRows<Broadcast>(
      this.db,
      'SELECT * FROM public.broadcasts WHERE account_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1000',
      [this.accountId]
    );
  }
  async get(id: string) {
    return (
      (
        await queryRows<Broadcast>(
          this.db,
          'SELECT * FROM public.broadcasts WHERE account_id=$1 AND id=$2',
          [this.accountId, id]
        )
      )[0] ?? null
    );
  }
  recipients(id: string, statuses?: string[]) {
    return queryRows<BroadcastRecipient & { contact: Contact | null }>(
      this.db,
      `SELECT r.*,to_jsonb(c) AS contact FROM public.broadcast_recipients r JOIN public.broadcasts b ON b.id=r.broadcast_id LEFT JOIN public.contacts c ON c.id=r.contact_id AND c.account_id=b.account_id WHERE b.account_id=$1 AND b.id=$2 AND ($3::text[] IS NULL OR r.status=ANY($3::text[])) ORDER BY r.created_at,r.id`,
      [this.accountId, id, statuses ?? null]
    );
  }
  async create(userId: string, input: CreateCampaign) {
    const [row] = await queryRows<Broadcast>(
      this.db,
      'INSERT INTO public.broadcasts(account_id,user_id,name,template_name,template_language,template_variables,audience_filter,status,total_recipients) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9) RETURNING *',
      [
        this.accountId,
        userId,
        input.name,
        input.templateName,
        input.language,
        JSON.stringify(input.variables),
        JSON.stringify(input.audience),
        input.draft ? 'draft' : 'sending',
        input.recipients.length,
      ]
    );
    for (const recipient of input.recipients) {
      const inserted = await queryRows(
        this.db,
        "INSERT INTO public.broadcast_recipients(broadcast_id,contact_id,status,template_params) SELECT $2,id,'pending',$4::jsonb FROM public.contacts WHERE account_id=$1 AND id=$3 RETURNING id",
        [
          this.accountId,
          row.id,
          recipient.contactId,
          JSON.stringify(recipient.params),
        ]
      );
      if (!inserted.length)
        throw new RequestError('Recipient does not belong to this account.');
    }
    return row;
  }
  async delete(id: string) {
    const [row] = await queryRows<{ delivery_locked_at: string | null }>(
      this.db,
      'SELECT delivery_locked_at FROM public.broadcasts WHERE account_id=$1 AND id=$2 FOR UPDATE',
      [this.accountId, id]
    );
    if (row?.delivery_locked_at)
      throw new RequestError(
        'Wait for the delivery pass to finish before deleting.',
        409
      );
    await this.db.query(
      'DELETE FROM public.broadcasts WHERE account_id=$1 AND id=$2',
      [this.accountId, id]
    );
  }
  async claim(id: string, now = new Date()) {
    return (
      (
        await queryRows(
          this.db,
          'UPDATE public.broadcasts SET delivery_locked_at=$3 WHERE account_id=$1 AND id=$2 AND (delivery_locked_at IS NULL OR delivery_locked_at<$4) RETURNING id',
          [
            this.accountId,
            id,
            now.toISOString(),
            new Date(now.getTime() - 1800000).toISOString(),
          ]
        )
      ).length > 0
    );
  }
  async release(id: string) {
    await this.db.query(
      'UPDATE public.broadcasts SET delivery_locked_at=NULL WHERE account_id=$1 AND id=$2',
      [this.accountId, id]
    );
  }
  async sending(id: string) {
    await this.db.query(
      "UPDATE public.broadcasts SET status='sending',updated_at=now() WHERE account_id=$1 AND id=$2",
      [this.accountId, id]
    );
  }
  async stamp(
    id: string,
    recipientId: string,
    messageId: string | null,
    error: string | null
  ) {
    await this.db.query(
      `UPDATE public.broadcast_recipients r SET status=CASE WHEN $4::text IS NULL THEN 'failed' ELSE CASE WHEN r.status IN ('delivered','read','replied') THEN r.status ELSE 'sent' END END,whatsapp_message_id=COALESCE($4,r.whatsapp_message_id),sent_at=CASE WHEN $4::text IS NULL THEN r.sent_at ELSE COALESCE(r.sent_at,now()) END,error_message=$5 FROM public.broadcasts b WHERE b.account_id=$1 AND b.id=$2 AND r.broadcast_id=b.id AND r.id=$3`,
      [this.accountId, id, recipientId, messageId, error]
    );
  }
  async finalize(id: string) {
    await this.db.query(
      `UPDATE public.broadcasts b SET status=CASE WHEN NOT EXISTS(SELECT 1 FROM public.broadcast_recipients r WHERE r.broadcast_id=b.id AND r.status<>'failed') AND EXISTS(SELECT 1 FROM public.broadcast_recipients r WHERE r.broadcast_id=b.id) THEN 'failed' ELSE 'sent' END,updated_at=now() WHERE b.account_id=$1 AND b.id=$2 AND NOT EXISTS(SELECT 1 FROM public.broadcast_recipients r WHERE r.broadcast_id=b.id AND r.status='pending')`,
      [this.accountId, id]
    );
  }
}
