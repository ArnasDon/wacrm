// ============================================================
// A aba "IDs" de Configurações → API: o que a tela mostra, o que a busca
// deixa passar e o que o botão "Copiar tudo (JSON)" copia.
//
// Existe porque a API pede ids que nenhuma tela mostrava: quem monta um
// fluxo no n8n ou no Make precisava do `stage_id` da etapa "Lead", da CHAVE
// do campo "Tamanho da dívida", do `user_id` da advogada que recebe a
// tarefa — e só achava isso abrindo o banco. Os ids não são segredo (a RLS
// já os mostra a qualquer membro da conta); só não tinham onde aparecer.
//
// Puro e testado: o vitest roda em `environment: "node"`, sem
// testing-library, então o componente não renderiza em teste — a regra
// que decide o que aparece tem de morar fora dele.
// ============================================================

import { identidadeDoCanal } from '@/lib/cb-channels/display';
import type { CbChannel } from '@/lib/cb-channels/repo';
import type { BlocoDeCampos } from '@/lib/contacts/grupos-de-campos';
import type { AccountMember } from '@/types';

/**
 * O estado de UM bloco da tela. Três fases, e não "lista + carregando":
 * ⚠️ lista vazia durante a carga NÃO pode afirmar "nenhuma etiqueta nesta
 * conta" (a armadilha do efeito passivo do CLAUDE.md), e a que falhou
 * também não — quem abre esta tela vai COPIAR daqui, e um "nenhuma" falso
 * manda a pessoa criar de novo o que já existe.
 */
export type EstadoDoBloco<T> =
  | { fase: 'carregando' }
  | { fase: 'falhou' }
  | { fase: 'pronto'; dados: T };

/** Os dados do bloco, ou `null` quando ele não está pronto. */
export function dadosDoBloco<T>(estado: EstadoDoBloco<T>): T | null {
  return estado.fase === 'pronto' ? estado.dados : null;
}

// ------------------------------------------------------------
// Funis e etapas
// ------------------------------------------------------------

/** 'ganho' | 'perdido' (CHECK da 950) — entrar na etapa carimba o status. */
export type ResultadoDaEtapa = 'ganho' | 'perdido';

/** A linha de `pipelines` como a tela a lê. */
export interface LinhaDeFunil {
  id: string;
  name: string;
}

/** A linha de `pipeline_stages` como a tela a lê. */
export interface LinhaDeEtapa {
  id: string;
  name: string;
  pipeline_id: string;
  position: number;
  color: string | null;
  resultado: string | null;
}

export interface EtapaDoFunil {
  id: string;
  nome: string;
  posicao: number;
  /**
   * A ordem no quadro, a partir de 1. Não é `posicao`: ela não é densa (nem
   * começa em 1), e a tela mostra "1, 2, 3". Calculada ANTES da busca, para a
   * etapa filtrada continuar dizendo que é a 3ª do funil.
   */
  ordem: number;
  cor: string | null;
  resultado: ResultadoDaEtapa | null;
}

export interface FunilComEtapas {
  id: string;
  nome: string;
  etapas: EtapaDoFunil[];
}

/**
 * Pendura as etapas no funil de cada uma, na ordem do quadro (`position`,
 * com o nome no empate — `position` repetida não é impedida pelo banco, e
 * sem desempate a ordem mudaria entre duas cargas). A ordem dos FUNIS é a
 * que veio da consulta (por criação, a mesma da tela de Funis e de
 * `GET /api/v1/pipelines`).
 *
 * Etapa de funil que não veio na lista é descartada: sob RLS as duas
 * consultas enxergam a mesma conta, então isso só acontece numa corrida
 * (funil apagado entre as duas) — e ali a etapa também já não existe.
 */
export function montarFunis(
  funis: LinhaDeFunil[],
  etapas: LinhaDeEtapa[],
): FunilComEtapas[] {
  const porFunil = new Map<string, EtapaDoFunil[]>();
  for (const funil of funis) porFunil.set(funil.id, []);

  for (const etapa of etapas) {
    const lista = porFunil.get(etapa.pipeline_id);
    if (!lista) continue;
    lista.push({
      id: etapa.id,
      nome: etapa.name,
      posicao: etapa.position,
      ordem: 0, // preenchida depois de ordenar, abaixo
      cor: etapa.color,
      // O CHECK da 950 já fecha o valor; ler de novo aqui custa uma linha e
      // impede que um valor estranho vire selo com chave inexistente.
      resultado:
        etapa.resultado === 'ganho' || etapa.resultado === 'perdido'
          ? etapa.resultado
          : null,
    });
  }

  return funis.map((funil) => ({
    id: funil.id,
    nome: funil.name,
    etapas: (porFunil.get(funil.id) ?? [])
      .sort((a, b) => a.posicao - b.posicao || a.nome.localeCompare(b.nome))
      .map((etapa, i) => ({ ...etapa, ordem: i + 1 })),
  }));
}

// ------------------------------------------------------------
// Etiquetas
// ------------------------------------------------------------

export interface EtiquetaDaConta {
  id: string;
  nome: string;
  cor: string | null;
}

// ------------------------------------------------------------
// Busca
// ------------------------------------------------------------

/**
 * O termo da busca e os textos comparados passam pela MESMA normalização:
 * aparado, minúsculas, sem acento. `\p{Mn}` depois de NFD, nunca
 * `\p{Diacritic}` — a segunda apaga também o acento que existe sozinho
 * (`^`, `~`), e a agulha viraria vazia e casaria com tudo (a armadilha do
 * `semAcento()` do fio, no CLAUDE.md).
 */
export function normalizarBusca(texto: string): string {
  return texto.normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase().trim();
}

/** `agulha` já normalizada; vazia = não há busca, tudo casa. */
function casa(agulha: string, ...campos: (string | null | undefined)[]): boolean {
  if (!agulha) return true;
  return campos.some((c) => !!c && normalizarBusca(c).includes(agulha));
}

/** A conta casa pelo nome ou pelo id. */
export function contaCasa(
  conta: { id: string; nome: string | null },
  agulha: string,
): boolean {
  return casa(agulha, conta.id, conta.nome);
}

/**
 * Funil que casa (nome ou id) aparece INTEIRO — quem buscou "Bancário" quer
 * as etapas dele. Senão, só as etapas que casam, debaixo do funil delas: uma
 * etapa "Lead" sem o funil ao lado não diz de qual dos quatro funis é.
 */
export function filtrarFunis(funis: FunilComEtapas[], agulha: string): FunilComEtapas[] {
  if (!agulha) return funis;
  return funis.flatMap((funil) => {
    if (casa(agulha, funil.nome, funil.id)) return [funil];
    const etapas = funil.etapas.filter((e) => casa(agulha, e.nome, e.id));
    return etapas.length > 0 ? [{ ...funil, etapas }] : [];
  });
}

export function filtrarEtiquetas(
  etiquetas: EtiquetaDaConta[],
  agulha: string,
): EtiquetaDaConta[] {
  if (!agulha) return etiquetas;
  return etiquetas.filter((e) => casa(agulha, e.nome, e.id));
}

/**
 * Campo casa pelo nome, pela CHAVE ou pelo id; o bloco que casa pelo nome
 * aparece inteiro (mesma lógica do funil). Bloco sem campo que case some
 * durante a busca — o cabeçalho sozinho não informa nada.
 *
 * `rotuloDoGeral`: o bloco "Geral" não tem linha no banco (`grupo` nulo),
 * então o nome dele vem do dicionário, e é por ele que a busca o acha.
 */
export function filtrarBlocosDeCampos(
  blocos: BlocoDeCampos[],
  agulha: string,
  rotuloDoGeral: string,
): BlocoDeCampos[] {
  if (!agulha) return blocos;
  return blocos.flatMap((bloco) => {
    if (casa(agulha, bloco.grupo?.nome ?? rotuloDoGeral, bloco.grupo?.id)) return [bloco];
    const campos = bloco.campos.filter((c) =>
      casa(agulha, c.field_name, c.field_key, c.id),
    );
    return campos.length > 0 ? [{ ...bloco, campos }] : [];
  });
}

/** Conexão casa pelo rótulo, pelo número (formatado ou cru), pelo @ ou pelo id. */
export function filtrarConexoes(canais: CbChannel[], agulha: string): CbChannel[] {
  if (!agulha) return canais;
  return canais.filter((c) =>
    casa(agulha, c.label, c.id, c.display_phone, identidadeDoCanal(c)),
  );
}

export function filtrarMembros(membros: AccountMember[], agulha: string): AccountMember[] {
  if (!agulha) return membros;
  return membros.filter((m) => casa(agulha, m.full_name, m.email, m.user_id));
}

// ------------------------------------------------------------
// "Copiar tudo (JSON)"
// ------------------------------------------------------------

export interface EntradaDoJson {
  conta: { id: string; nome: string | null } | null;
  funis: FunilComEtapas[] | null;
  etiquetas: EtiquetaDaConta[] | null;
  campos: BlocoDeCampos[] | null;
  /** O nome do bloco "Geral" (sem linha no banco — vem do dicionário). */
  rotuloDoGeral: string;
  conexoes: CbChannel[] | null;
  membros: AccountMember[] | null;
}

/**
 * O objeto do "Copiar tudo". Os nomes das chaves são os da API v1 sempre que
 * a API tem a mesma lista (`account` como em `GET /api/v1/me`, `pipelines`
 * com `stages`, `tags`, `channels` com `label`/`kind`/`display_phone`/
 * `is_default`, `field_key` dos campos): quem cola isto num fluxo reconhece
 * a forma que a API devolve, em vez de aprender uma segunda.
 *
 * ⚠️ Bloco que não carregou (ou falhou) sai como `null`, nunca `[]`: a
 * lista vazia afirmaria "a conta não tem nenhum", e o JSON sai da tela —
 * vai parar num fluxo onde ninguém vê o aviso de falha.
 *
 * Duas chaves são NOSSAS, por não existirem na API: `closes_as` na etapa
 * (a etapa com resultado da 950 — entrar nela marca o negócio `won`/`lost`,
 * o vocabulário de `deals.status`) e `group` no campo (o bloco em que ele
 * aparece na ficha).
 */
export function montarJsonDosIds(e: EntradaDoJson) {
  return {
    account: e.conta ? { id: e.conta.id, name: e.conta.nome } : null,
    pipelines:
      e.funis?.map((f) => ({
        id: f.id,
        name: f.nome,
        stages: f.etapas.map((etapa) => ({
          id: etapa.id,
          name: etapa.nome,
          position: etapa.posicao,
          closes_as:
            etapa.resultado === 'ganho' ? 'won' : etapa.resultado === 'perdido' ? 'lost' : null,
        })),
      })) ?? null,
    tags: e.etiquetas?.map((t) => ({ id: t.id, name: t.nome, color: t.cor })) ?? null,
    custom_fields:
      e.campos?.flatMap((bloco) =>
        bloco.campos.map((c) => ({
          id: c.id,
          field_key: c.field_key,
          field_name: c.field_name,
          field_type: c.field_type,
          group: bloco.grupo?.nome ?? e.rotuloDoGeral,
        })),
      ) ?? null,
    channels:
      e.conexoes?.map((c) => ({
        id: c.id,
        label: c.label,
        kind: c.kind,
        display_phone: c.display_phone,
        ig_username: c.ig_username,
        is_default: c.is_default,
      })) ?? null,
    members:
      e.membros?.map((m) => ({
        user_id: m.user_id,
        full_name: m.full_name,
        // Nulo para quem não é admin — a rota de membros esconde o e-mail
        // (`canManageMembers`), e o JSON não pode inventar um.
        email: m.email,
        role: m.role,
      })) ?? null,
  };
}
