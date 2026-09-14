-- ============================================================
-- 973 — Foto de perfil do contato: quando conferimos pela última vez
--
-- Pedido do operador em 2026-09-03 (sistema de referência mostra a foto do
-- WhatsApp do cliente; o nosso mostrava só a inicial). `contacts.avatar_url`
-- existe desde a 001 e a lista/painel já a exibem — só ninguém a preenchia
-- (grupos recebem foto via `findChats`; contatos, não).
--
-- A coluna nova guarda QUANDO a foto foi conferida na Evolution, com ou sem
-- resultado. Sem ela, quem esconde a foto no WhatsApp (a API devolve `null`)
-- geraria uma chamada à Evolution a CADA mensagem, para sempre. A régua de
-- revalidação (30 dias) é de código: `src/lib/contacts/foto-de-perfil.ts`.
--
-- A foto em si é BAIXADA para o bucket `chat-media`, em
-- `account-<conta>/avatares/<contato>.jpg` — a URL que o WhatsApp devolve é
-- assinada e expira. Nenhuma policy nova: as da 020/023 casam só o primeiro
-- segmento do caminho, e o objeto é escrito por service-role.
-- ============================================================

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS avatar_checked_at timestamptz;

COMMENT ON COLUMN public.contacts.avatar_checked_at IS
  'Última conferência da foto de perfil na Evolution (com ou sem foto). NULL = nunca conferida. Revalidação: 30 dias, em código.';

-- Conferência: a coluna existe. (Afirmar presença de COLUNA é seguro em
-- banco vazio — não depende de dado.)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'contacts'
      AND column_name = 'avatar_checked_at'
  ) THEN
    RAISE EXCEPTION '973: contacts.avatar_checked_at não foi criada';
  END IF;
END $$;
