/**
 * Leitura TOLERANTE do que o Asaas devolve. Puro, sem I/O.
 *
 * ⚠️ "Atributos novos podem aparecer a qualquer momento", diz a doc — então
 * campo desconhecido é IGNORADO e campo faltando não derruba a linha
 * inteira. Só `id` é exigido: sem ele não há nada para guardar nem para
 * contar.
 *
 * ⚠️ `installmentNumber` chega ora número, ora texto (é a forma da doc para
 * vários campos numéricos) — `inteiro()` aceita os dois.
 *
 * ⚠️ Nada aqui formata data. `dueDate` é `"2026-09-01"` e vira `Date` só
 * com a hora local colada (`diaParaData`), nunca com `new Date("2026-09-01")`
 * — aquilo é meia-noite UTC e retrocede um dia no Brasil.
 */

import { digitosDoTelefone } from "@/lib/contacts/telefone";

export interface ClienteDoAsaas {
  id: string;
  nome: string;
  email: string | null;
  /** `mobilePhone`, só dígitos com DDI. */
  celular: string | null;
  /** `phone`, só dígitos com DDI. */
  telefone: string | null;
  /** Só dígitos. 11 = CPF, 14 = CNPJ. */
  cpfCnpj: string | null;
  tipoDePessoa: string | null;
  apagado: boolean;
  referenciaExterna: string | null;
  notificacoesDesligadas: boolean;
}

export interface CobrancaDoAsaas {
  id: string;
  clienteId: string | null;
  status: string;
  valor: number;
  jurosEMulta: number | null;
  /** `dueDate`, como veio: `"AAAA-MM-DD"`. */
  vencimento: string | null;
  vencimentoOriginal: string | null;
  pagoEm: string | null;
  forma: string | null;
  descricao: string | null;
  parcelamentoId: string | null;
  parcelaNumero: number | null;
  assinaturaId: string | null;
  linkFatura: string | null;
  linkBoleto: string | null;
  podePagarAposVencimento: boolean | null;
  diasAteCancelarRegistro: number | null;
  apagado: boolean;
}

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function texto(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const aparado = v.trim();
  return aparado === "" ? null : aparado;
}

/** Número vindo como número OU como texto ("3", "3.0"). */
export function inteiro(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? Math.trunc(v) : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }
  return null;
}

function decimal(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Só os dígitos, ou `null`. Serve a CPF/CNPJ — nunca é exibido inteiro. */
export function soDigitos(v: unknown): string | null {
  const t = texto(v);
  if (!t) return null;
  const d = t.replace(/\D/g, "");
  return d === "" ? null : d;
}

export function lerCliente(bruto: unknown): ClienteDoAsaas | null {
  if (!ehObjeto(bruto)) return null;
  const id = texto(bruto.id);
  if (!id) return null;
  return {
    id,
    nome: texto(bruto.name) ?? "",
    email: texto(bruto.email)?.toLowerCase() ?? null,
    celular: digitosDoTelefone(texto(bruto.mobilePhone)),
    telefone: digitosDoTelefone(texto(bruto.phone)),
    cpfCnpj: soDigitos(bruto.cpfCnpj),
    tipoDePessoa: texto(bruto.personType),
    apagado: bruto.deleted === true,
    referenciaExterna: texto(bruto.externalReference),
    notificacoesDesligadas: bruto.notificationDisabled === true,
  };
}

export function lerCobranca(bruto: unknown): CobrancaDoAsaas | null {
  if (!ehObjeto(bruto)) return null;
  const id = texto(bruto.id);
  if (!id) return null;
  return {
    id,
    clienteId: texto(bruto.customer),
    status: texto(bruto.status) ?? "",
    valor: decimal(bruto.value) ?? 0,
    jurosEMulta: decimal(bruto.interestValue),
    vencimento: texto(bruto.dueDate),
    vencimentoOriginal: texto(bruto.originalDueDate),
    // `clientPaymentDate` é quando o cliente diz que pagou; `paymentDate`, quando
    // o Asaas registrou. A primeira é a que o cliente reconhece.
    pagoEm: texto(bruto.clientPaymentDate) ?? texto(bruto.paymentDate),
    forma: texto(bruto.billingType),
    descricao: texto(bruto.description),
    parcelamentoId: texto(bruto.installment),
    parcelaNumero: inteiro(bruto.installmentNumber),
    assinaturaId: texto(bruto.subscription),
    linkFatura: texto(bruto.invoiceUrl),
    linkBoleto: texto(bruto.bankSlipUrl),
    podePagarAposVencimento: typeof bruto.canBePaidAfterDueDate === "boolean" ? bruto.canBePaidAfterDueDate : null,
    diasAteCancelarRegistro: inteiro(bruto.daysAfterDueDateToRegistrationCancellation),
    apagado: bruto.deleted === true,
  };
}

/**
 * `"2026-09-01"` → o dia 1º às 00:00 do FUSO LOCAL de quem lê, nunca UTC.
 * É a armadilha da coluna DATE deste projeto: `new Date("2026-09-01")` é
 * meia-noite UTC e no Brasil cai em 31/08.
 */
export function diaParaData(dia: string): Date | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(dia) ? new Date(`${dia}T00:00:00`) : null;
}
