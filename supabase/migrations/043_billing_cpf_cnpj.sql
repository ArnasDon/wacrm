-- ============================================================
-- 043_billing_cpf_cnpj.sql — CPF/CNPJ do responsável pela conta
--
-- Descoberto no smoke test contra o sandbox real do Asaas (não
-- estava nos itens "confirmar na prática" da spec original): o
-- Asaas exige CPF ou CNPJ no cadastro do cliente para poder gerar
-- a cobrança de uma assinatura — sem isso, POST /subscriptions
-- falha com "Para criar esta cobrança é necessário preencher o
-- CPF ou CNPJ do cliente." mesmo com o cliente já criado.
--
-- Não faz parte das 5 colunas protegidas por
-- protect_billing_columns_trigger (042_billing.sql): esta é a
-- identidade fiscal do dono da conta, não um estado de assinatura
-- ditado pelo Asaas — o próprio owner pode corrigir.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS cpf_cnpj TEXT;
