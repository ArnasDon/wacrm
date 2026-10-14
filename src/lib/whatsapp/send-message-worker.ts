import 'server-only';
import { withTransaction } from '@/lib/db/pool';
import { queryRows } from '@/lib/db/rows';
import { sendAccountMessage } from './send-message-local';
import type { SendMessageParams } from './send-message-shared';
export interface WorkerSendIdentity {accountId:string;userId:string;conversationId:string;contactId:string}
/** Internal worker API only. The engine supplies account identity from stored, owned records. */
export async function sendWorkerMessage(identity:WorkerSendIdentity,params:Omit<SendMessageParams,'conversationId'>,aiGenerated=false) {
 const run=async<T>(work:(db:import('@/lib/db/transaction').SqlConnection)=>Promise<T>)=>withTransaction(async db=>{
  const [owned]=await queryRows<{id:string}>(db,'SELECT c.id FROM public.conversations c JOIN public.contacts ct ON ct.id=c.contact_id AND ct.account_id=$1 WHERE c.account_id=$1 AND c.id=$2 AND c.contact_id=$3',[identity.accountId,identity.conversationId,identity.contactId]);
  if(!owned) throw new Error('Conversation/contact not found for this account');
  return work(db);
 },'worker');
 const sent=await sendAccountMessage(identity,{...params,conversationId:identity.conversationId},run,{senderType:'bot',aiGenerated});
 return {whatsapp_message_id:sent.whatsappMessageId};
}
