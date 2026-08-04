# Roadmap — wacrm

> Planejamento de funcionalidades futuras. Para o que já existe e funciona, ver `STATUS_PROJETO.md`.

## Prioridade alta

### 1. Decisão sobre WhatsApp real
Bloqueado por restrição do Meta no WABA (Solution Provider = Kommo, verificação de negócio nunca completada). Dois caminhos possíveis:
- **Contatar o suporte do Kommo** pedindo que completem a verificação — caminho recomendado, ainda não executado (a mensagem de suporte não foi redigida).
- Aceitar o bloqueio por ora e seguir operando o wacrm só com os dados já migrados, sem envio/recebimento real via WhatsApp, até resolver.

Sem isso, o CRM funciona como base de contatos/CRM mas não substitui o Kommo na função principal (atendimento via WhatsApp).

### 2. Segmentação imobiliária — etapa 5 (Transmissões)
`src/components/broadcasts/step2-select-audience.tsx` hoje seleciona audiência só por OR (`.in('tag_id', audience.tagIds)`). Replicar o toggle Qualquer/Todas já implementado em Contatos, reaproveitando `filter_contacts_by_all_tags` e `groupTagsByCategory` (`src/lib/contacts/tag-categories.ts`). Custo estimado: baixo, é o mesmo padrão já validado em produção.

### 3. Segmentação imobiliária — etapa 6 (badges de resumo)
Mostrar contagem de leads por categoria/tag (ex.: um card "Bessa — 12 leads" nas Configurações ou no Dashboard). Requer uma query de agregação simples (`GROUP BY tag_id` via `contact_tags`); não tem RPC pronta ainda.

## Prioridade média

### 4. Módulo de Follow-up / Tarefas
Já analisado em sessão anterior (não implementado). Infra reaproveitável identificada:
- Tabela `notifications` existente pode servir de base para lembretes.
- `src/lib/push/send.ts` já resolve o envio de push por conta.
- Padrão de cron já existe (`/api/automations/cron`, `/api/flows/cron`) — um `/api/followups/cron` seguiria o mesmo modelo.
Falta: schema de tarefas/lembretes (dono, contato relacionado, data, status), UI de criação/listagem, e o endpoint de cron em si.

### 5. Exportação CSV de contatos/negócios
Gap identificado no diagnóstico comparativo com o Kommo. Não há import/export simétrico hoje (import existe, export não).

### 6. Movimentação automática de estágio no funil (pipeline)
Outro gap do diagnóstico — hoje a movimentação entre estágios do Kanban é sempre manual; automações não conseguem mover um deal de estágio como ação.

## Prioridade baixa / ideias não detalhadas

- Ampliar a lista de categorias de segmentação além das 7 atuais, se o negócio pedir (ex.: "Fonte do lead", "Corretor responsável").
- Avaliar se vale a pena expor a segmentação também na API pública v1 (`src/app/api/v1/*`) para integrações externas (ex.: um formulário do site que já credite o lead com tags).

## Fora de escopo por enquanto

- Qualquer trabalho em outros projetos do usuário (ex.: sistema de Gestão de Locações) — este roadmap cobre só o wacrm.
