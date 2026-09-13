import type { SupabaseClient } from "@supabase/supabase-js";

import { chaveDeTag } from "@/lib/contacts/chave-de-tag";
import { variantesDoNonoDigito } from "@/lib/contacts/telefone";

import { AsaasError, type ClienteAsaas } from "./cliente";
import { lerCliente, lerCobranca, type ClienteDoAsaas, type CobrancaDoAsaas } from "./leitura";

/**
 * O LEVANTAMENTO da Fase 0 (§3.1 do plano), rodando dentro do CRM com a
 * chave que já está guardada cifrada — em vez do script solto com a chave
 * colada num arquivo, que era o desenho original.
 *
 * ⚠️ **Só GET, e NADA é gravado.** Nem no Asaas, nem no banco. O relatório
 * volta na resposta da rota, é lido e some. É o que permite rodá-lo contra a
 * conta REAL sem decidir nada antes: são os números daqui que calibram as
 * decisões D2 (cliente sem ficha), D5 (telefone que só bate pelo sufixo) e
 * D10 (avisos nativos do Asaas), e é por isso que as tabelas do espelho
 * ainda não existem.
 *
 * ⚠️ **Nada identificável sai inteiro.** Nome vira primeiro nome; telefone,
 * os 4 últimos dígitos; CPF/CNPJ nunca aparece — só a CONTAGEM por tamanho.
 * O relatório é lido por gente e pode acabar colado num chat.
 */

export interface ContagemDeClientes {
  total: number;
  apagados: number;
  comEmail: number;
  comCelular: number;
  comTelefone: number;
  semTelefoneNenhum: number;
  comCpf: number;
  comCnpj: number;
  comDocumentoDeOutroTamanho: number;
  semDocumento: number;
  notificacoesDesligadas: number;
  comReferenciaExterna: number;
  documentosRepetidos: number;
  telefonesRepetidos: number;
  porTipoDePessoa: Record<string, number>;
  porFormatoDeTelefone: Record<string, number>;
}

export type MotivoDoVinculo =
  | "telefone_igual"
  | "nono_digito"
  | "sufixo_8"
  | "email_da_ficha"
  | "email_do_calendly"
  | "nome"
  | "ambiguo"
  | "sem_candidato";

export interface ContagemDoVinculo extends Record<MotivoDoVinculo, number> {
  contatosNoCrm: number;
  contatosComEmail: number;
  emailsDoCalendly: number;
  contatosDisputados: number;
}

export interface ExemploDeVinculo {
  cliente: string;
  motivo: MotivoDoVinculo;
  contato: string | null;
}

export interface ContagemDeCobrancas {
  vencidas: number;
  vencidasApagadas: number;
  clientesComVencida: number;
  clientesComVencidaEFicha: number;
  valorVencido: number;
  jurosAcumulado: number;
  vencimentoMaisAntigo: string | null;
  porFaixaDeAtraso: Record<string, number>;
  boletoJaNaoPagavel: number;
  comParcelamento: number;
  deAssinatura: number;
  clientesComDoisVencimentosNoMesmoDia: number;
  porForma: Record<string, number>;
}

export interface RelatorioDoLevantamento {
  geradoEm: string;
  clientes: ContagemDeClientes;
  vinculo: ContagemDoVinculo;
  exemplos: ExemploDeVinculo[];
  cobrancas: ContagemDeCobrancas;
  sondas: Record<string, string>;
  cota: Record<string, string>;
  avisos: string[];
}

/** Quantos exemplos mascarados o relatório carrega, por motivo. */
const EXEMPLOS_POR_MOTIVO = 2;
/** Teto de clientes com vencida cuja configuração de avisos é lida (C8). */
const AMOSTRA_DE_NOTIFICACOES = 3;
/** Página do PostgREST ao varrer `contacts` — o teto dele é 1000. */
const PAGINA_DO_BANCO = 1000;

// ---------------------------------------------------------------------------
// Puros
// ---------------------------------------------------------------------------

/** Primeiro nome, ou "—". O resto do nome não entra no relatório. */
export function primeiroNome(nome: string | null | undefined): string {
  const primeiro = (nome ?? "").trim().split(/\s+/)[0] ?? "";
  return primeiro === "" ? "—" : primeiro;
}

/** "…4316" — o suficiente para o operador reconhecer, e só. */
export function fimDoTelefone(digitos: string | null | undefined): string {
  return digitos && digitos.length >= 4 ? `…${digitos.slice(-4)}` : "—";
}

/** Como o Asaas devolveu o telefone, em forma (C1) — nunca o número. */
export function formatoDoTelefone(digitos: string | null): string {
  if (!digitos) return "vazio";
  const ddi = digitos.startsWith("55") ? "com 55" : "sem 55";
  return `${digitos.length} dígitos, ${ddi}`;
}

/** Faixa de atraso em dias, para o relatório. */
export function faixaDeAtraso(dias: number): string {
  if (dias < 0) return "ainda não venceu";
  if (dias <= 1) return "até 1 dia";
  if (dias <= 5) return "2 a 5 dias";
  if (dias <= 30) return "6 a 30 dias";
  if (dias <= 90) return "31 a 90 dias";
  if (dias <= 365) return "91 a 365 dias";
  return "mais de um ano";
}

/**
 * Dias de calendário entre `AAAA-MM-DD` e hoje, no fuso local.
 * ⚠️ Nunca `new Date("2026-09-01")` — meia-noite UTC retrocede um dia aqui.
 */
export function diasDeAtraso(vencimento: string, agora: Date): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(vencimento)) return null;
  const dia = new Date(`${vencimento}T00:00:00`);
  const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  return Math.round((hoje.getTime() - dia.getTime()) / 86_400_000);
}

export interface ContatoDoCrm {
  id: string;
  nome: string | null;
  telefone: string | null;
  email: string | null;
}

export interface IndicesDoCrm {
  /** O telefone da ficha, exatamente como a coluna o guarda. */
  porTelefone: Map<string, Set<string>>;
  /** A IRMÃ com/sem o nono dígito — índice separado, para o relatório poder
   *  dizer por qual régua o cliente casou. */
  porIrma: Map<string, Set<string>>;
  porSufixo: Map<string, Set<string>>;
  porEmail: Map<string, Set<string>>;
  porNome: Map<string, Set<string>>;
  total: number;
  comEmail: number;
}

function acrescentar(mapa: Map<string, Set<string>>, chave: string, id: string): void {
  const atual = mapa.get(chave);
  if (atual) atual.add(id);
  else mapa.set(chave, new Set([id]));
}

/**
 * Os índices do CRM contra os quais cada cliente do Asaas é procurado.
 *
 * ⚠️ São TRÊS índices de telefone, e não um, porque o relatório precisa
 * dizer por qual régua cada cliente casou: exato, irmã do nono dígito
 * (a coluna guarda ora com 9, ora sem) e sufixo de 8. Num índice só,
 * "telefone idêntico" contaria também o que só bate a menos do 9 — e é
 * justamente essa distinção que a D5 usa para decidir o que vira vínculo
 * automático e o que vira sugestão.
 */
export function indicesDoCrm(contatos: ContatoDoCrm[]): IndicesDoCrm {
  const porTelefone = new Map<string, Set<string>>();
  const porIrma = new Map<string, Set<string>>();
  const porSufixo = new Map<string, Set<string>>();
  const porEmail = new Map<string, Set<string>>();
  const porNome = new Map<string, Set<string>>();
  let comEmail = 0;
  for (const c of contatos) {
    if (c.telefone) {
      acrescentar(porTelefone, c.telefone, c.id);
      for (const irma of variantesDoNonoDigito(c.telefone).slice(1)) acrescentar(porIrma, irma, c.id);
      if (c.telefone.length >= 8) acrescentar(porSufixo, c.telefone.slice(-8), c.id);
    }
    const email = c.email?.trim().toLowerCase();
    if (email) {
      comEmail++;
      acrescentar(porEmail, email, c.id);
    }
    const nome = c.nome?.trim();
    if (nome) acrescentar(porNome, chaveDeTag(nome), c.id);
  }
  return { porTelefone, porIrma, porSufixo, porEmail, porNome, total: contatos.length, comEmail };
}

export interface DecisaoDoVinculo {
  motivo: MotivoDoVinculo;
  contactId: string | null;
}

/**
 * A decisão SIMULADA para um cliente do Asaas — a mesma ordem que o vínculo
 * automático usará: telefone igual, irmã do nono dígito, e-mail da ficha,
 * e-mail do Calendly, sufixo de 8, nome. Mais de um candidato em qualquer
 * degrau é `ambiguo` e para ali: no degrau seguinte a régua é mais frouxa,
 * e escolher por ela seria trocar uma dúvida por uma afirmação.
 */
export function decidirVinculo(
  cliente: ClienteDoAsaas,
  crm: IndicesDoCrm,
  emailsDoCalendly: Map<string, Set<string>>,
): DecisaoDoVinculo {
  const telefones = [cliente.celular, cliente.telefone].filter((t): t is string => t !== null);

  const exatos = new Set<string>();
  const irmaos = new Set<string>();
  for (const t of telefones) {
    for (const id of crm.porTelefone.get(t) ?? []) exatos.add(id);
    // A irmã do LADO DE LÁ (ficha gravada sem o 9) e a do lado de cá
    // (cliente do Asaas sem o 9) são o mesmo caso, por caminhos diferentes.
    for (const id of crm.porIrma.get(t) ?? []) irmaos.add(id);
    for (const irma of variantesDoNonoDigito(t).slice(1)) {
      for (const id of crm.porTelefone.get(irma) ?? []) irmaos.add(id);
    }
  }
  for (const id of exatos) irmaos.delete(id);
  if (exatos.size === 1) return { motivo: "telefone_igual", contactId: [...exatos][0] };
  if (exatos.size > 1) return { motivo: "ambiguo", contactId: null };
  if (irmaos.size === 1) return { motivo: "nono_digito", contactId: [...irmaos][0] };
  if (irmaos.size > 1) return { motivo: "ambiguo", contactId: null };

  if (cliente.email) {
    const daFicha = crm.porEmail.get(cliente.email);
    if (daFicha?.size === 1) return { motivo: "email_da_ficha", contactId: [...daFicha][0] };
    if (daFicha && daFicha.size > 1) return { motivo: "ambiguo", contactId: null };
    const doCalendly = emailsDoCalendly.get(cliente.email);
    if (doCalendly?.size === 1) return { motivo: "email_do_calendly", contactId: [...doCalendly][0] };
    if (doCalendly && doCalendly.size > 1) return { motivo: "ambiguo", contactId: null };
  }

  const sufixos = new Set<string>();
  for (const t of telefones) {
    if (t.length >= 8) for (const id of crm.porSufixo.get(t.slice(-8)) ?? []) sufixos.add(id);
  }
  if (sufixos.size === 1) return { motivo: "sufixo_8", contactId: [...sufixos][0] };
  if (sufixos.size > 1) return { motivo: "ambiguo", contactId: null };

  if (cliente.nome.trim() !== "") {
    const porNome = crm.porNome.get(chaveDeTag(cliente.nome));
    if (porNome?.size === 1) return { motivo: "nome", contactId: [...porNome][0] };
    if (porNome && porNome.size > 1) return { motivo: "ambiguo", contactId: null };
  }

  return { motivo: "sem_candidato", contactId: null };
}

function contar(mapa: Record<string, number>, chave: string): void {
  mapa[chave] = (mapa[chave] ?? 0) + 1;
}

export function contarClientes(clientes: ClienteDoAsaas[]): ContagemDeClientes {
  const porTipoDePessoa: Record<string, number> = {};
  const porFormatoDeTelefone: Record<string, number> = {};
  const documentos = new Map<string, number>();
  const telefones = new Map<string, number>();
  const c: ContagemDeClientes = {
    total: clientes.length,
    apagados: 0,
    comEmail: 0,
    comCelular: 0,
    comTelefone: 0,
    semTelefoneNenhum: 0,
    comCpf: 0,
    comCnpj: 0,
    comDocumentoDeOutroTamanho: 0,
    semDocumento: 0,
    notificacoesDesligadas: 0,
    comReferenciaExterna: 0,
    documentosRepetidos: 0,
    telefonesRepetidos: 0,
    porTipoDePessoa,
    porFormatoDeTelefone,
  };
  for (const cliente of clientes) {
    if (cliente.apagado) c.apagados++;
    if (cliente.email) c.comEmail++;
    if (cliente.celular) c.comCelular++;
    if (cliente.telefone) c.comTelefone++;
    if (!cliente.celular && !cliente.telefone) c.semTelefoneNenhum++;
    if (cliente.notificacoesDesligadas) c.notificacoesDesligadas++;
    if (cliente.referenciaExterna) c.comReferenciaExterna++;
    if (!cliente.cpfCnpj) c.semDocumento++;
    else if (cliente.cpfCnpj.length === 11) c.comCpf++;
    else if (cliente.cpfCnpj.length === 14) c.comCnpj++;
    else c.comDocumentoDeOutroTamanho++;
    contar(porTipoDePessoa, cliente.tipoDePessoa ?? "sem tipo");
    contar(porFormatoDeTelefone, formatoDoTelefone(cliente.celular ?? cliente.telefone));
    if (cliente.cpfCnpj) documentos.set(cliente.cpfCnpj, (documentos.get(cliente.cpfCnpj) ?? 0) + 1);
    const t = cliente.celular ?? cliente.telefone;
    if (t) telefones.set(t, (telefones.get(t) ?? 0) + 1);
  }
  for (const n of documentos.values()) if (n > 1) c.documentosRepetidos++;
  for (const n of telefones.values()) if (n > 1) c.telefonesRepetidos++;
  return c;
}

export function contarCobrancas(
  cobrancas: CobrancaDoAsaas[],
  clientesComFicha: Set<string>,
  agora: Date,
): ContagemDeCobrancas {
  const porFaixaDeAtraso: Record<string, number> = {};
  const porForma: Record<string, number> = {};
  const clientes = new Set<string>();
  const vencimentosPorCliente = new Map<string, Set<string>>();
  const comDoisNoMesmoDia = new Set<string>();
  const c: ContagemDeCobrancas = {
    vencidas: cobrancas.length,
    vencidasApagadas: 0,
    clientesComVencida: 0,
    clientesComVencidaEFicha: 0,
    valorVencido: 0,
    jurosAcumulado: 0,
    vencimentoMaisAntigo: null,
    porFaixaDeAtraso,
    boletoJaNaoPagavel: 0,
    comParcelamento: 0,
    deAssinatura: 0,
    clientesComDoisVencimentosNoMesmoDia: 0,
    porForma,
  };
  for (const cob of cobrancas) {
    if (cob.apagado) c.vencidasApagadas++;
    c.valorVencido += cob.valor;
    c.jurosAcumulado += cob.jurosEMulta ?? 0;
    if (cob.podePagarAposVencimento === false) c.boletoJaNaoPagavel++;
    if (cob.parcelamentoId) c.comParcelamento++;
    if (cob.assinaturaId) c.deAssinatura++;
    contar(porForma, cob.forma ?? "sem forma");
    if (cob.clienteId) clientes.add(cob.clienteId);
    if (cob.vencimento) {
      const dias = diasDeAtraso(cob.vencimento, agora);
      if (dias !== null) contar(porFaixaDeAtraso, faixaDeAtraso(dias));
      if (!c.vencimentoMaisAntigo || cob.vencimento < c.vencimentoMaisAntigo) c.vencimentoMaisAntigo = cob.vencimento;
      if (cob.clienteId) {
        const jaVistos = vencimentosPorCliente.get(cob.clienteId);
        if (jaVistos?.has(cob.vencimento)) comDoisNoMesmoDia.add(cob.clienteId);
        else if (jaVistos) jaVistos.add(cob.vencimento);
        else vencimentosPorCliente.set(cob.clienteId, new Set([cob.vencimento]));
      }
    }
  }
  c.clientesComVencida = clientes.size;
  c.clientesComVencidaEFicha = [...clientes].filter((id) => clientesComFicha.has(id)).length;
  c.clientesComDoisVencimentosNoMesmoDia = comDoisNoMesmoDia.size;
  c.valorVencido = Math.round(c.valorVencido * 100) / 100;
  c.jurosAcumulado = Math.round(c.jurosAcumulado * 100) / 100;
  return c;
}

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

/** As fichas do CRM, paginadas — o PostgREST corta em 1000 sem avisar. */
async function lerContatos(admin: SupabaseClient, accountId: string): Promise<ContatoDoCrm[]> {
  const todos: ContatoDoCrm[] = [];
  for (let pagina = 0; ; pagina++) {
    const { data, error } = await admin
      .from("contacts")
      .select("id, name, phone, email")
      .eq("account_id", accountId)
      .order("id")
      .range(pagina * PAGINA_DO_BANCO, (pagina + 1) * PAGINA_DO_BANCO - 1);
    if (error) throw new Error(`contatos: ${error.message}`);
    const linhas = (data ?? []) as { id: string; name: string | null; phone: string | null; email: string | null }[];
    todos.push(...linhas.map((l) => ({ id: l.id, nome: l.name, telefone: l.phone, email: l.email })));
    if (linhas.length < PAGINA_DO_BANCO) return todos;
  }
}

/**
 * A PONTE DO CALENDLY: e-mail → contato, vindo dos agendamentos que já
 * resolveram o contato pelo telefone. É o que faz o vínculo por e-mail
 * existir nesta conta — só 1 das 588 fichas tem e-mail (§2.1), e é a mesma
 * ponte que salvou o vínculo do tl;dv.
 */
async function lerEmailsDoCalendly(admin: SupabaseClient, accountId: string): Promise<Map<string, Set<string>>> {
  const mapa = new Map<string, Set<string>>();
  const { data, error } = await admin
    .from("cb_calendly_eventos")
    .select("email, contact_id")
    .eq("account_id", accountId)
    .not("email", "is", null)
    .not("contact_id", "is", null)
    .limit(PAGINA_DO_BANCO);
  if (error) return mapa;
  for (const l of (data ?? []) as { email: string | null; contact_id: string | null }[]) {
    const email = l.email?.trim().toLowerCase();
    if (email && l.contact_id) acrescentar(mapa, email, l.contact_id);
  }
  return mapa;
}

/** Uma sonda: o que o Asaas respondeu, em uma linha, sem derrubar o resto. */
async function sondar(rotulo: string, f: () => Promise<string>): Promise<[string, string]> {
  try {
    return [rotulo, await f()];
  } catch (e) {
    if (e instanceof AsaasError) return [rotulo, `${e.codigo}${e.codigoDoAsaas ? ` (${e.codigoDoAsaas})` : ""}`];
    return [rotulo, e instanceof Error ? e.message : String(e)];
  }
}

export async function levantar(
  admin: SupabaseClient,
  accountId: string,
  cliente: ClienteAsaas,
  agora: Date = new Date(),
): Promise<RelatorioDoLevantamento> {
  const avisos: string[] = [];

  const [contatos, emailsDoCalendly] = await Promise.all([lerContatos(admin, accountId), lerEmailsDoCalendly(admin, accountId)]);
  const crm = indicesDoCrm(contatos);

  const brutosDeClientes = await cliente.listarTudo<unknown>("/customers", { limit: 100 });
  const clientes = brutosDeClientes.map(lerCliente).filter((c): c is ClienteDoAsaas => c !== null);
  if (clientes.length !== brutosDeClientes.length) {
    avisos.push(`${brutosDeClientes.length - clientes.length} cliente(s) do Asaas vieram sem \`id\` e ficaram de fora.`);
  }

  const brutasDeCobrancas = await cliente.listarTudo<unknown>("/payments", { status: "OVERDUE", limit: 100 });
  const cobrancas = brutasDeCobrancas.map(lerCobranca).filter((c): c is CobrancaDoAsaas => c !== null);

  // Vínculo simulado
  const contagemDoVinculo: ContagemDoVinculo = {
    telefone_igual: 0,
    nono_digito: 0,
    sufixo_8: 0,
    email_da_ficha: 0,
    email_do_calendly: 0,
    nome: 0,
    ambiguo: 0,
    sem_candidato: 0,
    contatosNoCrm: crm.total,
    contatosComEmail: crm.comEmail,
    emailsDoCalendly: emailsDoCalendly.size,
    contatosDisputados: 0,
  };
  const exemplos: ExemploDeVinculo[] = [];
  const porExemplo = new Map<MotivoDoVinculo, number>();
  const alcancados = new Map<string, number>();
  const clientesComFicha = new Set<string>();
  const nomeDoContato = new Map(contatos.map((c) => [c.id, `${primeiroNome(c.nome)} ${fimDoTelefone(c.telefone)}`]));

  for (const c of clientes) {
    if (c.apagado) continue;
    const { motivo, contactId } = decidirVinculo(c, crm, emailsDoCalendly);
    contagemDoVinculo[motivo]++;
    if (contactId) {
      clientesComFicha.add(c.id);
      alcancados.set(contactId, (alcancados.get(contactId) ?? 0) + 1);
    }
    const jaTem = porExemplo.get(motivo) ?? 0;
    if (jaTem < EXEMPLOS_POR_MOTIVO) {
      porExemplo.set(motivo, jaTem + 1);
      exemplos.push({
        cliente: `${primeiroNome(c.nome)} ${fimDoTelefone(c.celular ?? c.telefone)}`,
        motivo,
        contato: contactId ? (nomeDoContato.get(contactId) ?? null) : null,
      });
    }
  }
  for (const n of alcancados.values()) if (n > 1) contagemDoVinculo.contatosDisputados++;

  // Sondas — cada uma responde uma pergunta que a doc não responde (§2.3).
  const totalDeVencidas = cobrancas.length;
  const idsComVencida = new Set(cobrancas.map((cob) => cob.clienteId).filter((id): id is string => id !== null));
  const clientesComVencida = clientes.filter((c) => idsComVencida.has(c.id));
  const sondas = Object.fromEntries(
    await Promise.all([
      sondar("C12 · listar DUNNING_REQUESTED (negativadas)", async () => {
        const p = await cliente.listar<unknown>("/payments", { status: "DUNNING_REQUESTED", limit: 1 });
        return `200 · ${p.totalCount ?? p.data.length} cobrança(s) — a permissão Cobranças basta`;
      }),
      sondar("C3 · status com mais de um valor", async () => {
        const p = await cliente.listar<unknown>("/payments", { status: "OVERDUE,PENDING", limit: 1 });
        return `200 · totalCount ${p.totalCount ?? "?"} (vencidas sozinhas: ${totalDeVencidas}) — ${
          (p.totalCount ?? 0) > totalDeVencidas ? "aceita vários" : "parece ignorar o segundo"
        }`;
      }),
      sondar("C2 · a listagem traz apagados", async () => {
        const apagados = clientes.filter((c) => c.apagado).length;
        return apagados > 0
          ? `sim — ${apagados} cliente(s) com deleted: true vieram na listagem`
          : "nenhum cliente apagado veio na listagem (ou não há nenhum na conta)";
      }),
      sondar("webhooks já cadastrados (o teto é 10)", async () => {
        const p = await cliente.listar<{ url?: string; enabled?: boolean; interrupted?: boolean; events?: unknown[] }>("/webhooks", {
          limit: 100,
        });
        if (p.data.length === 0) return "nenhum";
        return p.data
          .map((w) => {
            let host = "?";
            try {
              host = new URL(String(w.url)).host;
            } catch {
              /* url estranha: só o host importa aqui */
            }
            return `${host} (${w.enabled === false ? "desligado" : "ligado"}${w.interrupted ? ", INTERROMPIDO" : ""}, ${
              Array.isArray(w.events) ? w.events.length : 0
            } eventos)`;
          })
          .join(" · ");
      }),
      sondar("C8 · avisos nativos de uma amostra de clientes com vencida", async () => {
        const amostra = clientesComVencida.slice(0, AMOSTRA_DE_NOTIFICACOES);
        if (amostra.length === 0) return "sem cliente com cobrança vencida para amostrar";
        const linhas: string[] = [];
        for (const c of amostra) {
          const r = await cliente.obter<{ data?: { event?: string; enabled?: boolean; phoneCallEnabledForProvider?: boolean }[] }>(
            `/customers/${c.id}/notifications`,
          );
          const avisos = (r?.data ?? []).filter((n) => n.enabled !== false).map((n) => String(n.event));
          const comLigacao = (r?.data ?? []).filter((n) => n.enabled !== false && n.phoneCallEnabledForProvider === true).length;
          linhas.push(`${primeiroNome(c.nome)}: ${avisos.length} ligados (${comLigacao} com ligação de robô)`);
        }
        return linhas.join(" · ");
      }),
    ]),
  );

  if (contagemDoVinculo.sufixo_8 > 0) {
    avisos.push(
      `${contagemDoVinculo.sufixo_8} cliente(s) só casam pelos ÚLTIMOS 8 DÍGITOS — pela D5 isso vira SUGESTÃO, nunca vínculo automático.`,
    );
  }
  if (contagemDoVinculo.contatosDisputados > 0) {
    avisos.push(
      `${contagemDoVinculo.contatosDisputados} ficha(s) do CRM são alcançadas por mais de um cliente do Asaas (a pessoa e a empresa dela, ou cadastro repetido) — é o caso da D11.`,
    );
  }

  return {
    geradoEm: agora.toISOString(),
    clientes: contarClientes(clientes),
    vinculo: contagemDoVinculo,
    exemplos,
    cobrancas: contarCobrancas(cobrancas, clientesComFicha, agora),
    sondas,
    cota: cliente.cota(),
    avisos,
  };
}
