// ============================================================
// "O que precisa ser corrigido" — a régua de quando a aba pode dizer que
// está tudo em ordem.
//
// Puro, sem I/O: recebe o estado de CADA fonte e devolve o que a tela
// escreve. O hook consulta; aqui mora a única decisão difícil do bloco.
//
// ⚠️⚠️ "Tudo em ordem" é uma AFIRMAÇÃO, e só pode ser feita quando TODAS as
// fontes responderam. É a armadilha "lista vazia virando afirmação" do
// CLAUDE.md na sua forma mais cara: este bloco existe para avisar que algo
// quebrou, e um selo verde sobre uma consulta que falhou é exatamente o
// oposto — a pessoa fecha a aba tranquila enquanto a mensagem do cliente
// não saiu. Por isso `incompleto` é um estado PRÓPRIO, distinto de `limpo`.
//
// ⚠️ A contagem de uma fonte pode ser um PISO (consulta truncada). O piso
// contamina o total: somar piso com exato dá piso, e a tela escreve "pelo
// menos N". Nunca "mais de N" — ver a nota do truncamento em
// `resumo-do-dia.tsx`: o que se sabe é o mínimo, não a desigualdade estrita.
// ============================================================

/** As oito fontes do bloco, na ordem em que a tela as mostra. */
export type FonteDeCorrecao =
  | 'agendador'
  | 'conexoes'
  | 'conexoesAtrasadas'
  | 'mensagensRetidas'
  | 'agendadasFalharam'
  | 'entregaIncerta'
  | 'automacoesFalharam'
  | 'entradasNaoProcessadas';

/**
 * A ordem é de GRAVIDADE, não alfabética nem de custo de consulta.
 *
 * O agendador vem primeiro porque, parado, NADA dispara — agendadas, fluxos,
 * Radar e Meta Ads ficam todos de pé no lugar, e as outras fontes passam a
 * contar consequências dele. Conexão fora do ar vem em seguida pelo mesmo
 * motivo: com ela caída, a mensagem não sai nem chega.
 *
 * ⚠️ A conexão ATRASADA (1002) é uma fonte SEPARADA da que está fora do ar,
 * e não uma soma na mesma linha. São problemas diferentes com consertos
 * diferentes — uma precisa reparear, a outra precisa que a sessão seja
 * reiniciada —, e a frase "N conexões fora do ar" seria FALSA sobre uma
 * conexão que está de pé e entregando, só que tarde. Vem logo depois dela
 * porque o efeito é parecido: o atendente responde sem enxergar metade da
 * conversa.
 *
 * ⚠️ A mensagem RETIDA sem telefone (1010) vem junto das conexões porque é da
 * mesma família — fala de cliente que NÃO está na tela do CRM —, e antes das
 * agendadas porque o conserto é de gente e é agora: olhar o celular daquela
 * conexão e responder por lá (o eco traz o número, e a fala entra sozinha na
 * conversa). Ver docs/PLANO-lid-sem-telefone.md.
 */
export const ORDEM_DAS_FONTES: readonly FonteDeCorrecao[] = [
  'agendador',
  'conexoes',
  'conexoesAtrasadas',
  'mensagensRetidas',
  'agendadasFalharam',
  'entregaIncerta',
  'automacoesFalharam',
  'entradasNaoProcessadas',
] as const;

/**
 * Por quantos dias uma mensagem retida sem telefone ocupa o bloco. Passado
 * isso ela CONTINUA retida e religável (a tabela não esquece) — só deixa de
 * ser mostrada: um aviso que ninguém mais pode resolver é o número que o olho
 * aprende a pular, e ele ensinaria a pular os novos. A rota conta com esta
 * janela e a tela a ESCREVE — uma constante só, para o texto não mentir.
 */
export const DIAS_DE_RETIDA_NA_TELA = 7;

/** O que uma fonte devolve depois de responder. */
export interface Contagem {
  quantidade: number;
  /** A consulta bateu no teto: `quantidade` é o mínimo, não o total. */
  aoMenos?: boolean;
}

/** O estado de uma fonte, no molde do `Bloco<T>` do Meu dia. */
export type EstadoDaFonte =
  | { status: 'carregando' }
  | { status: 'falhou' }
  | { status: 'pronto'; contagem: Contagem };

export type EstadoPorFonte = Partial<Record<FonteDeCorrecao, EstadoDaFonte>>;

export interface Achado {
  fonte: FonteDeCorrecao;
  quantidade: number;
  aoMenos: boolean;
}

export type SituacaoDasCorrecoes =
  /** Ainda conferindo: nenhuma fonte pronta com problema, e alguma em voo. */
  | 'conferindo'
  /** Todas as fontes responderam e nenhuma tem nada a corrigir. */
  | 'limpo'
  /** Nada achado, mas alguma fonte não respondeu — não dá para dizer "tudo em ordem". */
  | 'incompleto'
  /** Há o que corrigir (mesmo que outras fontes ainda estejam em voo). */
  | 'temProblema';

export interface ResumoDasCorrecoes {
  situacao: SituacaoDasCorrecoes;
  /** Só as fontes com quantidade > 0, na ordem de gravidade. */
  achados: Achado[];
  /** A soma dos achados — piso quando alguma parcela é piso. */
  total: number;
  aoMenos: boolean;
  /** As fontes que falharam: a tela nomeia o que não conseguiu conferir. */
  naoConferidas: FonteDeCorrecao[];
  /** As fontes ainda em voo. */
  conferindo: FonteDeCorrecao[];
}

/**
 * ⚠️ Fonte AUSENTE do mapa conta como "carregando", nunca como zero: é o
 * estado de quem ainda nem começou (o hook monta o mapa bloco a bloco). Um
 * `?? { status: 'pronto', contagem: { quantidade: 0 } }` aqui faria a aba
 * nascer verde e ir escurecendo — pior que nascer cinza, porque o primeiro
 * quadro é o que a pessoa olha.
 */
export function resumirCorrecoes(estados: EstadoPorFonte): ResumoDasCorrecoes {
  const achados: Achado[] = [];
  const naoConferidas: FonteDeCorrecao[] = [];
  const conferindo: FonteDeCorrecao[] = [];

  for (const fonte of ORDEM_DAS_FONTES) {
    const estado = estados[fonte] ?? { status: 'carregando' as const };
    if (estado.status === 'carregando') {
      conferindo.push(fonte);
      continue;
    }
    if (estado.status === 'falhou') {
      naoConferidas.push(fonte);
      continue;
    }
    if (estado.contagem.quantidade > 0) {
      achados.push({
        fonte,
        quantidade: estado.contagem.quantidade,
        aoMenos: estado.contagem.aoMenos === true,
      });
    }
  }

  const total = achados.reduce((s, a) => s + a.quantidade, 0);
  const aoMenos = achados.some((a) => a.aoMenos);

  // ⚠️ A ordem dos testes importa. "Tem problema" vence "conferindo": o que
  // já se sabe que está quebrado não espera o resto da tela para aparecer —
  // é o mesmo desenho dos blocos que assentam sozinhos. E `limpo` é o
  // ÚLTIMO, alcançável só quando não sobrou nem falha nem espera.
  const situacao: SituacaoDasCorrecoes =
    achados.length > 0
      ? 'temProblema'
      : conferindo.length > 0
        ? 'conferindo'
        : naoConferidas.length > 0
          ? 'incompleto'
          : 'limpo';

  return { situacao, achados, total, aoMenos, naoConferidas, conferindo };
}
