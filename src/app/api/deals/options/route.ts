import { accountRoute, requireUUID } from '@/lib/api/local-route';
import { queryRows } from '@/lib/db/rows';
import type { Contact, Profile, Conversation } from '@/types';
export function GET(request: Request) {
  return accountRoute(request, 'viewer', async (db, ctx) => {
    const contactId = new URL(request.url).searchParams.get('contactId');
    if (contactId) {
      const [conversation] = await queryRows<Conversation>(
        db,
        'SELECT * FROM public.conversations WHERE account_id=$1 AND contact_id=$2 ORDER BY last_message_at DESC NULLS LAST LIMIT 1',
        [ctx.accountId, requireUUID(contactId)]
      );
      return { conversation: conversation ?? null };
    }
    return {
      contacts: await queryRows<Contact>(
        db,
        'SELECT * FROM public.contacts WHERE account_id=$1 ORDER BY name,id LIMIT 2000',
        [ctx.accountId]
      ),
      profiles: await queryRows<
        Pick<Profile, 'id' | 'full_name' | 'avatar_url'>
      >(
        db,
        'SELECT id,full_name,avatar_url FROM public.profiles WHERE account_id=$1 ORDER BY full_name,id',
        [ctx.accountId]
      ),
    };
  });
}
