/**
 * O VÍNCULO cliente do Asaas ↔ contato do CRM — a decisão de produção
 * (§3.3 do plano), pura. `decidirVinculo` de `levantamento.ts` foi o ensaio
 * dela contra a conta real; esta é a que a sincronização grava.
 *
 * A ordem dos sinais e o que cada um pode fazer:
 *
 * | Sinal | Como casa | Pode |
 * | 1 telefone | `celular`/`telefone` do Asaas, com a irmã do nono dígito, contra `phone_normalized` | LIGAR |
 * | 2 CPF/CNPJ | outro cliente do Asaas com o MESMO documento já ligado a um contato (cadastro duplicado) | LIGAR |
 * | 3 e-mail | `contacts.email`, senão o agendamento do Calendly que já resolveu o contato | LIGAR |
 * | 4 sufixo de 8 | como `findExistingContact`, colhendo TODOS os candidatos | só SUGERIR |
 * | 5 nome aproximado | `nome-aproximado.ts`, só para quem NÃO tem telefone | só SUGERIR |
 *
 * Regras que não se negociam (todas com teste):
 * - Quem a regra olha: `contact_id` nulo e origem nula ou dada pela própria
 *   regra (`telefone`, `cpf`, `email`) — ou `criada` (a ficha que o CRM criou
 *   pode ter sido apagada ou fundida, e o cliente volta ao VÍNCULO, nunca à
 *   criação). `manual` órfã e `desvinculado` são de gente: a regra não toca.
 * - Desligado por gente nunca volta (`contatos_recusados`).
 * - Conflito vira pergunta: só liga sozinho quando os sinais fortes apontam
 *   para UM contato. Telefone dizendo A e e-mail dizendo B → "Para confirmar".
 * - Um contato, um CPF: a regra não liga um cliente a um contato já ligado a
 *   outro cliente de documento DIFERENTE. Mesmo documento liga (é o cadastro
 *   duplicado do Asaas).
 * - A cerca da esposa que paga a conta: (a) telefone igual ao de uma conexão
 *   da conta nunca liga nem cria ficha; (b) ficha com nome de gente sem
 *   nenhum token em comum com o nome do Asaas vai para "Para confirmar".
 * - Quem tem telefone e não casou com ninguém GANHA FICHA (D2); quem não
 *   tem, fica listado com as sugestões por nome.
 */

import { variantesDoNonoDigito } from "@/lib/contacts/telefone";

import { nomesIncompativeis, sugerirPorNome } from "./nome-aproximado";

export type MotivoDoCandidato =
  | "sufixo"
  | "nome_aproximado"
  | "ambiguo"
  | "conflito"
  | "nome_diferente"
  | "contato_ja_ligado";

export const MOTIVOS_DO_CANDIDATO: readonly MotivoDoCandidato[] = [
  "sufixo",
  "nome_aproximado",
  "ambiguo",
  "conflito",
  "nome_diferente",
  "contato_ja_ligado",
];

export interface Candidato {
  contact_id: string;
  motivo: MotivoDoCandidato;
  /** só no nome aproximado: tokens em comum ÷ tokens do nome menor */
  pontuacao?: number;
}

export type OrigemDoVinculo = "telefone" | "cpf" | "email" | "criada" | "manual" | "desvinculado";

/** As origens que a REGRA automática pode reescrever. */
const ORIGENS_DA_REGRA: ReadonlySet<string> = new Set(["telefone", "cpf", "email", "criada"]);

export interface ClienteParaVincular {
  asaas_customer_id: string;
  nome: string;
  cpf_cnpj: string | null;
  email: string | null;
  celular: string | null;
  telefone: string | null;
  contact_id: string | null;
  vinculo_origem: string | null;
  contatos_recusados: string[];
  candidatos: Candidato[];
  deleted: boolean;
}

export interface FichaDoCrm {
  id: string;
  nome: string | null;
  /** `phone_normalized` — só dígitos, com DDI */
  telefone: string | null;
  email: string | null;
}

export interface IndicesDoVinculo {
  porTelefone: Map<string, Set<string>>;
  porSufixo: Map<string, Set<string>>;
  porEmail: Map<string, Set<string>>;
  emailsDoCalendly: Map<string, Set<string>>;
  fichas: Map<string, FichaDoCrm>;
  /** os números das conexões da conta, só dígitos */
  telefonesDasConexoes: Set<string>;
  /** documento → contato, dos clientes do Asaas JÁ ligados */
  contatoPorDocumento: Map<string, string>;
  /** contato → o cliente do Asaas ligado a ele */
  clientePorContato: Map<string, { customerId: string; nome: string; cpfCnpj: string | null }>;
}

function acrescentar(mapa: Map<string, Set<string>>, chave: string, id: string): void {
  const atual = mapa.get(chave);
  if (atual) atual.add(id);
  else mapa.set(chave, new Set([id]));
}

export function montarIndices(
  fichas: readonly FichaDoCrm[],
  emailsDoCalendly: Map<string, Set<string>>,
  telefonesDasConexoes: Iterable<string>,
  clientesLigados: readonly Pick<ClienteParaVincular, "asaas_customer_id" | "nome" | "cpf_cnpj" | "contact_id">[],
): IndicesDoVinculo {
  const porTelefone = new Map<string, Set<string>>();
  const porSufixo = new Map<string, Set<string>>();
  const porEmail = new Map<string, Set<string>>();
  const mapaDeFichas = new Map<string, FichaDoCrm>();
  for (const f of fichas) {
    mapaDeFichas.set(f.id, f);
    if (f.telefone) {
      acrescentar(porTelefone, f.telefone, f.id);
      if (f.telefone.length >= 8) acrescentar(porSufixo, f.telefone.slice(-8), f.id);
    }
    const email = f.email?.trim().toLowerCase();
    if (email) acrescentar(porEmail, email, f.id);
  }
  const contatoPorDocumento = new Map<string, string>();
  const clientePorContato = new Map<string, { customerId: string; nome: string; cpfCnpj: string | null }>();
  for (const c of clientesLigados) {
    if (!c.contact_id) continue;
    if (c.cpf_cnpj && !contatoPorDocumento.has(c.cpf_cnpj)) contatoPorDocumento.set(c.cpf_cnpj, c.contact_id);
    if (!clientePorContato.has(c.contact_id)) {
      clientePorContato.set(c.contact_id, { customerId: c.asaas_customer_id, nome: c.nome, cpfCnpj: c.cpf_cnpj });
    }
  }
  return {
    porTelefone,
    porSufixo,
    porEmail,
    emailsDoCalendly,
    fichas: mapaDeFichas,
    telefonesDasConexoes: new Set([...telefonesDasConexoes].map((t) => t.replace(/\D/g, "")).filter((t) => t !== "")),
    contatoPorDocumento,
    clientePorContato,
  };
}

export type DecisaoDoVinculo =
  | { acao: "nada" }
  | { acao: "ligar"; contactId: string; origem: "telefone" | "cpf" | "email" }
  | { acao: "confirmar"; candidatos: Candidato[] }
  | { acao: "criar"; telefone: string }
  | { acao: "sem_ficha"; candidatos: Candidato[] };

/** A regra automática pode mexer neste cliente? */
export function elegivel(c: Pick<ClienteParaVincular, "contact_id" | "vinculo_origem" | "deleted">): boolean {
  if (c.deleted || c.contact_id !== null) return false;
  return c.vinculo_origem === null || ORIGENS_DA_REGRA.has(c.vinculo_origem);
}

/** Os telefones do cliente que servem para casar/criar: sem repetição e sem os da própria conta. */
export function telefonesUteis(c: Pick<ClienteParaVincular, "celular" | "telefone">, conexoes: ReadonlySet<string>): string[] {
  const saida: string[] = [];
  for (const t of [c.celular, c.telefone]) {
    if (!t || saida.includes(t) || conexoes.has(t)) continue;
    saida.push(t);
  }
  return saida;
}

export function decidir(cliente: ClienteParaVincular, idx: IndicesDoVinculo): DecisaoDoVinculo {
  if (!elegivel(cliente)) return { acao: "nada" };
  const recusados = new Set(cliente.contatos_recusados);
  const semRecusados = (ids: Iterable<string>) => new Set([...ids].filter((id) => !recusados.has(id)));
  const telefones = telefonesUteis(cliente, idx.telefonesDasConexoes);

  // 1) telefone — exato ou a irmã do nono dígito, os dois são "telefone"
  const porTelefone = new Set<string>();
  for (const t of telefones) {
    for (const variante of variantesDoNonoDigito(t)) {
      for (const id of idx.porTelefone.get(variante) ?? []) porTelefone.add(id);
    }
  }
  const sinalTelefone = semRecusados(porTelefone);

  // 2) documento — outro cliente do Asaas com o mesmo CPF/CNPJ já ligado
  const sinalCpf = new Set<string>();
  if (cliente.cpf_cnpj) {
    const ligado = idx.contatoPorDocumento.get(cliente.cpf_cnpj);
    if (ligado && !recusados.has(ligado)) sinalCpf.add(ligado);
  }

  // 3) e-mail — a ficha, senão a ponte do Calendly
  let sinalEmail = new Set<string>();
  if (cliente.email) {
    const daFicha = semRecusados(idx.porEmail.get(cliente.email) ?? []);
    sinalEmail = daFicha.size > 0 ? daFicha : semRecusados(idx.emailsDoCalendly.get(cliente.email) ?? []);
  }

  const fortes = new Set([...sinalTelefone, ...sinalCpf, ...sinalEmail]);
  if (fortes.size > 1) {
    // Dois ou mais contatos: o MESMO sinal apontando para dois é ambíguo; sinais
    // discordando é conflito. Nos dois casos é pergunta, nunca vínculo.
    const ambiguo = sinalTelefone.size > 1 || sinalEmail.size > 1;
    return { acao: "confirmar", candidatos: [...fortes].map((contact_id) => ({ contact_id, motivo: ambiguo ? "ambiguo" : "conflito" })) };
  }
  if (fortes.size === 1) {
    const contactId = [...fortes][0];
    const origem: "telefone" | "cpf" | "email" = sinalTelefone.has(contactId) ? "telefone" : sinalCpf.has(contactId) ? "cpf" : "email";
    // Um contato, um CPF: já ligado a outro cliente de documento diferente.
    const jaLigado = idx.clientePorContato.get(contactId);
    if (jaLigado && jaLigado.customerId !== cliente.asaas_customer_id) {
      const mesmoDocumento = jaLigado.cpfCnpj !== null && cliente.cpf_cnpj !== null && jaLigado.cpfCnpj === cliente.cpf_cnpj;
      if (!mesmoDocumento) return { acao: "confirmar", candidatos: [{ contact_id: contactId, motivo: "contato_ja_ligado" }] };
    }
    // A cerca da esposa que paga a conta: o telefone bate, o nome não.
    if (origem === "telefone" && nomesIncompativeis(cliente.nome, idx.fichas.get(contactId)?.nome)) {
      return { acao: "confirmar", candidatos: [{ contact_id: contactId, motivo: "nome_diferente" }] };
    }
    return { acao: "ligar", contactId, origem };
  }

  // 4) sufixo de 8 — só sugere
  const porSufixo = new Set<string>();
  for (const t of telefones) {
    if (t.length >= 8) for (const id of idx.porSufixo.get(t.slice(-8)) ?? []) porSufixo.add(id);
  }
  const sufixos = semRecusados(porSufixo);
  if (sufixos.size > 0) return { acao: "confirmar", candidatos: [...sufixos].map((contact_id) => ({ contact_id, motivo: "sufixo" })) };

  // D2: com telefone e sem ninguém parecido, a ficha nasce — SÓ quando a
  // regra nunca ligou este cliente (`vinculo_origem IS NULL`). Origem
  // `criada`, `telefone`, `cpf` ou `email` com `contact_id` nulo quer dizer
  // que a ficha ligada foi APAGADA por decisão de gente (981, `ON DELETE SET
  // NULL`): recriá-la desfaria a decisão, a cada ciclo. Vai para "Sem ficha"
  // (a tela diz por quê). A regra ainda RELIGA pelo telefone à ficha
  // sobrevivente de uma fusão — isso é o passo 1, acima.
  if (telefones.length > 0 && cliente.vinculo_origem === null) return { acao: "criar", telefone: telefones[0] };

  // 5) sem telefone: só o nome aproximado, e só como sugestão (não para a
  // ficha apagada: a decisão de gente foi tirar, não trocar)
  const porNome = cliente.vinculo_origem === null ? sugerirPorNome(cliente.nome, idx.fichas.values()) : [];
  return {
    acao: "sem_ficha",
    candidatos: porNome.filter((s) => !recusados.has(s.contactId)).map((s) => ({ contact_id: s.contactId, motivo: "nome_aproximado", pontuacao: s.pontuacao })),
  };
}

export type SituacaoDoCliente = "ligado" | "confirmar" | "sem_ficha" | "ignorado";

/**
 * Em que lista do cartão o cliente aparece — DERIVADO da linha, nunca uma
 * coluna própria (duas fontes divergem na primeira falha).
 */
export function situacaoDoCliente(c: Pick<ClienteParaVincular, "contact_id" | "vinculo_origem" | "candidatos">): SituacaoDoCliente {
  if (c.contact_id !== null) return "ligado";
  if (c.vinculo_origem === "desvinculado") return "ignorado";
  // Vínculo manual cujo contato foi apagado: volta para gente, a regra não religa.
  if (c.vinculo_origem === "manual") return "confirmar";
  if (c.candidatos.some((k) => k.motivo !== "nome_aproximado")) return "confirmar";
  return "sem_ficha";
}

/** Dois conjuntos de candidatos dizem a mesma coisa? (para não regravar a linha a cada ciclo) */
export function mesmosCandidatos(a: readonly Candidato[], b: readonly Candidato[]): boolean {
  if (a.length !== b.length) return false;
  const chave = (k: Candidato) => `${k.contact_id}|${k.motivo}|${k.pontuacao ?? ""}`;
  const de = new Set(a.map(chave));
  return b.every((k) => de.has(chave(k)));
}
