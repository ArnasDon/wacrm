/**
 * As LISTAS do cartão do Asaas — puras. A partir das linhas do espelho (os
 * clientes com o vínculo, as cobranças devidas) e das fichas referenciadas,
 * monta o resumo e as cinco listas: Para confirmar, Sem ficha, Ligados,
 * Ignorados e Inadimplentes. A rota pagina o que sai daqui.
 *
 * ⚠️ O CPF/CNPJ só sai MASCARADO (`***.456.789-**`), e só por esta função —
 * é a única forma que atravessa a rota (D3). Documento de tamanho estranho
 * não sai de jeito nenhum.
 */

import { formatarTelefone } from "@/lib/contacts/telefone";

import { diasDeAtraso, faixaDeAtraso, resumirDivida, rotulosDasParcelas, type FaixaDeAtraso, type ParcelaDoEspelho } from "./inadimplencia";
import { situacaoDoCliente, type Candidato, type ClienteParaVincular, type SituacaoDoCliente } from "./vinculo";

export function mascararDocumento(documento: string | null | undefined): string | null {
  const d = (documento ?? "").replace(/\D/g, "");
  if (d.length === 11) return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
  if (d.length === 14) return `**.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-**`;
  return null;
}

export interface ClienteDoEspelho extends ClienteParaVincular {
  id: string;
  vinculado_por_nome: string | null;
  vinculado_em: string | null;
  notificacoes_desligadas: boolean;
}

export interface FichaResumida {
  id: string;
  nome: string | null;
  telefone: string | null;
}

export interface ContatoNaLista {
  id: string;
  nome: string | null;
  telefone: string | null;
}

export interface CandidatoNaLista extends ContatoNaLista {
  motivo: Candidato["motivo"];
  pontuacao: number | null;
}

export interface DividaNaLista {
  parcelas: number;
  rotulos: string;
  total: number;
  totalAtualizado: number;
  desde: string | null;
  dias: number | null;
  negativada: boolean;
}

export interface ItemDaLista {
  id: string;
  asaasId: string;
  nome: string;
  documento: string | null;
  email: string | null;
  /** "(83) 98874-5316" — o celular, senão o telefone */
  telefone: string | null;
  situacao: SituacaoDoCliente;
  origem: string | null;
  vinculadoPorNome: string | null;
  vinculadoEm: string | null;
  /** origem `criada` sem ficha: a ficha que o CRM criou foi apagada */
  fichaCriadaApagada: boolean;
  /** origem `telefone`/`cpf`/`email` sem ficha: a ficha ligada pela regra foi apagada — a regra não recria */
  fichaApagada: boolean;
  /** origem `manual` sem ficha: o contato ligado à mão foi apagado */
  manualOrfao: boolean;
  contato: ContatoNaLista | null;
  candidatos: CandidatoNaLista[];
  divida: DividaNaLista | null;
}

export interface ItemInadimplente {
  id: string;
  asaasId: string;
  nome: string;
  documento: string | null;
  situacao: SituacaoDoCliente;
  contato: ContatoNaLista | null;
  divida: DividaNaLista;
  faixa: FaixaDeAtraso;
}

export interface ResumoDoEspelho {
  clientes: number;
  ligados: number;
  ligadosPorOrigem: Record<string, number>;
  confirmar: number;
  semFicha: number;
  ignorados: number;
  inadimplentes: number;
  inadimplentesSemFicha: number;
  /** parcelas devidas (vencidas + negativadas) vistas na última listagem */
  parcelasVencidas: number;
  valorVencido: number;
  /**
   * Devidas que NÃO voltaram na última listagem completa e ainda não foram
   * relidas ("em conferência", §3.4): fora do total de propósito — podem
   * ter sido pagas. ⚠️ Enquanto for > 0 o total não é afirmação, e o cartão
   * diz isso (achado da revisão do PR #201).
   */
  parcelasEmConferencia: number;
  valorEmConferencia: number;
  /** cobranças com status que `classificar` não conhece — o cartão conta */
  statusDesconhecidos: number;
  /** clientes com mais de 3 parcelas vencidas (planejamento futuro, §8) */
  comMaisDeTresParcelas: number;
}

export interface ListasDoEspelho {
  resumo: ResumoDoEspelho;
  confirmar: ItemDaLista[];
  sem_ficha: ItemDaLista[];
  ligados: ItemDaLista[];
  ignorados: ItemDaLista[];
  inadimplentes: ItemInadimplente[];
}

export type NomeDaLista = keyof Omit<ListasDoEspelho, "resumo">;

export const NOMES_DAS_LISTAS: readonly NomeDaLista[] = ["confirmar", "sem_ficha", "ligados", "ignorados", "inadimplentes"];

export function ehNomeDeLista(v: string): v is NomeDaLista {
  return (NOMES_DAS_LISTAS as readonly string[]).includes(v);
}

function contatoNaLista(id: string | null, fichas: ReadonlyMap<string, FichaResumida>): ContatoNaLista | null {
  if (!id) return null;
  const f = fichas.get(id);
  return f ? { id: f.id, nome: f.nome, telefone: f.telefone ? formatarTelefone(f.telefone) : null } : { id, nome: null, telefone: null };
}

function porNome(a: { nome: string }, b: { nome: string }): number {
  return a.nome.localeCompare(b.nome, "pt-BR") || a.nome.localeCompare(b.nome);
}

export interface ExtrasDoResumo {
  /**
   * Cobranças do espelho com status que `classificar` não conhece, CONTADAS
   * no banco. ⚠️ Não dá para contá-las a partir de `cobrancas`: a leitura
   * que alimenta as listas traz só as DEVIDAS (vencida/negativada), então um
   * status novo que a reconciliação gravou nunca chegaria aqui — e o aviso
   * do cartão, que existe para dizer "o CRM precisa aprender um status novo",
   * ficaria em zero para sempre (achado do Codex no PR #201).
   */
  statusDesconhecidos?: number;
}

export function montarListas(
  clientes: readonly ClienteDoEspelho[],
  cobrancas: readonly ParcelaDoEspelho[],
  fichas: ReadonlyMap<string, FichaResumida>,
  agora: Date,
  vencidasListadasEm: string | null,
  extras: ExtrasDoResumo = {},
): ListasDoEspelho {
  const porCliente = new Map<string, ParcelaDoEspelho[]>();
  let statusDesconhecidos = 0;
  for (const c of cobrancas) {
    const lista = porCliente.get(c.asaas_customer_id);
    if (lista) lista.push(c);
    else porCliente.set(c.asaas_customer_id, [c]);
  }

  const resumo: ResumoDoEspelho = {
    clientes: 0,
    ligados: 0,
    ligadosPorOrigem: {},
    confirmar: 0,
    semFicha: 0,
    ignorados: 0,
    inadimplentes: 0,
    inadimplentesSemFicha: 0,
    parcelasVencidas: 0,
    valorVencido: 0,
    parcelasEmConferencia: 0,
    valorEmConferencia: 0,
    statusDesconhecidos: 0,
    comMaisDeTresParcelas: 0,
  };
  const listas: ListasDoEspelho = { resumo, confirmar: [], sem_ficha: [], ligados: [], ignorados: [], inadimplentes: [] };

  for (const c of clientes) {
    if (c.deleted) continue;
    resumo.clientes++;
    const situacao = situacaoDoCliente(c);
    const divida = resumirDivida(porCliente.get(c.asaas_customer_id) ?? [], agora, vencidasListadasEm);
    const dividaNaLista: DividaNaLista | null =
      divida.vencidas.length > 0
        ? {
            parcelas: divida.vencidas.length,
            rotulos: rotulosDasParcelas(divida.vencidas),
            total: divida.total,
            totalAtualizado: divida.totalAtualizado,
            desde: divida.desde,
            dias: divida.dias,
            negativada: divida.negativada,
          }
        : null;
    const item: ItemDaLista = {
      id: c.id,
      asaasId: c.asaas_customer_id,
      nome: c.nome,
      documento: mascararDocumento(c.cpf_cnpj),
      email: c.email,
      telefone: c.celular ? formatarTelefone(c.celular) : c.telefone ? formatarTelefone(c.telefone) : null,
      situacao,
      origem: c.vinculo_origem,
      vinculadoPorNome: c.vinculado_por_nome,
      vinculadoEm: c.vinculado_em,
      fichaCriadaApagada: c.contact_id === null && c.vinculo_origem === "criada",
      fichaApagada: c.contact_id === null && (c.vinculo_origem === "telefone" || c.vinculo_origem === "cpf" || c.vinculo_origem === "email"),
      manualOrfao: c.contact_id === null && c.vinculo_origem === "manual",
      contato: contatoNaLista(c.contact_id, fichas),
      candidatos: c.candidatos.map((k) => ({ ...(contatoNaLista(k.contact_id, fichas) as ContatoNaLista), motivo: k.motivo, pontuacao: k.pontuacao ?? null })),
      divida: dividaNaLista,
    };
    if (situacao === "ligado") {
      resumo.ligados++;
      const origem = c.vinculo_origem ?? "sem_origem";
      resumo.ligadosPorOrigem[origem] = (resumo.ligadosPorOrigem[origem] ?? 0) + 1;
      listas.ligados.push(item);
    } else if (situacao === "confirmar") {
      resumo.confirmar++;
      listas.confirmar.push(item);
    } else if (situacao === "ignorado") {
      resumo.ignorados++;
      listas.ignorados.push(item);
    } else {
      resumo.semFicha++;
      listas.sem_ficha.push(item);
    }
    if (divida.emConferencia.length > 0) {
      resumo.parcelasEmConferencia += divida.emConferencia.length;
      resumo.valorEmConferencia = Math.round((resumo.valorEmConferencia + divida.emConferencia.reduce((s, p) => s + p.valor, 0)) * 100) / 100;
    }
    if (dividaNaLista) {
      resumo.inadimplentes++;
      if (situacao !== "ligado") resumo.inadimplentesSemFicha++;
      resumo.parcelasVencidas += dividaNaLista.parcelas;
      resumo.valorVencido = Math.round((resumo.valorVencido + dividaNaLista.total) * 100) / 100;
      if (dividaNaLista.parcelas > 3) resumo.comMaisDeTresParcelas++;
      listas.inadimplentes.push({
        id: c.id,
        asaasId: c.asaas_customer_id,
        nome: c.nome,
        documento: item.documento,
        situacao,
        contato: item.contato,
        divida: dividaNaLista,
        faixa: faixaDeAtraso(dividaNaLista.dias ?? 0),
      });
    }
  }
  // Sem a contagem do banco, conta entre as linhas recebidas (os testes e
  // quem chamar com o espelho inteiro em mãos).
  if (extras.statusDesconhecidos === undefined) {
    for (const c of cobrancas) {
      if (!c.deleted && classificarDesconhecida(c.status)) statusDesconhecidos++;
    }
  } else statusDesconhecidos = extras.statusDesconhecidos;
  resumo.statusDesconhecidos = statusDesconhecidos;

  listas.confirmar.sort(porNome);
  listas.sem_ficha.sort(porNome);
  listas.ligados.sort(porNome);
  listas.ignorados.sort(porNome);
  // Inadimplentes: quem está há mais tempo em atraso primeiro.
  listas.inadimplentes.sort((a, b) => (b.divida.dias ?? 0) - (a.divida.dias ?? 0) || porNome(a, b));
  return listas;
}

export const STATUS_CONHECIDOS = new Set([
  "PENDING",
  "RECEIVED",
  "CONFIRMED",
  "OVERDUE",
  "REFUNDED",
  "RECEIVED_IN_CASH",
  "REFUND_REQUESTED",
  "REFUND_IN_PROGRESS",
  "CHARGEBACK_REQUESTED",
  "CHARGEBACK_DISPUTE",
  "AWAITING_CHARGEBACK_REVERSAL",
  "DUNNING_REQUESTED",
  "DUNNING_RECEIVED",
  "AWAITING_RISK_ANALYSIS",
]);

function classificarDesconhecida(status: string): boolean {
  return !STATUS_CONHECIDOS.has(status);
}

/** Casa o termo da busca do cartão contra nome, documento (dígitos), telefone e o nome da ficha. */
export function casaComABusca(item: ItemDaLista, termo: string): boolean {
  const t = termo.trim().toLowerCase();
  if (t === "") return true;
  const digitos = t.replace(/\D/g, "");
  if (item.nome.toLowerCase().includes(t)) return true;
  if (item.contato?.nome?.toLowerCase().includes(t)) return true;
  if (item.email?.toLowerCase().includes(t)) return true;
  if (digitos.length >= 4) {
    if (item.telefone?.replace(/\D/g, "").includes(digitos)) return true;
    if (item.contato?.telefone?.replace(/\D/g, "").includes(digitos)) return true;
  }
  return false;
}

export interface Pagina<T> {
  itens: T[];
  total: number;
  pagina: number;
  porPagina: number;
  paginas: number;
}

export const POR_PAGINA = 20;

export function paginar<T>(itens: readonly T[], pagina: number, porPagina: number = POR_PAGINA): Pagina<T> {
  const paginas = Math.max(1, Math.ceil(itens.length / porPagina));
  const p = Math.min(Math.max(1, Math.trunc(pagina) || 1), paginas);
  return { itens: itens.slice((p - 1) * porPagina, p * porPagina), total: itens.length, pagina: p, porPagina, paginas };
}

/** Dias de atraso da parcela mais antiga de um cliente — para a lista e o `title` da linha. */
export function diasDaDivida(desde: string | null, agora: Date): number | null {
  return desde ? diasDeAtraso(desde, agora) : null;
}
