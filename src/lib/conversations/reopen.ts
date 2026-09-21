import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Devolve à caixa de entrada uma conversa encerrada em que alguém acabou de
 * falar — o cliente OU a equipe (decisão do operador, 2026-09-02).
 *
 * Nasceu no upstream (issue #409) só para o cliente: a ingestão incrementava
 * `unread_count` e deixava `status` em paz, então a conversa encerrada
 * acumulava mensagens não lidas parecendo resolvida, fora do filtro de
 * abertas. Aqui virou a regra que sustenta a caixa de entrada inteira: a aba
 * "Abertas" esconde as encerradas, e isso só é confiável se encerrada
 * significar "não há nada a fazer" — logo QUALQUER mensagem nova (recebida,
 * enviada pelo CRM, pelo celular pareado, agendada, pela API) a reabre.
 *
 * ⚠️ SEIS caminhos chamam isto, em cinco arquivos, e há teste estrutural
 * cobrando cada um (`reopen.chamadores.test.ts`): a ingestão da Meta
 * (`webhook/route.ts`), a ingestão da Evolution e o celular pareado
 * (`inbound-store.ts`, DUAS funções), o núcleo de envio (`send-message.ts`),
 * o Instagram (`instagram/persistir.ts`) e a recuperada tardia
 * (`sem-telefone/tardia.ts`). Até 2026-09-02 só o primeiro chamava — e
 * produção roda Evolution: a regra existia e não valia para nenhuma mensagem
 * real. Todos chamam DEPOIS de gravar a mensagem, e isso é parte do contrato
 * (ver "quem decide é o banco", abaixo).
 *
 * ⚠️ Broadcast, automação, fluxo e resposta de IA NÃO reabrem, de propósito.
 * Ficam de fora por não passarem por nenhum dos quatro caminhos, sem uma
 * linha de guarda — o mesmo desenho do roteador de funil. Um disparo para
 * 500 encerradas devolveria as 500 à caixa de uma vez, e "o robô respondeu"
 * não é gente decidindo retomar um atendimento. Se o cliente responder, a
 * mensagem DELE reabre.
 *
 * `assignTo`: quem reabriu fica RESPONSÁVEL (regra do operador: a conversa
 * reaberta é atribuída a quem a abriu e segue com essa pessoa até ser
 * encerrada de novo — e encerrar solta o responsável, ver `situacao.ts`). Só o
 * envio por gente logada tem quem nomear; o cliente, o celular pareado (sem
 * usuário do CRM por trás) e a API por chave reabrem SEM responsável.
 *
 * ⚠️ "Sem responsável" é ESCRITO (`assigned_agent_id = NULL`), não deixado
 * como estava. Conversa encerrada ANTES desta regra ainda carrega o
 * responsável antigo — os caminhos de encerrar só zeravam `status` —, e um
 * reabrir que não tocasse a coluna devolveria a conversa à caixa em nome de
 * quem já a tinha dado por resolvida, fora da fila de "sem responsável"
 * (achado do Codex no PR #106). SEM acervo nas encerradas antigas, de
 * propósito: o responsável que ficou lá diz quem atendeu por último, e
 * nenhum caminho devolve conversa aberta com esse dono velho — reabrir por
 * gente nomeia gente, reabrir sem gente escreve NULL aqui.
 *
 * ⚠️⚠️ **Quem decide se a conversa está encerrada é o BANCO, nunca o objeto
 * do chamador** (21/09/2026). Até aqui havia um atalho —
 * `if (conversation.status !== 'closed') return false` — sobre a linha que o
 * chamador leu no COMEÇO da requisição, segundos antes (a ingestão baixa
 * anexo, o núcleo de envio espera o provedor). Um encerramento que caísse
 * entre aquela leitura e a gravação da mensagem — o botão Encerrar, a
 * automação, o encerramento em lote da 1018 — fazia a mensagem nova chegar
 * numa conversa ENCERRADA e o atalho pular a reabertura: a mensagem do
 * cliente ficava escondida da caixa, que é exatamente o que esta função
 * existe para impedir (achado do Codex no PR #232). Agora o UPDATE roda
 * SEMPRE, e o `status = 'closed'` no WHERE é quem responde. Como todo
 * chamador grava a mensagem ANTES, vale nas duas ordens: encerrou antes do
 * UPDATE, ele vê `closed` e reabre; encerrou depois, foi uma decisão tomada
 * com a mensagem já gravada. ⚠️ Uma exceção, de milissegundos e fora daqui:
 * o encerramento em LOTE (1018–1021) confere a folga de 2 minutos sobre a
 * foto do começo do comando, e trava a linha só depois — o UPDATE daqui vê a
 * versão ainda aberta, não espera, e o lote encerra por cima. O conserto
 * mora no lote (repetir a conferência no UPDATE dele).
 * Por isso o parâmetro é só o `id`: um `status` aqui convidaria a
 * reintroduzir o atalho.
 *
 * O preço, MEDIDO em 21/09/2026: uma ida ao banco por mensagem gravada, onde
 * antes só havia quando a conversa já estava encerrada — ~12 ms da VPS ao
 * Supabase numa conexão reaproveitada (9–27 ms em 15 amostras), e 0,16 ms no
 * banco (busca pela chave primária, a linha aberta não casa o filtro: nada é
 * travado, gravado nem disparado — sem gatilho, sem evento de realtime). A
 * alternativa, dobrar a reabertura dentro da RPC `bump_conversation_on_inbound`,
 * só cobriria Meta e Instagram; os outros quatro caminhos precisariam de uma
 * RPC irmã, e no compositor ela esbarraria na RLS do operador e na
 * auto-notificação do gatilho de atribuição.
 *
 * ⚠️ **Reabrir por mensagem do CLIENTE devolve a marca de espera**
 * (`clienteEsperaDesde`, a hora da mensagem). A mensagem acende
 * `aguardando_desde` pelo gatilho da 972 no INSERT, e encerrar a APAGA
 * (`cb_encerrar_limpa_espera`). Se o encerramento cai entre gravar e reabrir
 * — a janela que este conserto passou a cobrir —, a conversa voltava aberta
 * sem o selo "em atraso", invisível ao chip e ao Meu dia até o cliente
 * escrever de novo (revisão adversarial da correção, 21/09/2026). Vai no
 * MESMO UPDATE cercado: só vale quando a conversa estava de fato encerrada,
 * e é o valor que o gatilho teria gravado (`created_at` da mensagem).
 * Celular pareado e envio do CRM não passam — resposta de gente não espera.
 *
 * ⚠️ "Quem reabre fica responsável" continua valendo SÓ para quem reabre: o
 * `assigned_agent_id` está no mesmo UPDATE, cercado pelo mesmo
 * `status = 'closed'` — um envio numa conversa aberta não rouba a
 * atribuição de quem está com ela (há teste cobrando o filtro).
 *
 * Devolve `true` quando a conversa foi de fato reaberta (a contagem de
 * linhas do UPDATE), `false` quando já estava aberta/pendente ou a escrita
 * falhou. Nenhum chamador usa o retorno hoje.
 *
 * Mora num módulo próprio para ser testável sem a rota inteira e para todo
 * caminho novo de mensagem ganhar o comportamento chamando uma função só.
 */
export async function reopenClosedConversation(
  db: SupabaseClient,
  conversation: { id: string },
  opts: { assignTo?: string | null; clienteEsperaDesde?: string } = {},
): Promise<boolean> {
  const patch: Record<string, unknown> = {
    status: 'open',
    assigned_agent_id: opts.assignTo ?? null,
    updated_at: new Date().toISOString(),
    ...(opts.clienteEsperaDesde ? { aguardando_desde: opts.clienteEsperaDesde } : {}),
  }

  const { error, count } = await db
    .from('conversations')
    .update(patch, { count: 'exact' })
    .eq('id', conversation.id)
    // A ÚNICA pergunta "está encerrada?" — atômica, na linha de agora. Sob
    // READ COMMITTED, se outra transação estiver mexendo na linha, o UPDATE
    // espera e reavalia o filtro na versão nova.
    .eq('status', 'closed')

  if (error) {
    // Best-effort, como a atualização da conversa que precede isto: uma
    // reabertura que falha não pode abortar a ingestão (e fazer a Meta
    // reentregar).
    console.error('Error re-opening conversation:', error)
    return false
  }

  return (count ?? 0) > 0
}
