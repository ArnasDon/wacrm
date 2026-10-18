<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Supabase Management & Migrations (Autonomous Execution)
- O projeto do Supabase é `advgpexabtbvkvpqxqjl` (região `sa-east-1`, São Paulo).
- O `SUPABASE_ACCESS_TOKEN` está permanentemente gravado no `.env.local` e nas Variáveis de Ambiente do Usuário do Windows.
- O assistente Antigravity tem permissão e capacidade para executar migrações e comandos DDL (`ALTER TABLE`, `CREATE INDEX`, etc.) autonomamente de ponta a ponta sem pedir intervenção manual do usuário, utilizando a API de Gerenciamento do Supabase:
  `POST https://api.supabase.com/v1/projects/advgpexabtbvkvpqxqjl/database/query`
  Header: `Authorization: Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`
  Body: `{ "query": "<sql>" }`
