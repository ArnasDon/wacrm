-- 900_cb_storage_restringe_listagem.sql
--
-- Fecha a enumeração anônima dos buckets de Storage.
--
-- PROBLEMA
-- As migrations 008 (avatars), 016 (flow-media) e 023 (chat-media) criam uma
-- policy de SELECT em storage.objects para o papel `public`, cobrindo o bucket
-- inteiro. Como `public` inclui o papel `anon`, qualquer pessoa com a chave
-- anon (que é pública, embutida no JS do navegador) podia LISTAR todos os
-- arquivos dos três buckets — inclusive `chat-media`, onde ficam os anexos que
-- clientes enviam pelo WhatsApp. Para um escritório de advocacia, poder
-- enumerar os anexos de clientes é exposição relevante.
--
-- O QUE ESTA MIGRATION FAZ
-- Troca as três policies de SELECT por versões restritas:
--   * avatars    -> qualquer usuário AUTENTICADO (são fotos de perfil da
--                   equipe, exibidas em todo o app; e o upload usa
--                   `upsert: true`, que exige SELECT do próprio objeto)
--   * chat-media -> apenas membros da conta dona da pasta
--   * flow-media -> apenas membros da conta dona da pasta, ou o próprio dono
-- Os predicados espelham exatamente os das policies de DELETE/UPDATE que já
-- existem para cada bucket, então não inventam regra de acesso nova.
--
-- O QUE ESTA MIGRATION *NÃO* RESOLVE
-- Os três buckets continuam `public = true`. Objetos servidos pela rota
-- pública (/storage/v1/object/public/...) NÃO passam por RLS — ou seja, quem
-- souber a URL exata continua acessando o arquivo. Isto aqui fecha a
-- ENUMERAÇÃO, não o acesso direto. Fechar o acesso direto exigiria tornar os
-- buckets privados e trocar `getPublicUrl` por `createSignedUrl` em
-- src/lib/storage/upload-media.ts e em todos os pontos de exibição.
--
-- COMO REVERTER
--   drop policy "Avatars are readable by authenticated users" on storage.objects;
--   create policy "Avatars are publicly readable" on storage.objects
--     for select using (bucket_id = 'avatars');
--   -- (idem para chat-media e flow-media, com `using (bucket_id = '<bucket>')`)

-- ---------------------------------------------------------------- avatars ---
drop policy if exists "Avatars are publicly readable" on storage.objects;

create policy "Avatars are readable by authenticated users"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'avatars');

-- ------------------------------------------------------------- chat-media ---
drop policy if exists "Chat media is publicly readable" on storage.objects;

create policy "Chat media is readable by account members"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'chat-media'
    and exists (
      select 1
      from profiles p
      where p.user_id = auth.uid()
        and ('account-' || p.account_id::text) = (storage.foldername(objects.name))[1]
    )
  );

-- ------------------------------------------------------------- flow-media ---
drop policy if exists "Flow media is publicly readable" on storage.objects;

create policy "Flow media is readable by account members"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'flow-media'
    and (
      exists (
        select 1
        from profiles p
        where p.user_id = auth.uid()
          and ('account-' || p.account_id::text) = (storage.foldername(objects.name))[1]
      )
      or auth.uid()::text = (storage.foldername(name))[1]
    )
  );
