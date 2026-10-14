import type { SqlConnection } from '@/lib/db/transaction';
import { queryRows } from '@/lib/db/rows';
import { runAutomationsForTrigger, type AutomationContext } from '@/lib/automations/engine';
import { MAX_TAG_CHAIN_DEPTH, getTagChainDepth } from './tag-chain';
interface TagInput {accountId:string;contactId:string;tagId:string}
async function owned(db:SqlConnection,input:TagInput) {
 const [row]=await queryRows<{found:boolean}>(db,'SELECT EXISTS(SELECT 1 FROM public.contacts c JOIN public.tags t ON t.account_id=c.account_id WHERE c.account_id=$1 AND c.id=$2 AND t.id=$3) AS found',[input.accountId,input.contactId,input.tagId]);
 if(!row.found) throw new Error('Contact or tag not found for this account');
}
export async function writeWorkerTag(db:SqlConnection,input:TagInput) {
 await owned(db,input);
 const rows=await queryRows<{contact_id:string}>(db,'INSERT INTO public.contact_tags(contact_id,tag_id) SELECT c.id,t.id FROM public.contacts c JOIN public.tags t ON t.account_id=c.account_id WHERE c.account_id=$1 AND c.id=$2 AND t.id=$3 ON CONFLICT(contact_id,tag_id) DO NOTHING RETURNING contact_id',[input.accountId,input.contactId,input.tagId]);
 return rows.length>0;
}
export async function removeContactTag(db:SqlConnection,input:TagInput) {
 await owned(db,input);
 await db.query('DELETE FROM public.contact_tags ct USING public.contacts c,public.tags t WHERE ct.contact_id=c.id AND ct.tag_id=t.id AND c.account_id=$1 AND t.account_id=$1 AND c.id=$2 AND t.id=$3',[input.accountId,input.contactId,input.tagId]);
}
export async function addContactTagAndDispatch(input:TagInput&{db:SqlConnection;context?:AutomationContext}) {
 const added=await writeWorkerTag(input.db,input);
 if(!added) return {added:false,dispatched:false,reason:'duplicate'};
 const depth=getTagChainDepth(input.context);
 if(depth>=MAX_TAG_CHAIN_DEPTH) return {added:true,dispatched:false,reason:'max_depth'};
 await runAutomationsForTrigger({accountId:input.accountId,contactId:input.contactId,triggerType:'tag_added',context:{...input.context,tag_id:input.tagId,vars:{...input.context?.vars,_tag_chain_depth:depth+1}}});
 return {added:true,dispatched:true};
}
