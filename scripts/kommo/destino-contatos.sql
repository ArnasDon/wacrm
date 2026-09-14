-- ============================================================
-- Migração Kommo → CB CRM: a foto dos contatos do DESTINO, para o cruzamento.
--
-- SÓ LEITURA. Rodar pela API de gerenciamento do Supabase (ou pelo SQL Editor)
-- e salvar o resultado como JSON — uma lista de linhas — FORA do repositório:
-- tem telefone e nome de cliente. Depois:
--   node scripts/kommo/cruzamento.mjs --kommo <kommo-bruto.json> --destino <este.json>
--
-- A conta é a de mais contatos (a do escritório); as contas de teste têm
-- poucos cadastros.
-- ============================================================
with conta as (
  select account_id as id from contacts group by account_id order by count(*) desc limit 1
)
select c.id, c.phone_normalized, c.name, c.created_at,
       c.nome_fixado_em is not null as nome_fixado,
       exists (select 1 from contact_tags ct join tags t on t.id = ct.tag_id
                where ct.contact_id = c.id and t.name = 'asaas') as da_asaas,
       exists (select 1 from conversations cv where cv.contact_id = c.id) as tem_conversa,
       (select count(*) from messages m join conversations cv on cv.id = m.conversation_id
         where cv.contact_id = c.id) as mensagens,
       exists (select 1 from deals d where d.contact_id = c.id) as tem_negocio,
       (select count(*) from contact_custom_values v
         where v.contact_id = c.id and coalesce(v.value, '') <> '') as campos_preenchidos
  from contacts c
 where c.account_id = (select id from conta);
