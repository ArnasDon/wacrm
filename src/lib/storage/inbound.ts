import 'server-only';
import { createHash } from 'node:crypto';
import type { SqlConnection } from '@/lib/db/transaction';
import { queryRows } from '@/lib/db/rows';
import { validateStoredType, writeStoredFile, removeStoredFile } from './filesystem';
export interface InboundFile {accountId:string;userId:string;mediaId:string;mime:string;filename:string;buffer:Buffer}
/** Worker-only; transaction and account lock protect deterministic retry recovery. No network work here. */
export async function persistInboundMedia(db:SqlConnection,root:string,input:InboundFile) {
 const digest=createHash('sha256').update(`whatsapp-media:${input.accountId}:${input.mediaId}`).digest('hex');
 const id=`${digest.slice(0,8)}-${digest.slice(8,12)}-${digest.slice(12,16)}-${digest.slice(16,20)}-${digest.slice(20,32)}`;
 const mime=validateStoredType('chat-media',input.mime);
 await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`stored-inbound:${id}`]);
 const [existing]=await queryRows<{id:string;filename:string}>(db,"SELECT id,filename FROM public.stored_objects WHERE id=$1 AND account_id=$2 AND bucket='chat-media'",[id,input.accountId]);
 if(existing) return existing;
 const filename=(input.filename.split(/[\\/]/).pop()??'attachment').replace(/[\u0000-\u001f\u007f]/g,'').slice(0,180)||'attachment';
 // A previous process may have written bytes and crashed before SQL commit.
 await removeStoredFile(root,'chat-media',id).catch(error=>{if((error as NodeJS.ErrnoException).code!=='ENOENT') throw error;});
 async function* source(){yield input.buffer;}
 const bytes=await writeStoredFile(root,'chat-media',id,mime,source());
 try {
  await db.query("INSERT INTO public.stored_objects(id,account_id,user_id,bucket,filename,mime,bytes,is_public) VALUES($1,$2,$3,'chat-media',$4,$5,$6,true)",[id,input.accountId,input.userId,filename,mime,bytes]);
 } catch(error) {await removeStoredFile(root,'chat-media',id).catch(()=>{});throw error;}
 return {id,filename};
}
