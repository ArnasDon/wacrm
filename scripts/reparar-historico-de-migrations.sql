-- ============================================================
-- Reparo ÚNICO do histórico de migrations: 3 dígitos → 4 dígitos.
--
-- QUEM PRECISA: instalação que aplicou as migrations com `supabase db push`
-- ANTES de 14/09/2026, quando os arquivos de `supabase/migrations/` foram
-- renomeados de `001_…` para `0001_…`.
--
-- POR QUÊ: o `db push` registra cada migration pelo PREFIXO do arquivo
-- (`001`, `998`) em `supabase_migrations.schema_migrations`. Depois da
-- renomeação os arquivos passaram a se chamar `0001`, `0998`, e o próximo
-- `db push` encontra no histórico versões que não existem mais nos arquivos
-- locais — e recusa aplicar qualquer coisa. Este UPDATE troca só o
-- identificador no histórico: nenhuma migration roda de novo.
--
-- COMO: no painel do Supabase, SQL Editor, cole e rode. Depois,
-- `supabase db push` volta a funcionar.
--
-- SEGURO DE RODAR EM QUALQUER INSTALAÇÃO, e mais de uma vez:
--   · só toca versão de EXATAMENTE 3 dígitos — histórico registrado por
--     timestamp (`20260721164546`, o caso de quem aplicou por outro caminho)
--     não casa e fica como está;
--   · rodado de novo, não acha mais nada de 3 dígitos e não faz nada.
--
-- Por que 3 dígitos NÃO bastavam mais: o replay aplica as migrations em
-- ordem de NOME, e `1000_` ordenaria antes de `900_`. Ver
-- `supabase/migrations/nomes-das-migrations.test.ts`.
-- ============================================================

UPDATE supabase_migrations.schema_migrations
   SET version = lpad(version, 4, '0')
 WHERE version ~ '^[0-9]{3}$';

-- Conferência: não pode sobrar versão de 3 dígitos.
SELECT count(*) AS versoes_de_3_digitos_restantes
  FROM supabase_migrations.schema_migrations
 WHERE version ~ '^[0-9]{3}$';
