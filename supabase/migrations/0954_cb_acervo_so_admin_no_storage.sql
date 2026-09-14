-- ============================================================
-- 954 — O arquivo do acervo só é mexido por admin, também no Storage
--
-- ⚠️ BURACO QUE ESTA MIGRATION FECHA (achado pela revisão do Codex no PR #65):
-- a 953 pôs os arquivos do acervo dentro do bucket `chat-media`, sob
-- `account-<conta>/acervo/`, e deixou a rota `/api/cb/acervo` exigir admin
-- para apagar. Só que as policies de Storage da 023 conferem APENAS o primeiro
-- segmento do caminho — quem é da conta escreve e apaga qualquer objeto dela.
-- E o caminho não é segredo: a policy de SELECT da 953 mostra `media_path` a
-- todo membro, `viewer` incluso.
--
-- Ou seja: um `viewer` podia chamar `storage.remove([...])` do próprio
-- navegador e apagar o contrato-padrão do escritório — ou, pior, dar UPDATE e
-- TROCAR o conteúdo do arquivo mantendo o nome, sem que nada na tela mudasse.
-- A linha continuaria na lista, apontando para um arquivo sumido (404 na cara
-- do cliente) ou para um arquivo que não é mais o que diz ser.
--
-- A guarda de papel tinha de estar nas DUAS camadas. Aqui ela vale para
-- INSERT, UPDATE e DELETE de qualquer objeto sob `acervo/`.
--
-- ⚠️ O que NÃO muda: anexo comum de mensagem (`account-<conta>/<arquivo>`)
-- continua exatamente como estava — qualquer membro que envia precisa subir e
-- precisa apagar (é o próprio compositor que apaga o rascunho descartado). A
-- diferença de tratamento é o ponto: anexo é da mensagem de quem enviou; o
-- acervo é acervo do escritório.
--
-- ⚠️ `service_role` ignora RLS, então as rotas de acervo seguem funcionando.
-- ============================================================

-- ------------------------------------------------------------
-- Predicado, em palavras: é membro da conta dona da pasta E
-- (o objeto NÃO está no acervo OU o papel é admin/owner).
--
-- `(storage.foldername(name))[2]` é a segunda pasta do caminho. Num anexo
-- comum (`account-x/123-foto.png`) ela é NULA — daí `IS DISTINCT FROM`, e não
-- `<>`: com `<>` o NULL faria a expressão inteira virar NULL, a policy
-- reprovaria, e NINGUÉM mais conseguiria apagar anexo de mensagem.
-- ------------------------------------------------------------

DROP POLICY IF EXISTS "Members can upload chat media" ON storage.objects;
CREATE POLICY "Members can upload chat media"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'chat-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
        AND (
          (storage.foldername(name))[2] IS DISTINCT FROM 'acervo'
          OR p.account_role IN ('owner', 'admin')
        )
    )
  );

DROP POLICY IF EXISTS "Members can update chat media" ON storage.objects;
CREATE POLICY "Members can update chat media"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'chat-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
        AND (
          (storage.foldername(name))[2] IS DISTINCT FROM 'acervo'
          OR p.account_role IN ('owner', 'admin')
        )
    )
  );

DROP POLICY IF EXISTS "Members can delete chat media" ON storage.objects;
CREATE POLICY "Members can delete chat media"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'chat-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
        AND (
          (storage.foldername(name))[2] IS DISTINCT FROM 'acervo'
          OR p.account_role IN ('owner', 'admin')
        )
    )
  );

-- ------------------------------------------------------------
-- Conferência
--
-- ⚠️ Prova a REGRA, não o dado: monta as combinações em memória e confere o
-- predicado. Assim vale em banco vazio (o CI reaplica tudo do zero) e não
-- depende de existir um viewer cadastrado — que nesta conta, hoje, nem existe.
-- ------------------------------------------------------------
DO $$
DECLARE
  v_conta text := 'account-11111111-1111-1111-1111-111111111111';
  v_pode boolean;
BEGIN
  -- A mesma expressão das policies, com o papel e o caminho variando.
  FOR v_pode IN
    SELECT (
      (storage.foldername(caminho))[2] IS DISTINCT FROM 'acervo'
      OR papel IN ('owner', 'admin')
    ) = esperado
    FROM (VALUES
      (v_conta || '/acervo/1-contrato.pdf', 'viewer', false),
      (v_conta || '/acervo/1-contrato.pdf', 'agent',  false),
      (v_conta || '/acervo/1-contrato.pdf', 'admin',  true),
      (v_conta || '/acervo/1-contrato.pdf', 'owner',  true),
      -- Anexo comum: todo membro segue podendo, inclusive viewer. Se este
      -- caso virar `false`, o compositor perde a limpeza do rascunho.
      (v_conta || '/1-foto.png',            'viewer', true),
      (v_conta || '/1-foto.png',            'agent',  true)
    ) AS t(caminho, papel, esperado)
  LOOP
    IF NOT v_pode THEN
      RAISE EXCEPTION '954: o predicado de papel no acervo não bate com o esperado.';
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Members can delete chat media'
      AND qual LIKE '%acervo%'
  ) THEN
    RAISE EXCEPTION '954: a policy de DELETE do chat-media não carrega a guarda do acervo.';
  END IF;
END $$;
