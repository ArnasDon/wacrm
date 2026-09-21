-- ============================================================
-- 1011 — `cb_assentar_mensagem_historica`: o eco POSTERIOR à espera respeita a
-- resposta de gente que chegou no meio.
--
-- Migration nova porque a 1010 já estava aplicada (histórico
-- `20260919234759`) quando o Codex achou isto no PR #226. Só troca o CORPO da
-- função — mesma assinatura, mesmos privilégios (o `CREATE OR REPLACE` os
-- preserva; a conferência lá embaixo prova). Nada em produção chama a função
-- até o deploy daquele PR.
--
-- O defeito. No ramo "eco do escritório com carimbo T, e a espera que havia
-- antes (A) começou ANTES de T", a função dizia: a resposta vale para o que
-- veio antes dela — fica esperando a fala de cliente mais antiga DEPOIS de T.
-- Faltava perguntar se essa fala já foi respondida. Entre `historica.ts` ler
-- a espera de antes e chamar a função (algumas idas ao banco) cabe uma resposta
-- REAL da equipe: o gatilho da 972 limpa a espera, certo — e a função a
-- reescrevia com a fala já respondida, acendendo "em atraso" sobre cliente
-- atendido. O ramo irmão (eco ANTERIOR à espera) já tinha essa guarda.
--
-- A correção: só conta a fala de cliente posterior ao eco que NINGUÉM respondeu
-- depois dela. É a mesma régua de "resposta de gente" do resto da função
-- (`sender_id` OU `from_device`, mensagem apagada não conta).
--
-- ⚠️ O que continua de fora, de propósito (janelas de UMA ida ao banco, num
-- caminho que roda ~1 vez a cada 10 dias; o efeito é o selo "em atraso" errado
-- até a próxima mensagem ou resposta — nunca mensagem perdida):
--   · fala de cliente que chega entre a leitura da espera e o insert de um eco
--     histórico numa conversa onde ninguém esperava: o gatilho limpa, e a função
--     não tem como saber (é o comportamento de hoje para qualquer eco atrasado);
--   · fala de cliente que chega entre o insert de uma fala histórica JÁ
--     respondida e esta função, numa conversa onde ninguém esperava.
--   Fechar as duas pede o insert DENTRO da função, com a linha da conversa
--   travada — outra obra, registrada no plano.
-- ============================================================

create or replace function public.cb_assentar_mensagem_historica(
  p_conversation_id uuid,
  p_carimbo         timestamptz,
  p_da_equipe       boolean,
  p_espera_antes    timestamptz,
  p_conta_nao_lida  boolean
)
returns void
language sql
security invoker
set search_path = public
as $$
  update conversations c
  set unread_count = coalesce(c.unread_count, 0)
        + case when p_conta_nao_lida then 1 else 0 end,
      aguardando_desde = case
        when c.group_id is not null or c.status = 'closed' then null

        when p_da_equipe then
          case
            when p_espera_antes is null then c.aguardando_desde
            when p_carimbo > p_espera_antes then (
              select min(m.created_at)
              from messages m
              where m.conversation_id = c.id
                and m.sender_type = 'customer'
                and m.deleted_at is null
                and m.created_at > p_carimbo
                and not exists (
                  select 1
                  from messages h
                  where h.conversation_id = c.id
                    and h.sender_type = 'agent'
                    and (h.sender_id is not null or h.from_device)
                    and h.deleted_at is null
                    and h.created_at > m.created_at
                )
            )
            when exists (
              select 1
              from messages h
              where h.conversation_id = c.id
                and h.sender_type = 'agent'
                and (h.sender_id is not null or h.from_device)
                and h.deleted_at is null
                and h.created_at > p_espera_antes
            ) then c.aguardando_desde
            else least(p_espera_antes, c.aguardando_desde)
          end

        when exists (
          select 1
          from messages h
          where h.conversation_id = c.id
            and h.sender_type = 'agent'
            and (h.sender_id is not null or h.from_device)
            and h.deleted_at is null
            and h.created_at > p_carimbo
        ) then case when c.aguardando_desde = p_carimbo then null else c.aguardando_desde end

        else least(c.aguardando_desde, p_carimbo)
      end,
      updated_at = now()
  where c.id = p_conversation_id;
$$;

comment on function public.cb_assentar_mensagem_historica(uuid, timestamptz, boolean, timestamptz, boolean) is
  'Depois de gravar uma mensagem com carimbo ANTIGO (1010/1011): desfaz o que o gatilho da 972 decidiu pela ordem de insercao (espera preenchida por fala ja respondida; espera limpa por eco anterior a ela), soma a nao lida quando pedida e toca updated_at. So service_role.';

-- As duas metades de novo, e o GRANT de volta: idempotente, e é o que a
-- conferência abaixo cobra num banco criado do zero.
revoke execute on function public.cb_assentar_mensagem_historica(uuid, timestamptz, boolean, timestamptz, boolean)
  from public, anon, authenticated;
grant execute on function public.cb_assentar_mensagem_historica(uuid, timestamptz, boolean, timestamptz, boolean)
  to service_role;

do $$
declare
  v_assinatura text := 'public.cb_assentar_mensagem_historica(uuid, timestamptz, boolean, timestamptz, boolean)';
  v_quantas    int;
begin
  -- UMA função com esse nome: uma sobrecarga esquecida faria o PostgREST
  -- escolher pela lista de argumentos, e o corpo velho voltaria a rodar.
  select count(*) into v_quantas from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'cb_assentar_mensagem_historica';
  if v_quantas <> 1 then
    raise exception '1011: esperava UMA cb_assentar_mensagem_historica; há %', v_quantas;
  end if;

  if has_function_privilege('anon', v_assinatura, 'EXECUTE')
     or has_function_privilege('authenticated', v_assinatura, 'EXECUTE') then
    raise exception '1011: anon/authenticated executam cb_assentar_mensagem_historica';
  end if;
  if not has_function_privilege('service_role', v_assinatura, 'EXECUTE') then
    raise exception '1011: service_role perdeu o EXECUTE de cb_assentar_mensagem_historica';
  end if;

  begin
    set local role service_role;
    perform public.cb_assentar_mensagem_historica(gen_random_uuid(), now(), true, now() - interval '1 hour', false);
    reset role;
  exception when insufficient_privilege then
    raise exception '1011: service_role não consegue executar cb_assentar_mensagem_historica: %', sqlerrm;
  end;

  raise notice '1011: cb_assentar_mensagem_historica com a guarda do eco posterior à espera.';
end $$;
