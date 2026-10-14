import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import type { PoolClient } from 'pg';
import { createTestDatabase } from '@/lib/db/test-database';
import { withIdentity, resolveAccount, type LocalAccountContext } from '@/lib/db/context-core';
import { createContact } from '@/lib/db/contacts';
import { encrypt } from './encryption';

const state = vi.hoisted(() => ({ db: null as PGlite | null }));
vi.mock('@/lib/db/context', () => ({
  withAccount: async <T>(ctx: LocalAccountContext, work: (db: PoolClient) => Promise<T>) => {
    const db = state.db!;
    return withIdentity(db, ctx.userId, async sql => {
      const current = await resolveAccount(sql, ctx.userId);
      if (current.accountId !== ctx.accountId) throw new Error('Account membership changed.');
      return work(sql as unknown as PoolClient);
    });
  },
}));
vi.mock('@/lib/db/pool', () => ({
  withTransaction:async<T>(work:(db:PoolClient)=>Promise<T>)=>{
    await state.db!.exec('SET ROLE omni_worker');
    try{return await transaction(state.db!,sql=>work(sql as unknown as PoolClient));}
    finally{await state.db!.exec('SET ROLE omni_app');}
  },
  getPool: () => ({ query: async (sql: string, values?: unknown[]) => {
    const db = state.db!;
    await db.exec('SET ROLE omni_worker');
    try { return await db.query(sql, values); }
    finally { await db.exec('SET ROLE omni_app'); }
  } }),
}));
vi.mock('./meta-api', async importOriginal => {
  const actual = await importOriginal<typeof import('./meta-api')>();
  return { ...actual, sendTextMessage: vi.fn(), sendTemplateMessage: vi.fn(), sendMediaMessage: vi.fn(), sendInteractiveButtons: vi.fn(), sendInteractiveList: vi.fn() };
});
import { sendTextMessage } from './meta-api';
import { sendLocalMessage, sendAccountMessage } from './send-message-local';
import { engineSendText } from '@/lib/flows/meta-send';
import { transaction } from '@/lib/db/transaction';

const owner = '10000000-0000-4000-8000-000000000001';
const agent = '10000000-0000-4000-8000-000000000002';
const outsider = '10000000-0000-4000-8000-000000000003';
let agentContext: LocalAccountContext;
let outsiderContext: LocalAccountContext;
let conversationId: string;
let otherConversationId: string;
let otherMessageId: string;
let db: PGlite;

beforeAll(async () => {
  db = state.db = await createTestDatabase();
  await db.query('INSERT INTO identity.users(id,name,email) VALUES($1,$2,$3),($4,$5,$6),($7,$8,$9)', [owner,'Owner','owner@send.test',agent,'Agent','agent@send.test',outsider,'Outsider','outside@send.test']);
  const accountId = (await db.query<{account_id:string}>('SELECT account_id FROM public.profiles WHERE user_id=$1',[owner])).rows[0].account_id;
  await db.query("UPDATE public.profiles SET account_id=$1,account_role='agent' WHERE user_id=$2",[accountId,agent]);
  await db.query("INSERT INTO public.whatsapp_config(user_id,account_id,phone_number_id,access_token) VALUES($1,$2,'123456789',$3)",[owner,accountId,encrypt('test-token')]);
  await db.exec(`CREATE FUNCTION public.fail_local_send_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.content_text='fail-persist' THEN RAISE EXCEPTION 'sensitive-test-detail'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER fail_local_send_test BEFORE INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.fail_local_send_test();`);
  await db.exec('SET ROLE omni_app');
  agentContext = await withIdentity(db,agent,sql=>resolveAccount(sql,agent));
  outsiderContext = await withIdentity(db,outsider,sql=>resolveAccount(sql,outsider));
  const contact = await withIdentity(db,owner,sql=>createContact(sql,owner,{phone:'15551234567',name:'Customer'}));
  const otherContact = await withIdentity(db,owner,sql=>createContact(sql,owner,{phone:'15551234568',name:'Other'}));
  const conversations = await withIdentity(db,owner,sql=>sql.query<{id:string}>('INSERT INTO public.conversations(user_id,account_id,contact_id) VALUES($1,$2,$3),($1,$2,$4) RETURNING id',[owner,accountId,contact.id,otherContact.id]));
  [conversationId,otherConversationId] = conversations.rows.map(row=>row.id);
  otherMessageId = (await withIdentity(db,owner,sql=>sql.query<{id:string}>("INSERT INTO public.messages(conversation_id,sender_type,content_text,message_id) VALUES($1,'customer','Other message','other-wamid') RETURNING id",[otherConversationId]))).rows[0].id;
},30000);
afterAll(async()=>{ await db?.close(); });
beforeEach(async()=>{
  vi.mocked(sendTextMessage).mockReset().mockResolvedValue({messageId:'wamid-local-test'});
  await db.exec('RESET ROLE');
  await db.query("UPDATE public.profiles SET account_role='agent' WHERE user_id=$1",[agent]);
  await db.query("DELETE FROM public.messages WHERE conversation_id=$1 AND sender_type IN ('agent','bot')",[conversationId]);
  await db.query('UPDATE public.conversations SET last_message_text=NULL WHERE id=$1',[conversationId]);
  await db.exec('SET ROLE omni_app');
});

it('persists an agent send and preview in the local database',async()=>{
  const result = await sendLocalMessage(agentContext,{conversationId,messageType:'text',contentText:'Hello customer'});
  expect(result.whatsappMessageId).toBe('wamid-local-test');
  const message = await withIdentity(db,agent,sql=>sql.query('SELECT content_text,sender_id FROM public.messages WHERE id=$1',[result.messageId]));
  expect(message.rows[0]).toMatchObject({content_text:'Hello customer',sender_id:agent});
  const conversation = await withIdentity(db,agent,sql=>sql.query('SELECT last_message_text FROM public.conversations WHERE id=$1',[conversationId]));
  expect(conversation.rows[0]).toMatchObject({last_message_text:'Hello customer'});
});
it('rejects a foreign conversation before contacting Meta',async()=>{
  await expect(sendLocalMessage(outsiderContext,{conversationId,messageType:'text',contentText:'Forbidden'})).rejects.toMatchObject({status:404});
  expect(sendTextMessage).not.toHaveBeenCalled();
});
it('rejects a reply target from another conversation before contacting Meta',async()=>{
  await expect(sendLocalMessage(agentContext,{conversationId,messageType:'text',contentText:'Wrong quote',replyToMessageId:otherMessageId})).rejects.toMatchObject({status:400});
  expect(sendTextMessage).not.toHaveBeenCalled();
});
it('rechecks a stale agent role before the external send',async()=>{
  await db.exec('RESET ROLE');
  await db.query("UPDATE public.profiles SET account_role='viewer' WHERE user_id=$1",[agent]);
  await db.exec('SET ROLE omni_app');
  await expect(sendLocalMessage(agentContext,{conversationId,messageType:'text',contentText:'Forbidden'})).rejects.toMatchObject({status:403});
  expect(sendTextMessage).not.toHaveBeenCalled();
});
it('validates message parameters inside the send service',async()=>{
  await expect(sendLocalMessage(agentContext,{conversationId,messageType:'unsupported'})).rejects.toMatchObject({status:400});
  expect(sendTextMessage).not.toHaveBeenCalled();
});
it('reports an accepted send with failed persistence without exposing SQL details',async()=>{
  await expect(sendLocalMessage(agentContext,{conversationId,messageType:'text',contentText:'fail-persist'})).rejects.toMatchObject({code:'db_error',status:500,message:expect.stringMatching(/sent.*save/i)});
  const messages = await withIdentity(db,agent,sql=>sql.query("SELECT id FROM public.messages WHERE conversation_id=$1 AND sender_type='agent'",[conversationId]));
  expect(messages.rows).toEqual([]);
});
it('does not persist a failed Meta send',async()=>{
  vi.mocked(sendTextMessage).mockRejectedValueOnce(new Error('Meta unavailable'));
  await expect(sendLocalMessage(agentContext,{conversationId,messageType:'text',contentText:'Hello'})).rejects.toMatchObject({status:502});
  const messages = await withIdentity(db,agent,sql=>sql.query("SELECT id FROM public.messages WHERE conversation_id=$1 AND sender_type='agent'",[conversationId]));
  expect(messages.rows).toEqual([]);
});
it('uses explicit account scope for trusted worker sends without a cookie identity',async()=>{
  await db.exec('SET ROLE omni_worker');
  await expect(sendAccountMessage({accountId:outsiderContext.accountId,userId:outsider},
    {conversationId,messageType:'text',contentText:'Foreign worker send'},work=>transaction(db,work))).rejects.toMatchObject({status:404});
  expect(sendTextMessage).not.toHaveBeenCalled();
  const result=await sendAccountMessage({accountId:agentContext.accountId,userId:owner},
    {conversationId,messageType:'text',contentText:'API send'},work=>transaction(db,work));
  expect(result.whatsappMessageId).toBe('wamid-local-test');
});
it('records worker bot replies as bot messages with AI attribution',async()=>{
 await db.exec('SET ROLE omni_worker');
 const result=await sendAccountMessage({accountId:agentContext.accountId,userId:owner},
  {conversationId,messageType:'text',contentText:'Bot reply'},work=>transaction(db,work),{senderType:'bot',aiGenerated:true});
 await db.exec('SET ROLE omni_worker');
 expect((await db.query('SELECT sender_type,ai_generated FROM public.messages WHERE id=$1',[result.messageId])).rows[0]).toEqual({sender_type:'bot',ai_generated:true});
});
it('sends a flow bot reply through the local worker and checks the supplied contact',async()=>{
 await db.exec('SET ROLE omni_worker');
 const contactId=(await db.query<{contact_id:string}>('SELECT contact_id FROM public.conversations WHERE id=$1',[conversationId])).rows[0].contact_id;
 await db.exec('SET ROLE omni_app');
 await expect(engineSendText({accountId:agentContext.accountId,userId:owner,contactId:otherMessageId,conversationId,text:'Wrong contact'})).rejects.toThrow();
 expect(sendTextMessage).not.toHaveBeenCalled();
 expect(await engineSendText({accountId:agentContext.accountId,userId:owner,contactId,conversationId,text:'Flow prompt'})).toEqual({whatsapp_message_id:'wamid-local-test'});
});
