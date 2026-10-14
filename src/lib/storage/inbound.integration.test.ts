import { beforeAll, afterAll, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDatabase } from '@/lib/db/test-database';
import { transaction } from '@/lib/db/transaction';
import { persistInboundMedia } from './inbound';
import { readStoredFile } from './filesystem';
let db:PGlite;let root:string;let account:string;
const user='10000000-0000-4000-8000-000000000001';
beforeAll(async()=>{
 root=await mkdtemp(resolve('.cache/inbound-storage-'));
 db=await createTestDatabase();
 await db.query("INSERT INTO identity.users(id,name,email) VALUES($1,'Owner','inboundstorage@test.local')",[user]);
 account=(await db.query<{account_id:string}>('SELECT account_id FROM public.profiles WHERE user_id=$1',[user])).rows[0].account_id;
 await db.exec('SET ROLE omni_worker');
},30000);
afterAll(async()=>{await db?.close();if(root&&resolve(root).startsWith(resolve('.cache/inbound-storage-'))) await rm(root,{recursive:true,force:true});});
it('stores durable media once per account/media ID and rejects unsupported files',async()=>{
 const input={accountId:account,userId:user,mediaId:'12345678',mime:'text/plain',filename:'invoice.txt',buffer:Buffer.from('Invoice')};
 const first=await transaction(db,sql=>persistInboundMedia(sql,root,input));
 expect(await transaction(db,sql=>persistInboundMedia(sql,root,input))).toEqual(first);
 expect((await readStoredFile(root,'chat-media',first.id)).toString()).toBe('Invoice');
 const rows=(await db.query('SELECT filename,is_public FROM public.stored_objects')).rows;
 expect(rows).toEqual([{filename:'invoice.txt',is_public:true}]);
 await expect(transaction(db,sql=>persistInboundMedia(sql,root,{...input,mediaId:'999',mime:'text/html'}))).rejects.toThrow();
 expect((await db.query('SELECT id FROM public.stored_objects')).rows.length).toBe(1);
});
