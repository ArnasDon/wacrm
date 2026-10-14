import type {SqlConnection} from '@/lib/db/transaction';
import type {LocalAccountContext} from '@/lib/db/context-core';
import {BroadcastStore} from '@/lib/db/broadcasts';
import {parseAudience,resolveBroadcastAudience} from '@/lib/db/broadcast-audience';
import {queryRows} from '@/lib/db/rows';
import {RequestError,requireUUID} from '@/lib/api/local-route';
import {resolveVariables,type VariableMapping} from '@/lib/broadcast-audience';
import {resolveLocalTemplate} from './template-local';
import {loadBroadcastCredentials,type BroadcastPlan} from './broadcast-core';
export async function createDashboardBroadcast(db:SqlConnection,ctx:LocalAccountContext,body:Record<string,unknown>){
 const templateId=requireUUID(body.templateId);const [row]=await queryRows<{name:string;language:string;status:string}>(db,'SELECT name,language,status FROM public.message_templates WHERE account_id=$1 AND id=$2',[ctx.accountId,templateId]);if(!row)throw new RequestError('Template not found.',404);
 const draft=body.draft===true;if(!draft&&row.status!=='APPROVED')throw new RequestError('Choose an approved template.');
 const name=typeof body.name==='string'&&body.name.trim()?body.name.trim():'Broadcast';
 const audience=parseAudience(body.audience);const variables:Record<string,VariableMapping>={};
 if(body.variables&&typeof body.variables==='object'&&!Array.isArray(body.variables))for(const [key,value]of Object.entries(body.variables)){const v=value as VariableMapping;if(!v||!['static','field','custom_field'].includes(v.type)||typeof v.value!=='string')throw new RequestError('Invalid variable mapping.');variables[key]=v;}
 const store=new BroadcastStore(db,ctx.accountId);const headerMediaUrl=typeof body.headerMediaUrl==='string'?body.headerMediaUrl.trim():'';
 const metadata={...audience,csvContacts:undefined,headerMediaUrl};
 if(draft){const campaign=await store.create(ctx.userId,{name,templateName:row.name,language:row.language,recipients:[],variables,audience:metadata,draft:true});return {campaign,plan:null};}
 const credentials=await loadBroadcastCredentials(db,ctx.accountId);const template=await resolveLocalTemplate(db,ctx.accountId,row.name,row.language);if(template.malformed)throw new RequestError('Sync the template from Meta first.');
 const contacts=await resolveBroadcastAudience(db,ctx.accountId,audience,ctx.userId);if(!contacts.length||contacts.length>1000)throw new RequestError('Choose between 1 and 1000 contacts per broadcast.');
 const values=await queryRows<{contact_id:string;custom_field_id:string;value:string}>(db,'SELECT cv.contact_id,cv.custom_field_id,cv.value FROM public.contact_custom_values cv JOIN public.contacts c ON c.id=cv.contact_id WHERE c.account_id=$1 AND c.id=ANY($2::uuid[])',[ctx.accountId,contacts.map(c=>c.id)]);
 const index=new Map<string,Map<string,string>>();for(const value of values){const bucket=index.get(value.contact_id)??new Map();bucket.set(value.custom_field_id,value.value??'');index.set(value.contact_id,bucket);}
 const campaign=await store.create(ctx.userId,{name,templateName:row.name,language:template.language,variables,audience:metadata,recipients:contacts.map(c=>({contactId:c.id,params:resolveVariables(variables,c,index.get(c.id))}))});await store.claim(campaign.id);
 const recipients=await store.recipients(campaign.id);
 const plan:BroadcastPlan={accountId:ctx.accountId,broadcastId:campaign.id,templateName:row.name,templateLanguage:template.language,...credentials,templateRow:template.row,planned:recipients.map(r=>({recipientRowId:r.id,phone:r.contact?.phone??'',params:r.template_params??[]})),rejected:0,...(headerMediaUrl?{messageParams:{headerMediaUrl}}:{})};
 return {campaign,plan};
}
