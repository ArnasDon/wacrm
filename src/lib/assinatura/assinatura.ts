// ============================================================
// Assinatura do remetente no texto da mensagem (F1 / migration 923).
//
// Funções PURAS. Toda a decisão de "que texto o cliente vai ler" mora aqui,
// e é testada aqui — os cinco caminhos de envio só chamam.
//
// ⚠️ O prefixo é GRAVADO no `content_text` (decisão P1.2 do operador): um CRM
// jurídico precisa mostrar exatamente o que o cliente recebeu, e aplicar só
// no fio criaria duas verdades sobre a mesma mensagem. O preço, registrado no
// plano, é que seis consumidores do mesmo campo herdam o prefixo — daí
// `removerAssinatura`, usada onde ele atrapalha (edição e contexto da IA).
// ============================================================

/** O que separa a assinatura do corpo. Quebra de linha simples, como no print. */
const SEPARADOR = '\n';

/**
 * Caracteres que o WhatsApp usa para formatar. Um nome que contenha qualquer
 * um deles quebra o negrito ao redor da assinatura — `*Ana*Paula:*` fecha no
 * lugar errado e o cliente vê asterisco cru no meio do nome.
 */
const MARCADORES = /[*_~`]/g;

/**
 * Prepara um nome para entrar na assinatura.
 *
 * Devolve `null` quando não sobra nada utilizável, e esse `null` é o sinal de
 * "não assine" — melhor mensagem sem assinatura do que `*:*` na cara do
 * cliente. Acontece de verdade: o trigger de signup grava
 * `COALESCE(full_name, '')`, então a coluna é NOT NULL mas pode estar vazia.
 */
export function saneiaNome(bruto: string | null | undefined): string | null {
  if (!bruto) return null;
  const limpo = bruto.replace(MARCADORES, '').replace(/\s+/g, ' ').trim();
  return limpo || null;
}

/**
 * O nome que aparece para o cliente quando quem envia é GENTE: o nome
 * COMPLETO.
 *
 * ⚠️ Decisão do operador em 2026-08-01, revertendo a P1.6 original (que pedia
 * só o primeiro nome). O contexto é um escritório de advocacia: quem recebe
 * precisa saber com qual advogado falou, e "Leonardo" não identifica ninguém
 * num escritório com mais de um Leonardo — enquanto "Leonardo Cabral
 * Baptista" é o nome que o cliente vê na procuração e no processo.
 *
 * Cai para o e-mail quando não há nome; nesse caso usa o trecho antes do `@`,
 * porque o domínio não diz nada a quem lê.
 */
/**
 * "Assinar como" de uma automação (998, D18), como veio do formulário ou da
 * API: texto aparado com teto de 60 caracteres; vazio ou não-texto = NULL
 * (o nome automático do escritório). O `saneiaNome` (tira `*_~`) roda na
 * HORA de assinar, não aqui — o que se grava é o que a pessoa digitou.
 */
export const ASSINATURA_PERSONALIZADA_MAX = 60;

export function normalizarAssinatura(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const aparado = v.trim().slice(0, ASSINATURA_PERSONALIZADA_MAX);
  return aparado === '' ? null : aparado;
}

export function nomeDePessoa(
  fullName: string | null | undefined,
  email: string | null | undefined,
): string | null {
  const nome = saneiaNome(fullName);
  if (nome) return nome;

  const doEmail = saneiaNome(email?.split('@')[0]);
  return doEmail ?? null;
}

/**
 * Monta o prefixo. Vazio (string vazia) quando não há nome — o chamador
 * concatena sem precisar de `if`.
 */
export function prefixoDeAssinatura(nome: string | null | undefined): string {
  const limpo = saneiaNome(nome);
  return limpo ? `*${limpo}:*${SEPARADOR}` : '';
}

/**
 * Põe a assinatura no texto.
 *
 * ⚠️ NÃO assina texto vazio: legenda vazia com assinatura viraria uma
 * mensagem cujo conteúdo é só o nome de quem mandou. Áudio, por exemplo, não
 * tem legenda — sai sem assinatura por construção.
 *
 * ⚠️ Idempotente por precaução: se o texto JÁ começa com esta exata
 * assinatura, devolve como está. Protege contra o caminho de edição
 * reaplicando o prefixo sobre um texto que já o tinha.
 */
export function aplicarAssinatura(
  texto: string | null | undefined,
  nome: string | null | undefined,
): string | null | undefined {
  if (texto === null || texto === undefined) return texto;
  if (!texto.trim()) return texto;

  const prefixo = prefixoDeAssinatura(nome);
  if (!prefixo) return texto;
  if (texto.startsWith(prefixo)) return texto;

  return prefixo + texto;
}

/**
 * Tira a assinatura de um texto que a tenha.
 *
 * Usada em dois lugares onde o prefixo atrapalha:
 *
 *  1. **O diálogo de edição.** Ele é pré-preenchido com o `content_text`
 *     inteiro; sem isto o operador vê `*Leonardo:*` cru, pode apagar sem
 *     querer, e o PATCH grava o que voltou.
 *  2. **O contexto da IA.** O histórico do modelo é montado a partir do
 *     `content_text`; vendo `*Nome:*` nas mensagens anteriores, o modelo tende
 *     a imitar — e o texto gerado seria prefixado DE NOVO no envio.
 *
 * Reconhece qualquer `*algo:*` seguido de quebra de linha no começo, e não só
 * a assinatura de quem está lendo: mensagem antiga assinada por um colega que
 * já saiu da equipe também precisa ser limpa.
 */
const ASSINATURA_NO_COMECO = /^\*[^*\n]{1,80}:\*\n/;

export function removerAssinatura(
  texto: string | null | undefined,
): string | null | undefined {
  if (texto === null || texto === undefined) return texto;
  return texto.replace(ASSINATURA_NO_COMECO, '');
}

/**
 * A assinatura que JÁ está num texto, literal (com o `\n`), ou `''`.
 *
 * ⚠️ É o que a edição usa para recolocar o prefixo, em vez de recalcular quem
 * assina. Recalcular estaria errado de três jeitos ao mesmo tempo: a pessoa
 * pode ter saído da equipe, o interruptor pode ter sido desligado desde o
 * envio, e quem edita pode não ser quem escreveu. A mensagem que o cliente
 * recebeu foi assinada por alguém — editar o corpo não reescreve a história
 * de quem falou.
 */
export function assinaturaExistente(texto: string | null | undefined): string {
  if (!texto) return '';
  return texto.match(ASSINATURA_NO_COMECO)?.[0] ?? '';
}

/**
 * Quanto a assinatura vai custar em caracteres.
 *
 * ⚠️ Existe por causa de um erro de ordem que o plano não tinha visto: o teto
 * de 1024 da legenda (e do corpo interativo) é validado ANTES de o prefixo
 * existir, em três lugares. Sem descontar isto, uma legenda de 1020
 * caracteres passa na validação e a **Meta** recusa a versão prefixada — o
 * operador leva 502 de erro de servidor onde devia ler "sua legenda é longa
 * demais".
 */
export function custoDaAssinatura(nome: string | null | undefined): number {
  return prefixoDeAssinatura(nome).length;
}
