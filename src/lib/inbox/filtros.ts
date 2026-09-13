// ============================================================
// Os filtros do inbox (F2 fatia A).
//
// Funções PURAS: recebem a lista já carregada e devolvem o recorte. Nada aqui
// consulta o banco.
//
// ⚠️ POR QUE FILTRAR NO CLIENTE, E NÃO NA CONSULTA
// Porque filtrar por campo do contato no PostgREST **dá resultado errado sem
// dar erro**, nos dois sentidos:
//
//   - Com o embed atual (LEFT), `.eq('contact.name', …)` aplica o filtro só ao
//     recurso embutido. As conversas que não casam CONTINUAM VINDO, com
//     `contact: null` — a lista mostra tudo, metade dos nomes vira
//     "Desconhecido", e parece um filtro que não faz nada.
//   - Trocando para `contacts!inner` vira INNER JOIN e APAGA toda conversa de
//     grupo (`contact_id IS NULL`), inclusive com o filtro vazio.
//
// Nenhum dos dois dá erro e os dois passam em revisão de código. A lista já é
// carregada inteira (sem `limit`), então filtrar em JS é também o caminho mais
// simples. Quando a fatia B trouxer a busca no corpo das mensagens, **tudo**
// muda para uma RPC de uma vez — nunca metade aqui e metade lá, que produziria
// um filtro enxergando 64 conversas e outro enxergando a página carregada.
// ============================================================

import { atrasoDeResposta } from "@/lib/inbox/atraso";
import { semAcento } from "@/lib/inbox/busca-em-mensagens";
import { variantesDoNonoDigito } from "@/lib/contacts/telefone";
import {
  matchesContactFilters,
  matchesTypeFilter,
  type ModoDeEtiqueta,
  type TipoDeConversa,
} from "@/lib/inbox/conversations";
import { stripWhatsAppFormat } from "@/lib/inbox/whatsapp-format";
import type { Conversation } from "@/types";

/**
 * "Sem etapa" e "sem responsável" são opções DE VERDADE, não ausência de
 * filtro.
 *
 * ⚠️ Sem elas o recorte mente por omissão: 9 das 64 conversas não têm negócio
 * nenhum e 63 das 64 não têm responsável — esse pessoal sumiria de qualquer
 * recorte, e "quem ainda não foi distribuído" é exatamente a pergunta que o
 * operador faz de manhã.
 */
export const SEM_ETAPA = "__sem_etapa__";
export const SEM_RESPONSAVEL = "__sem_responsavel__";

/**
 * As duas abas da caixa de entrada (decisão do operador, 2026-09-02).
 *
 * `ativas` É a caixa de entrada: tudo que não foi encerrado — `open` E
 * `pending`, porque a pendente ainda é atendimento em curso. `closed` é o
 * acervo do que já terminou. Não existe mais "todas as situações": encerrar
 * uma conversa é justamente tirá-la da caixa, e qualquer mensagem nova (do
 * cliente OU da equipe) a devolve sozinha — ver
 * `src/lib/conversations/reopen.ts`. Com as duas regras valendo, conversa
 * encerrada é conversa em que não há nada a fazer, e é isso que permite
 * zerar a caixa.
 *
 * ⚠️ `ativas` NÃO é filtro: é a ausência dele (`FILTROS_VAZIOS`) — não conta
 * no distintivo nem vira pastilha. `closed` conta como um recorte, igual a
 * Favoritas e Não lidas, que moram na mesma linha da barra.
 *
 * ⚠️ Arquivada É encerrada (decisão P2.3): é o mesmo campo, e um segundo
 * controle "arquivadas" poderia contradizer este, então não existe.
 */
export type SituacaoDaCaixa = "ativas" | "closed";

export interface FiltrosDoInbox {
  /** Todas / só diretas / só grupos. */
  tipo: TipoDeConversa;
  /** Qual das duas abas está aberta — ver {@link SituacaoDaCaixa}. */
  status: SituacaoDaCaixa;
  /**
   * Conexões marcadas — VAZIO = todas (a convenção do projeto: escopo vazio
   * é tudo). Várias somam com OU: "Bancário - Comercial ou Jurídico". Era
   * `canalId: string | null` (uma só) até 03/09; o JSON salvo antigo é
   * traduzido em `lerFiltroSalvo`.
   */
  canalIds: string[];
  /** `auth.users.id`, ou {@link SEM_RESPONSAVEL}, ou `null` para todos. */
  responsavelId: string | null;
  etiquetaIds: string[];
  modoDeEtiqueta: ModoDeEtiqueta;
  /** Nome exato da empresa, ou `null`. */
  empresa: string | null;
  /**
   * Id do funil, ou `null` para todos. É o PRIMEIRO nível do recorte de
   * etapa: escolhido sozinho, ele acha quem tem negócio em QUALQUER etapa
   * daquele funil.
   *
   * ⚠️ Quem escreve esta coluna é SÓ o seletor de funil — escolher uma etapa
   * nunca a preenche. Sem essa regra, o caso de um funil só ficava com
   * `funilId` preenchido por tabela, e "Qualquer etapa" (que hoje significa
   * "não filtro por etapa") passaria a significar "quem tem negócio neste
   * funil" — sumindo em silêncio com quem ainda não virou negócio.
   */
  funilId: string | null;
  /**
   * Id da etapa, ou {@link SEM_ETAPA}, ou `null` para todas.
   *
   * ⚠️ Manda no {@link FiltrosDoInbox.funilId} quando os dois estão
   * preenchidos: a etapa já vive dentro de um funil, e somar os dois
   * recortes só repetiria a mesma pergunta.
   */
  etapaId: string | null;
  /** Só as que EU marquei. */
  favoritas: boolean;
  /**
   * Só as que têm mensagem não lida.
   *
   * ⚠️ **É da CONTA INTEIRA, não "as que eu não li".** `unread_count` é uma
   * coluna da conversa, zerada por quem abrir primeiro — quem quer "as minhas
   * não lidas" combina este botão com o filtro de responsável, que é
   * exatamente o que o operador descreveu. Tornar por pessoa seria mudança de
   * schema, não de tela.
   *
   * ⚠️ E é INDEPENDENTE da situação. Antes "não lidas" era uma opção DENTRO do
   * menu de situação e escolhê-la SUBSTITUÍA o status — mostrava não lida
   * encerrada junto. Agora soma como todo o resto.
   */
  naoLidas: boolean;
  /**
   * Só as que estão com o alerta de atraso aceso (pedido do operador,
   * 2026-09-09: "filtrar todos os clientes que estejam marcados como
   * atraso").
   *
   * ⚠️ **É a MESMA régua do selo da linha** (`atrasoDeResposta`, 10 min sobre
   * `conversations.aguardando_desde`), e tem de continuar sendo: um recorte
   * com régua própria acenderia o botão sobre linhas sem selo, e o operador
   * leria isso como selo faltando, não como dois números diferentes.
   *
   * ⚠️ **É INDEPENDENTE de lida/não lida** — foi o que o operador pediu por
   * escrito. Quem espera resposta há 10 minutos costuma estar com a conversa
   * já ABERTA por alguém (abrir zera `unread_count` e não responde nada), que
   * é justamente o caso que "Não lidas" esconde.
   *
   * ⚠️ Depende do RELÓGIO, não só da linha: ver `ContextoDosFiltros.agoraMs`.
   */
  emAtraso: boolean;
  /**
   * Só as conversas de cliente INADIMPLENTE no Asaas (Fase 1b do plano da
   * integração): contato ligado a um cliente do Asaas com parcela vencida
   * vista na última listagem completa.
   *
   * ⚠️ **É a MESMA régua do ícone da linha e da faixa do fio**
   * (`dividasPorContato`, em `lib/asaas/aviso-na-conversa.ts`): um recorte
   * com régua própria acenderia o chip sobre linha sem ícone.
   *
   * ⚠️ Depende de uma LEITURA que a lista não faz sozinha — ver
   * `ContextoDosFiltros.inadimplentes`: sem o Asaas conectado (ou sem a
   * resposta ainda) o recorte é NEUTRALIZADO, nunca aplicado sobre nada.
   */
  inadimplentes: boolean;
}

export const FILTROS_VAZIOS: FiltrosDoInbox = {
  tipo: "todas",
  status: "ativas",
  canalIds: [],
  responsavelId: null,
  etiquetaIds: [],
  modoDeEtiqueta: "qualquer",
  empresa: null,
  funilId: null,
  etapaId: null,
  favoritas: false,
  naoLidas: false,
  emAtraso: false,
  inadimplentes: false,
};

/**
 * Quantos filtros estão pegando. É o número no distintivo do botão — sem ele,
 * um painel fechado com filtro ativo esconde a razão de a lista estar curta.
 * É também a régua dos filtros salvos ("este filtro ainda recorta algo?") e
 * da semente do padrão (só cai sobre recorte intacto).
 *
 * ⚠️ A SITUAÇÃO (aba Abertas/Encerradas) NÃO conta. Decisão do operador
 * (2026-09-03, em duas rodadas): a aba é uma VISÃO, escolhida num controle
 * próprio e sempre à vista — contá-la acendia o distintivo "1" no botão do
 * painel sobre a aba acesa, o mesmo fato dito duas vezes. E a visão salva
 * também NÃO carrega a aba (`lerFiltroSalvo` a ignora, `escreverFiltroSalvo`
 * não a grava): aplicar um chip na aba Encerradas jogava o operador de volta
 * para Abertas. Por isso não existe mais uma segunda contagem "do painel":
 * a que contava a aba servia só aos filtros salvos, e eles deixaram de
 * conhecê-la. "Limpar tudo" e os chips mantêm a aba pelo mesmo motivo.
 *
 * ⚠️ `modoDeEtiqueta` NÃO conta: ele não recorta nada sozinho, só muda como as
 * etiquetas já escolhidas se combinam.
 */
export function contarFiltrosAtivos(f: FiltrosDoInbox): number {
  let n = 0;
  if (f.tipo !== "todas") n++;
  if (f.canalIds.length > 0) n++;
  if (f.responsavelId) n++;
  if (f.etiquetaIds.length > 0) n++;
  if (f.empresa !== null) n++;
  // ⚠️ Os dois níveis contam como UM. Com etapa escolhida o funil vem junto
  // (é o pai dela), e somar dois faria o distintivo dizer "2 filtros" sobre
  // uma escolha só — o número existe para explicar uma lista curta, não para
  // contar controles na tela.
  if (f.etapaId || f.funilId) n++;
  if (f.favoritas) n++;
  if (f.naoLidas) n++;
  if (f.emAtraso) n++;
  if (f.inadimplentes) n++;
  return n;
}

/**
 * `contact_id` → as etapas dos negócios daquele contato.
 *
 * ⚠️ É um CONJUNTO, não um valor. O índice único da 911 só cobre
 * `source='channel'`: negócio criado à mão ou por automação pode duplicar o
 * contato, e aí ele está em duas etapas ao mesmo tempo. Tratar como valor
 * único faria o segundo negócio desaparecer do filtro em silêncio.
 */
export function mapaDeEtapasPorContato(
  deals: { contact_id: string | null; stage_id: string | null }[],
): Map<string, Set<string>> {
  const mapa = new Map<string, Set<string>>();
  for (const d of deals) {
    if (!d.contact_id || !d.stage_id) continue;
    const atual = mapa.get(d.contact_id);
    if (atual) atual.add(d.stage_id);
    else mapa.set(d.contact_id, new Set([d.stage_id]));
  }
  return mapa;
}

/**
 * Os funis que podem virar o PRIMEIRO nível do recorte: os que têm etapa
 * carregada **e** nome conhecido, em ordem de nome (a mesma `.order("name")`
 * do resto do app).
 *
 * ⚠️ O nome é exigência, não enfeite. Os nomes vêm da consulta de `pipelines`,
 * que é OUTRA — o gate de `etapasStatus` não a olha. Se ela falhar sozinha, um
 * seletor de funil mostraria linhas em branco e o operador escolheria às
 * cegas; sem os nomes o campo cai na lista chapada, que é honesta.
 *
 * ⚠️ **Mora aqui porque DOIS arquivos precisam da mesma resposta**: o painel,
 * para desenhar um nível ou dois, e a lista, para decidir se o deep link
 * `?etapa=` pode carimbar `funilId`. Quando os dois divergiram, um link do
 * quadro numa conta de um funil só deixava `funilId` preenchido sem seletor
 * que o mostrasse — e "Qualquer etapa" passava a esconder quem não tem
 * negócio (achado do Codex no PR #73).
 */
export function funisDoRecorte(
  etapas: { pipeline_id: string }[],
  nomes: Map<string, string>,
): { id: string; nome: string }[] {
  const vistos = new Map<string, string>();
  for (const e of etapas) {
    if (vistos.has(e.pipeline_id)) continue;
    const nome = nomes.get(e.pipeline_id);
    if (nome) vistos.set(e.pipeline_id, nome);
  }
  return [...vistos.entries()]
    .map(([id, nome]) => ({ id, nome }))
    .sort((a, b) => a.nome.localeCompare(b.nome));
}

/**
 * O recorte tem os dois níveis (funil → etapa)? Com um funil só não há o que
 * subdividir, e o campo continua sendo a lista de etapas de sempre — com
 * `funilId` SEMPRE nulo, para "Qualquer etapa" seguir significando "não
 * filtro por etapa".
 */
export function recorteTemDoisNiveis(
  etapas: { pipeline_id: string }[],
  nomes: Map<string, string>,
): boolean {
  return funisDoRecorte(etapas, nomes).length >= 2;
}

export interface ContextoDosFiltros {
  /**
   * Recorte por perfil de acesso (Fase 3). `true` = a conversa está FORA das
   * conexões do perfil de quem olha.
   *
   * É um PREDICADO injetado, não um import de `@/lib/perfis/escopo` — aquele
   * módulo importa `canalDaConversa` DAQUI, e importar na direção contrária
   * fecharia um ciclo de módulos (TDZ aleatória em runtime, dependendo de
   * quem carrega primeiro). Quem monta o contexto (conversation-list) liga o
   * predicado em `conversaNoEscopo(acesso, ·)`.
   *
   * Ausente = sem recorte (mesma semântica de perfil nulo).
   */
  foraDoPerfil?: (c: Conversation) => boolean;
  /** Ids das conversas que ESTE membro marcou (migration 924). */
  favoritas: Set<string>;
  /** Saída de {@link mapaDeEtapasPorContato}. */
  etapaPorContato: Map<string, Set<string>>;
  /**
   * `stage_id` → `pipeline_id`, para o recorte por funil resolver "esta etapa
   * é de qual funil?".
   *
   * ⚠️ Obrigatório pela MESMA razão de `achadasNoTexto`: esquecê-lo não daria
   * erro nenhum — o recorte por funil simplesmente não acharia ninguém, em
   * silêncio, e a tela diria "nenhuma conversa" sobre um funil cheio. Campo
   * exigido faz o compilador cobrar de quem consumir `aplicarFiltros` em
   * outra tela.
   */
  funilPorEtapa: Map<string, string>;
  /** O texto da caixa de busca, cru. */
  busca: string;
  /**
   * Conversas que a RPC 929 achou pelo CORPO das mensagens.
   *
   * ⚠️ Obrigatório de propósito, mesmo sendo quase sempre vazio. Esquecê-lo não
   * daria erro nenhum: a busca simplesmente voltaria a olhar só a última
   * mensagem, silenciosamente, e a feature inteira sumiria sem deixar rastro.
   * Campo exigido faz o compilador cobrar.
   */
  achadasNoTexto: Set<string>;
  /**
   * O mapa contato→etapa acima está completo e utilizável?
   *
   * ⚠️ Obrigatório pela MESMA razão de `achadasNoTexto`: com o mapa ainda
   * vazio (a busca de `deals` é outra consulta, que chega depois — ou falha),
   * `casaComAEtapa` reprova TODA conversa, e um filtro de etapa ativo — o
   * deep link `?etapa=` do quadro de funis chega antes dos dados — abriria
   * "nenhuma conversa encontrada" com cara de resposta certa. Com `false`,
   * o recorte de etapa é NEUTRALIZADO aqui dentro: a lista nunca responde
   * errado, no máximo ainda não recorta (a tela mostra spinner/aviso).
   */
  recorteDeEtapaConfiavel: boolean;
  /**
   * O relógio do recorte de atraso, em milissegundos.
   *
   * ⚠️ Obrigatório pela MESMA razão de `achadasNoTexto` e
   * `recorteDeEtapaConfiavel`: o atraso é a única pergunta desta máquina que
   * o dado sozinho não responde — a linha não muda no banco quando os 10
   * minutos vencem, quem muda é o tempo. Esquecê-lo não daria erro: o
   * recorte responderia "nenhuma conversa" sobre uma caixa cheia de gente
   * esperando, com cara de resposta certa. Campo exigido faz o compilador
   * cobrar de quem consumir `aplicarFiltros` em outra tela — e lembrar que
   * aquela tela precisa de um tique de um minuto, senão o recorte congela.
   */
  agoraMs: number;
  /**
   * Os `contact_id` de quem está INADIMPLENTE no Asaas (a régua de
   * `idsInadimplentes`, em `lib/asaas/aviso-na-conversa.ts`), ou `null`.
   *
   * ⚠️ `null` NEUTRALIZA o recorte (é `recorteDeEtapaConfiavel` de novo):
   * Asaas desconectado, leitura ainda no ar ou falhada — nesses casos o
   * filtro "Inadimplentes" ligado não recorta nada, em vez de responder
   * "nenhuma conversa" sobre um dado que não existe. Leitura ANTIGA não
   * neutraliza (é a régua do ícone da linha); o painel diz de quando é.
   * Obrigatório pela mesma razão de `achadasNoTexto`: esquecê-lo não daria
   * erro nenhum, e o compilador é quem cobra de quem consumir
   * `aplicarFiltros` em outra tela.
   */
  inadimplentes: Set<string> | null;
}

/**
 * A busca livre que roda AQUI, sobre o que a lista já tem na mão: nome,
 * telefone, nome do grupo e texto da última mensagem.
 *
 * ⚠️ Os quatro campos são load-bearing e nenhum é decorativo. Sem o do grupo,
 * buscar não acha grupo NENHUM (grupo não tem contato, então nome e telefone
 * ficam vazios); sem o da última mensagem, a lista pisca — a conversa cujo
 * último texto casa apareceria só depois da volta do banco, e sumiria de novo
 * a cada letra digitada.
 *
 * ⚠️ Isto NÃO é a busca inteira. O corpo das mensagens é respondido pelo banco
 * (RPC 929) e entra em `aplicarFiltros` como um OU — ver lá.
 *
 * ⚠️ `semAcento` nas DUAS pontas: a busca do banco ignora acento, e sem isto a
 * mesma palavra digitada acharia a mensagem e não acharia o contato homônimo.
 *
 * ⚠️ O telefone é comparado DUAS vezes: como texto (o que sempre foi) e em
 * DÍGITOS, quando o termo é um telefone escrito por gente. `contacts.phone`
 * guarda só dígitos com DDI ("5519982764080"); colar "(19) 98276-4080" — a
 * forma que o cliente manda e que o próprio CRM exibe — não achava NADA, e
 * a leitura do operador é que o cliente não está no CRM (reportado da tela
 * em 08/09/2026, sobre um contato que existia). Ver `digitosDeBuscaDeTelefone`.
 *
 * ⚠️ E a comparação em dígitos olha as DUAS grafias do número gravado — com
 * e sem o nono dígito (`variantesDoNonoDigito`). O cliente gravado como
 * "558388745316" (sem o 9, como o WhatsApp entrega número antigo) não era
 * achado por "(83) 98874-5316", que é como o operador o lê no celular — e
 * a busca virava exatidão onde deveria ser "contém" (reportado em
 * 09/09/2026). Só o lado do CONTATO ganha variante: o termo é o que a
 * pessoa digitou, e alterá-lo inventaria uma busca que ela não fez.
 */
export function casaComABusca(conversation: Conversation, busca: string): boolean {
  const q = semAcento(busca.trim());
  if (!q) return true;

  const nome = semAcento(conversation.contact?.name ?? "");
  const telefone = semAcento(conversation.contact?.phone ?? "");
  const digitosBuscados = digitosDeBuscaDeTelefone(busca);
  const grafiasDoTelefone = variantesDoNonoDigito(telefone.replace(/\D/g, ""));
  const grupo = conversation.group_id
    ? semAcento(
        `${conversation.group?.alias ?? ""} ${conversation.group?.subject ?? ""}`,
      )
    : "";
  const ultima = semAcento(
    stripWhatsAppFormat(conversation.last_message_text),
  );

  return (
    nome.includes(q) ||
    telefone.includes(q) ||
    (digitosBuscados !== null &&
      grafiasDoTelefone.some((grafia) => grafia.includes(digitosBuscados))) ||
    grupo.includes(q) ||
    ultima.includes(q)
  );
}

/**
 * Os dígitos de um termo de busca que é um TELEFONE escrito por gente, ou
 * `null` quando o termo é outra coisa.
 *
 * ⚠️ O termo precisa ser só dígitos e a pontuação com que se escreve
 * telefone. Sem essa cerca, buscar "2026" passaria a casar todo telefone que
 * contém 2026 — o campo é o mesmo para nome, telefone e texto de mensagem, e
 * alargar a comparação de um deles suja os outros três.
 *
 * Termo só de dígitos já casava pelo `includes` de texto; ele continua aqui
 * porque a régua é a mesma e não muda resposta nenhuma. O piso de 3 dígitos
 * é o da busca do banco (929): abaixo disso o termo não recorta nada útil.
 */
export function digitosDeBuscaDeTelefone(termo: string): string | null {
  const t = termo.trim();
  if (!t || !/^[\s()+\-.\d]+$/.test(t)) return null;
  const digitos = t.replace(/\D/g, "");
  return digitos.length >= 3 ? digitos : null;
}

/** Um filtro só, isolado para ser testável e para o `aplicarFiltros` ler bem. */
export function casaComOResponsavel(
  conversation: Conversation,
  responsavelId: string | null,
): boolean {
  if (!responsavelId) return true;
  const atual = conversation.assigned_agent_id ?? null;
  if (responsavelId === SEM_RESPONSAVEL) return atual === null;
  return atual === responsavelId;
}

/**
 * Por qual número esta conversa corre.
 *
 * ⚠️ **Conversa de GRUPO tem `conversations.channel_id` NULO — sempre, e não
 * por ser antiga.** `src/lib/cb-groups/persist.ts` cria a conversa do grupo
 * com `{ account_id, user_id, group_id }` e nenhum dos dois `update` seguintes
 * preenche a coluna; quem guarda o número é `cb_groups.channel_id` ("por qual
 * número vimos este grupo"). Sem esta função, escolher um número no filtro
 * APAGARIA TODOS OS GRUPOS daquele número, em silêncio — que é exatamente a
 * armadilha "grupo some sem erro" que o CLAUDE.md descreve, só que por um
 * caminho diferente do `!inner`.
 *
 * ⚠️ Não confundir com o outro NULO legítimo: conversa 1:1 anterior à 903 não
 * tem carimbo nenhum, e essa continua aparecendo só em "Todos" — incluí-la em
 * todo número faria o filtro afirmar algo que ninguém sabe.
 */
export function canalDaConversa(conversation: Conversation): string | null {
  if (conversation.group_id) return conversation.group?.channel_id ?? null;
  return conversation.channel_id ?? null;
}

/**
 * O recorte de funil/etapa, nos dois níveis.
 *
 * ⚠️ A etapa VENCE o funil quando ambos vêm preenchidos — ver
 * {@link FiltrosDoInbox.etapaId}.
 */
export function casaComAEtapa(
  conversation: Conversation,
  recorte: Pick<FiltrosDoInbox, "funilId" | "etapaId">,
  etapaPorContato: Map<string, Set<string>>,
  funilPorEtapa: Map<string, string>,
): boolean {
  const { funilId, etapaId } = recorte;
  if (!etapaId && !funilId) return true;

  // Grupo não tem contato e portanto não tem negócio. Ele cai em "sem etapa"
  // de propósito: é literalmente verdade, e o filtro de tipo é quem esconde
  // grupo de quem não quer ver grupo.
  const doContato = conversation.contact_id
    ? etapaPorContato.get(conversation.contact_id)
    : undefined;

  if (etapaId === SEM_ETAPA) return !doContato || doContato.size === 0;
  if (etapaId) return !!doContato?.has(etapaId);

  // Só o funil: basta UM negócio em qualquer etapa dele. É um conjunto de
  // etapas por contato (índice único da 911 só cobre `source='channel'`), e o
  // contato pode ter negócio em dois funis ao mesmo tempo.
  if (!doContato) return false;
  for (const etapa of doContato) {
    if (funilPorEtapa.get(etapa) === funilId) return true;
  }
  return false;
}

/**
 * ⚠️ CONSEQUÊNCIA A VIGIAR QUANDO `groups_enabled` FOR LIGADO.
 *
 * Grupo não tem responsável nem contato, então ele casa com "Sem responsável"
 * E com "Sem negócio" ao mesmo tempo. As duas opções existem para responder
 * "quem ninguém pegou ainda" — e no dia em que os 58 grupos já sincronizados
 * entrarem na lista, as duas passam a devolver os 58 junto com as pessoas.
 *
 * Não há conserto certo aqui: as duas respostas são literalmente verdadeiras.
 * A saída é o filtro de TIPO, que existe exatamente para isso — quem quer
 * gente escolhe "diretas". Fica escrito para quem for ligar o interruptor não
 * achar que é bug.
 */

/**
 * A aba Abertas/Encerradas.
 *
 * ⚠️ **A BUSCA ATRAVESSA a aba padrão, e SÓ ela.** Antes desta feature o
 * padrão era "todas as situações", e digitar o nome de um cliente achava a
 * conversa dele mesmo encerrada. Esconder as encerradas por padrão SEM esta
 * exceção faria "João" na caixa devolver "nenhuma conversa" sobre um cliente
 * que existe — e a conclusão do operador seria que o João não está no CRM,
 * não que a conversa está na outra aba. É a mesma família da exceção do
 * perfil (decisão do operador, 2026-08-30): a busca responde "onde está
 * aquela conversa", e a resposta pode ser "encerrada".
 *
 * Na aba Encerradas a busca NÃO atravessa: ali a aba é um recorte escolhido
 * (conta no distintivo, tem pastilha), e recorte é E lógico com a busca como
 * qualquer outro — trazer as abertas para dentro dela faria a pastilha
 * "Encerradas" mentir sobre o que está na tela.
 */
export function casaComASituacao(
  c: Pick<Conversation, "status">,
  aba: SituacaoDaCaixa,
  busca: string,
): boolean {
  if (aba === "closed") return c.status === "closed";
  return c.status !== "closed" || busca.trim() !== "";
}

/**
 * O recorte inteiro.
 *
 * ⚠️ **Todos os filtros se aplicam JUNTOS (E lógico)** — decisão do operador em
 * 2026-08-01. Nenhum substitui outro nem "ganha" do resto: responsável = Ana
 * mais favoritas mostra *as favoritas da Ana*. É o que faz o contador
 * "Exibindo N" importar — ele é a única coisa que explica um resultado vazio.
 * (A aba padrão não é filtro, e a busca a atravessa — ver
 * {@link casaComASituacao}.)
 */
export function aplicarFiltros(
  conversations: Conversation[],
  f: FiltrosDoInbox,
  ctx: ContextoDosFiltros,
): Conversation[] {
  return conversations.filter((c) => {
    // ⚠️ Recorte por perfil ANTES de tudo — mas com a exceção da BUSCA,
    // decidida pelo operador (2026-08-30): a busca ACHA conversa de outra
    // área e mostra a linha completa; o que é barrado é ABRIR (guarda no
    // fio). Sem termo digitado, a conversa fora do escopo simplesmente não
    // participa da lista. Com termo, ela segue no pipeline e o OU da busca
    // lá no fim decide se casou — passando ainda pelos outros filtros, como
    // qualquer conversa (buscar "contrato" com "Favoritas" ligado não traz
    // não-favorita de outra área).
    if (ctx.foraDoPerfil?.(c) && ctx.busca.trim() === "") return false;

    if (!matchesTypeFilter(c, f.tipo)) return false;
    if (!casaComASituacao(c, f.status, ctx.busca)) return false;

    // Ver `canalDaConversa`: em grupo o número mora em `cb_groups`, não na
    // conversa.
    if (f.canalIds.length > 0) {
      const canal = canalDaConversa(c);
      if (!canal || !f.canalIds.includes(canal)) return false;
    }

    if (!casaComOResponsavel(c, f.responsavelId)) return false;
    if (f.favoritas && !ctx.favoritas.has(c.id)) return false;
    if (f.naoLidas && c.unread_count <= 0) return false;
    // ⚠️ A MESMA função que acende o selo da linha, e não uma cópia da régua:
    // encerrada e grupo já saem de lá com `null`, então o recorte concorda
    // com o que está desenhado na tela por construção. Na aba Encerradas ele
    // devolve vazio de propósito — lá não há ninguém esperando resposta.
    if (f.emAtraso && !atrasoDeResposta(c, ctx.agoraMs)) return false;
    // Ver `ContextoDosFiltros.inadimplentes`: com `null` o recorte é
    // NEUTRALIZADO. Grupo não tem contato e nunca casa — dívida é de gente.
    if (
      f.inadimplentes &&
      ctx.inadimplentes !== null &&
      (!c.contact_id || !ctx.inadimplentes.has(c.contact_id))
    ) {
      return false;
    }
    // Ver `recorteDeEtapaConfiavel`: sem os dados por trás, o recorte de
    // funil/etapa é neutralizado — nunca aplicado sobre um mapa incompleto.
    // Os DOIS níveis caem juntos: o mapa que falta é o mesmo.
    const recorteDeEtapa = ctx.recorteDeEtapaConfiavel
      ? { funilId: f.funilId, etapaId: f.etapaId }
      : { funilId: null, etapaId: null };
    if (
      !casaComAEtapa(c, recorteDeEtapa, ctx.etapaPorContato, ctx.funilPorEtapa)
    ) {
      return false;
    }

    if (f.etiquetaIds.length > 0 || f.empresa !== null) {
      if (
        !matchesContactFilters(c, {
          tagIds: f.etiquetaIds,
          tagMode: f.modoDeEtiqueta,
          company: f.empresa,
        })
      ) {
        return false;
      }
    }

    // ⚠️ A busca é a ÚLTIMA pergunta, e é um OU entre duas fontes: o que esta
    // máquina já sabe (nome, telefone, grupo, última mensagem) e o que o banco
    // achou dentro do histórico (RPC 929).
    //
    // ⚠️ O OU vale só AQUI DENTRO. Uma conversa achada pelo corpo continua
    // tendo de passar por todos os filtros acima — buscar "contrato" com o
    // filtro "Favoritas" ligado devolve as favoritas que falam em contrato, não
    // todas que falam em contrato. Tirar esta linha de dentro do `.filter()`
    // faria a busca ATROPELAR o painel, que é o oposto do combinado (E lógico
    // entre todos os filtros).
    return casaComABusca(c, ctx.busca) || ctx.achadasNoTexto.has(c.id);
  });
}
