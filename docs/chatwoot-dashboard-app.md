# Chatwoot Dashboard App

## Objetivo

O WACRM fornece o funil comercial dentro da conversa do Chatwoot. Chatwoot continua sendo a fonte de verdade para mensagens, canais, contatos e atribuições; WACRM mantém negócios, pipelines e estágios.

## Configuração

1. Defina `NEXT_PUBLIC_CHATWOOT_ORIGIN` e `CHATWOOT_DASHBOARD_ORIGIN` com o domínio HTTPS exato do Chatwoot.
2. Aplique a migração `037_chatwoot_deal_links.sql` no Supabase.
3. Em Chatwoot, vá a **Settings → Integrations → Dashboard apps** e cadastre `https://<dominio-wacrm>/embedded`.
4. Entre no WACRM com um usuário membro da mesma account que usará o pipeline.

## Segurança

O painel aceita `postMessage` apenas da origem configurada e só permite framing por essa origem. O payload do Chatwoot não é tratado como credencial: todas as leituras e escritas dependem da sessão WACRM e das políticas RLS da account.

## n8n e Supabase

A tabela `chatwoot_deal_links` associa `chatwoot_conversation_id` ao `deal_id`. No n8n, use o node Supabase para localizar esse vínculo e atualizar `deals.stage_id`. As políticas RLS são para usuários finais; automações devem usar uma credencial de servidor guardada no n8n, nunca no navegador.

Antes de automatizar movimentações, registre uma regra por etapa e valide que o `deal_id` e a account correspondem ao mesmo vínculo. O próximo incremento adicionará endpoint assinado e eventos de mudança de etapa para evitar que o n8n escreva diretamente no banco.
