import * as nextEnv from '@next/env';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { withWorkerLock } from '../src/lib/db/worker-lock-core';

async function main() {
nextEnv.loadEnvConfig(process.cwd());
if (!process.env.WORKER_DATABASE_URL) throw new Error('Configure WORKER_DATABASE_URL.');
const pool = new Pool({ connectionString: process.env.WORKER_DATABASE_URL, max: 2, connectionTimeoutMillis: 5000 });
let inside=0;
let peak=0;
let completed=0;
try {
  const key=`flow-lock-check:${randomUUID()}`;
  await Promise.all([1,2].map(()=>withWorkerLock(pool,key,async()=>{
    inside++;
    peak=Math.max(peak,inside);
    await new Promise(resolve=>setTimeout(resolve,50));
    inside--;
    completed++;
  })));
  if(peak!==1 || completed!==2)throw new Error('Contact dispatches were not serialized.');
  console.log('Actual PostgreSQL: two concurrent worker dispatches serialized, both completed.');
} finally {await pool.end();}
}
void main().catch(error=>{console.error(error.message);process.exitCode=1;});
