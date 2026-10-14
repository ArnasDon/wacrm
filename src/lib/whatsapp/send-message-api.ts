import 'server-only';
import {withApiKeyAccount,type LocalApiKeyContext} from '@/lib/auth/api-context-local';
import {sendAccountMessage} from './send-message-local';
import type {SendMessageParams} from './send-message-shared';

export async function sendApiMessage(context:LocalApiKeyContext,params:SendMessageParams) {
  const auditUserId=await withApiKeyAccount(context,'messages:send',async(_db,userId)=>userId);
  return sendAccountMessage({accountId:context.accountId,userId:auditUserId},params,
    work=>withApiKeyAccount(context,'messages:send',db=>work(db)));
}
