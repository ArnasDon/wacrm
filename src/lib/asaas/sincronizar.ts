import type { SupabaseClient } from "@supabase/supabase-js";

import { diaNoFuso, FUSO_PADRAO, partesNoFuso } from "@/lib/agenda/fuso";
import { decrypt } from "@/lib/whatsapp/encryption";

import { aplicarCobranca, aplicarCobrancas } from "./aplicar";
import { AsaasError, criarClienteAsaas, type AmbienteDoAsaas, type ClienteAsaas } from "./cliente";
import { criarFichaDoAsaas, etiquetarFichasCriadas, type ContextoDaFicha } from "./criar-ficha";
import { inteiro, lerCliente, lerCobranca, type ClienteDoAsaas, type CobrancaDoAsaas } from "./leitura";
import {
  decidir,
  elegivel,
  mesmosCandidatos,
  montarIndices,
  type Candidato,
  type ClienteParaVincular,
  type FichaDoCrm,
  type IndicesDoVinculo,
} from "./vinculo";

/**
 * A sincronização de UMA conta com o Asaas (§3.4 do plano). I/O. Roda com
 * o client de SERVICE ROLE (as tabelas são fechadas ao navegador). Chamada
 * pelo cron (`/api/cb/asaas/cron`, laço lento) e pelo botão "Sincronizar"
 * do cartão. Os passos, nesta ordem, conferindo o prazo entre eles:
 *
 * 1. Carimba `last_sync_attempt_at` ANTES de tudo (o rodízio do cron, 988).
 *    Chave que não decifra → `chave_ilegivel`.
 * 2. Prova de identidade: com espelho existente, relê um `cus_…` conhecido.
 *    404 = a chave é de OUTRA conta do Asaas → `conta_trocada`, e o ciclo
 *    termina SEM gravar nada (senão zeraria o aviso de todo mundo).
 * 3. Clientes, uma vez por dia (o primeiro ciclo depois das 03:00, a primeira
 *    sincronização e o "Sincronizar tudo"): listagem completa, upsert levando
 *    SÓ metadados — nunca o vínculo (a lição do tl;dv: o que já é conhecido
 *    mantém o que tem). Quem sumiu da listagem vira `deleted`.
 * 4. Cobranças vencidas, sempre completas (`OVERDUE,DUNNING_REQUESTED` — C3
 *    diz que a vírgula funciona), MAIS as `PENDING` que vencem HOJE (D17).
 *    Cliente desconhecido é lido antes (a FK exige a linha). Terminada a
 *    listagem inteira, `vencidas_listadas_em` recebe o instante em que ela
 *    COMEÇOU.
 * 5. Reconciliação: toda devida com `visto_em` anterior à listagem não
 *    voltou (pagou, foi apagada, renegociada) e é relida uma a uma, as de
 *    clientes LIGADOS primeiro, dentro do prazo. Toda `PENDING` com
 *    vencimento passado (entrou pelo lembrete) idem.
 * 6. Total de parcelas dos parcelamentos ainda sem ele, com teto por ciclo.
 * 7. Vínculo automático (§3.3) e, para quem sobrou sem ficha e COM telefone,
 *    a criação da ficha (D2) — a ÚNICA escrita fora das tabelas do Asaas,
 *    com teto por ciclo.
 * 8. Sucesso → `conectado`; falha → `erro` com o CÓDIGO. O que já foi
 *    aplicado fica. 429 encerra o ciclo (`limite`) sem retentar na hora: a
 *    cota é da CONTA do Asaas, dividida com outro sistema do escritório, e
 *    não há cabeçalho de cota para antecipá-lo (C14).
 *
 * ⚠️ Toda leitura do banco PAGINA: o PostgREST corta em 1000 sem avisar,
 * `contacts` já passa de 700 e a importação do Atlas passa disso.
 */

/** Quantas fichas o ciclo cria, no máximo — o primeiro tem ~264 pela frente. */
export const FICHAS_POR_CICLO = 150;
/** Quantos parcelamentos ganham o total por ciclo. */
export const PARCELAMENTOS_POR_CICLO = 30;
/** A partir de que hora local a listagem diária de clientes é devida. */
export const HORA_DA_LISTAGEM_DIARIA = 3;
const PRAZO_PADRAO_MS = 60_000;
const PAGINA_DO_BANCO = 1000;
const LOTE_DE_IDS = 200;

type FabricaDeCliente = (chave: string, ambiente: AmbienteDoAsaas) => ClienteAsaas;

const criarPadrao: FabricaDeCliente = (chave, ambiente) => criarClienteAsaas(chave, { ambiente });

export interface OpcoesDeSync {
  agora?: Date;
  /** Instante (epoch ms) a partir do qual nada novo é começado. */
  prazoMs?: number;
  cliente?: FabricaDeCliente;
  /** Força a listagem completa de clientes (o "Sincronizar tudo"). */
  completa?: boolean;
  fuso?: string;
  tetoDeFichas?: number;
}

export interface ContagemDoCiclo {
  clientesListados: number;
  cobrancasGravadas: number;
  reconciliadas: number;
  ligados: number;
  fichasCriadas: number;
  candidatosAtualizados: number;
  /** o que não coube no prazo ou no teto */
  adiadas: number;
}

export type ResultadoDaSync = ({ ok: true } & ContagemDoCiclo) | { ok: false; codigo: string };

type ConfigLida =
  | { ok: true; chave: string; ambiente: AmbienteDoAsaas; lastFullSyncAt: string | null; vencidasListadasEm: string | null }
  | { ok: false; codigo: string };

async function lerConfig(admin: SupabaseClient, accountId: string): Promise<ConfigLida> {
  const { data, error } = await admin
    .from("cb_asaas_config")
    .select("api_key, ambiente, last_full_sync_at, vencidas_listadas_em")
    .eq("account_id", accountId)
    .maybeSingle();
  if (error) return { ok: false, codigo: "db_error" };
  if (!data) return { ok: false, codigo: "nao_conectado" };
  try {
    return {
      ok: true,
      chave: decrypt(data.api_key as string),
      ambiente: ((data.ambiente as string | null) ?? "producao") as AmbienteDoAsaas,
      lastFullSyncAt: (data.last_full_sync_at as string | null) ?? null,
      vencidasListadasEm: (data.vencidas_listadas_em as string | null) ?? null,
    };
  } catch {
    await marcarErro(admin, accountId, "chave_ilegivel");
    return { ok: false, codigo: "chave_ilegivel" };
  }
}

async function marcarErro(admin: SupabaseClient, accountId: string, codigo: string): Promise<void> {
  await admin.from("cb_asaas_config").update({ status: "erro", last_error: codigo, updated_at: new Date().toISOString() }).eq("account_id", accountId);
}

/** Uma listagem paginada do banco, até fechar — o PostgREST corta em 1000 sem avisar. */
async function lerTudo<T>(consulta: (de: number, ate: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>, rotulo: string): Promise<T[]> {
  const tudo: T[] = [];
  for (let pagina = 0; pagina < 50; pagina++) {
    const { data, error } = await consulta(pagina * PAGINA_DO_BANCO, (pagina + 1) * PAGINA_DO_BANCO - 1);
    if (error) throw new Error(`${rotulo}: ${error.message}`);
    const linhas = (data ?? []) as T[];
    tudo.push(...linhas);
    if (linhas.length < PAGINA_DO_BANCO) return tudo;
  }
  throw new Error(`${rotulo}: mais de 50 páginas`);
}

/** Puro: a listagem diária de clientes é devida? (virou o dia e já passou das 03:00) */
export function listagemDiariaDevida(lastFullSyncAt: string | null, agora: Date, fuso: string): boolean {
  if (!lastFullSyncAt) return true;
  const ultimo = new Date(lastFullSyncAt);
  if (Number.isNaN(ultimo.getTime())) return true;
  return diaNoFuso(ultimo, fuso) < diaNoFuso(agora, fuso) && partesNoFuso(agora, fuso).hora >= HORA_DA_LISTAGEM_DIARIA;
}

interface LinhaDeCliente extends ClienteParaVincular {
  id: string;
}

const COLUNAS_DO_CLIENTE = "id, asaas_customer_id, nome, cpf_cnpj, email, celular, telefone, contact_id, vinculo_origem, contatos_recusados, candidatos, deleted";

async function lerClientesDoEspelho(admin: SupabaseClient, accountId: string): Promise<LinhaDeCliente[]> {
  const linhas = await lerTudo<Record<string, unknown>>(
    (de, ate) => admin.from("cb_asaas_clientes").select(COLUNAS_DO_CLIENTE).eq("account_id", accountId).order("id").range(de, ate),
    "clientes do espelho",
  );
  return linhas.map((l) => ({
    id: l.id as string,
    asaas_customer_id: l.asaas_customer_id as string,
    nome: (l.nome as string | null) ?? "",
    cpf_cnpj: (l.cpf_cnpj as string | null) ?? null,
    email: (l.email as string | null) ?? null,
    celular: (l.celular as string | null) ?? null,
    telefone: (l.telefone as string | null) ?? null,
    contact_id: (l.contact_id as string | null) ?? null,
    vinculo_origem: (l.vinculo_origem as string | null) ?? null,
    contatos_recusados: Array.isArray(l.contatos_recusados) ? (l.contatos_recusados as string[]) : [],
    candidatos: Array.isArray(l.candidatos) ? (l.candidatos as Candidato[]) : [],
    deleted: l.deleted === true,
  }));
}

function linhaDoCliente(accountId: string, c: ClienteDoAsaas, vistoEm: string): Record<string, unknown> {
  return {
    account_id: accountId,
    asaas_customer_id: c.id,
    nome: c.nome.slice(0, 200),
    cpf_cnpj: c.cpfCnpj,
    email: c.email,
    celular: c.celular,
    telefone: c.telefone,
    notificacoes_desligadas: c.notificacoesDesligadas,
    deleted: c.apagado,
    visto_em: vistoEm,
    updated_at: vistoEm,
  };
}

/** Upsert de METADADOS dos clientes — nunca o vínculo. */
async function gravarClientes(admin: SupabaseClient, accountId: string, clientes: readonly ClienteDoAsaas[], vistoEm: string): Promise<void> {
  for (let i = 0; i < clientes.length; i += 100) {
    const lote = clientes.slice(i, i + 100).map((c) => linhaDoCliente(accountId, c, vistoEm));
    const { error } = await admin.from("cb_asaas_clientes").upsert(lote, { onConflict: "account_id,asaas_customer_id" });
    if (error) throw new Error(`clientes: ${error.message}`);
  }
}

/** A listagem completa de clientes: grava todos e marca `deleted` quem não voltou. */
async function listarClientes(admin: SupabaseClient, accountId: string, cliente: ClienteAsaas, vistoEm: string): Promise<number> {
  const brutos = await cliente.listarTudo<unknown>("/customers", { limit: 100 });
  const clientes = brutos.map(lerCliente).filter((c): c is ClienteDoAsaas => c !== null);
  await gravarClientes(admin, accountId, clientes, vistoEm);
  // Quem não voltou na listagem completa (C2: o Asaas não lista os apagados).
  const { error } = await admin
    .from("cb_asaas_clientes")
    .update({ deleted: true, updated_at: vistoEm })
    .eq("account_id", accountId)
    .eq("deleted", false)
    .lt("visto_em", vistoEm);
  if (error) throw new Error(`clientes apagados: ${error.message}`);
  const { error: erroConfig } = await admin.from("cb_asaas_config").update({ last_full_sync_at: vistoEm }).eq("account_id", accountId);
  if (erroConfig) throw new Error(`last_full_sync_at: ${erroConfig.message}`);
  return clientes.length;
}

/**
 * Garante a linha do cliente de cada cobrança (a FK exige). Devolve os ids
 * de cliente que o Asaas NÃO devolveu (404): as cobranças deles ficam de fora.
 */
async function garantirClientes(
  admin: SupabaseClient,
  accountId: string,
  cliente: ClienteAsaas,
  idsDeCliente: Iterable<string>,
  vistoEm: string,
  prazoMs: number,
): Promise<Set<string>> {
  const ids = [...new Set(idsDeCliente)];
  const conhecidos = new Set<string>();
  for (let i = 0; i < ids.length; i += LOTE_DE_IDS) {
    const { data, error } = await admin
      .from("cb_asaas_clientes")
      .select("asaas_customer_id")
      .eq("account_id", accountId)
      .in("asaas_customer_id", ids.slice(i, i + LOTE_DE_IDS));
    if (error) throw new Error(`clientes conhecidos: ${error.message}`);
    for (const l of (data ?? []) as { asaas_customer_id: string }[]) conhecidos.add(l.asaas_customer_id);
  }
  const semLinha = new Set<string>();
  const novos: ClienteDoAsaas[] = [];
  for (const id of ids) {
    if (conhecidos.has(id)) continue;
    if (Date.now() > prazoMs) {
      semLinha.add(id);
      continue;
    }
    const lido = lerCliente(await cliente.obter<unknown>(`/customers/${id}`));
    if (lido) novos.push(lido);
    else semLinha.add(id);
  }
  if (novos.length > 0) await gravarClientes(admin, accountId, novos, vistoEm);
  return semLinha;
}

interface CobrancaARevisar {
  asaas_payment_id: string;
  asaas_customer_id: string;
}

/**
 * Relê no Asaas cada devida que não voltou na listagem e cada PENDING
 * vencida. 404 na cobrança: só vira "apagada" se o CLIENTE dela ainda
 * responder — os dois 404 juntos são a chave de outra conta.
 */
async function reconciliar(
  admin: SupabaseClient,
  accountId: string,
  cliente: ClienteAsaas,
  hoje: string,
  vistoEm: string,
  clientesLigados: ReadonlySet<string>,
  prazoMs: number,
): Promise<{ relidas: number; adiadas: number }> {
  const pendentes = await lerTudo<CobrancaARevisar>(
    (de, ate) =>
      admin
        .from("cb_asaas_cobrancas")
        .select("asaas_payment_id, asaas_customer_id")
        .eq("account_id", accountId)
        .eq("deleted", false)
        .or(`and(status.in.(OVERDUE,DUNNING_REQUESTED),visto_em.lt.${vistoEm}),and(status.eq.PENDING,vencimento.lt.${hoje})`)
        .order("id")
        .range(de, ate),
    "cobranças a reconciliar",
  );
  // As de clientes LIGADOS primeiro: são as que estão numa conversa.
  pendentes.sort((a, b) => Number(clientesLigados.has(b.asaas_customer_id)) - Number(clientesLigados.has(a.asaas_customer_id)));
  let relidas = 0;
  let adiadas = 0;
  for (const p of pendentes) {
    if (Date.now() > prazoMs) {
      adiadas++;
      continue;
    }
    const bruta = await cliente.obter<unknown>(`/payments/${p.asaas_payment_id}`);
    const lida = bruta ? lerCobranca(bruta) : null;
    if (lida) {
      await aplicarCobranca(admin, accountId, lida, vistoEm);
      relidas++;
      continue;
    }
    const dono = await cliente.obter<unknown>(`/customers/${p.asaas_customer_id}`);
    if (dono === null) throw new SyncError("conta_trocada");
    const { error } = await admin
      .from("cb_asaas_cobrancas")
      .update({ deleted: true, visto_em: vistoEm, updated_at: vistoEm })
      .eq("account_id", accountId)
      .eq("asaas_payment_id", p.asaas_payment_id);
    if (error) throw new Error(`cobrança apagada: ${error.message}`);
    relidas++;
  }
  return { relidas, adiadas };
}

/** O total de parcelas dos parcelamentos que ainda não o têm. Falhar aqui não derruba o ciclo. */
async function completarParcelamentos(admin: SupabaseClient, accountId: string, cliente: ClienteAsaas, prazoMs: number): Promise<void> {
  const { data, error } = await admin
    .from("cb_asaas_cobrancas")
    .select("parcelamento_id")
    .eq("account_id", accountId)
    .is("parcela_total", null)
    .not("parcelamento_id", "is", null)
    .limit(PAGINA_DO_BANCO);
  if (error || !data) return;
  const ids = [...new Set((data as { parcelamento_id: string }[]).map((l) => l.parcelamento_id))].slice(0, PARCELAMENTOS_POR_CICLO);
  for (const id of ids) {
    if (Date.now() > prazoMs) return;
    try {
      const bruto = await cliente.obter<{ installmentCount?: unknown }>(`/installments/${id}`);
      const total = inteiro(bruto?.installmentCount);
      if (total === null) continue;
      await admin.from("cb_asaas_cobrancas").update({ parcela_total: total }).eq("account_id", accountId).eq("parcelamento_id", id);
    } catch (e) {
      // Cota e chave param o ciclo; o resto (um parcelamento estranho) não.
      if (e instanceof AsaasError && (e.codigo === "limite" || e.codigo === "chave_invalida" || e.codigo === "rede")) throw e;
    }
  }
}

async function lerFichas(admin: SupabaseClient, accountId: string): Promise<FichaDoCrm[]> {
  const linhas = await lerTudo<{ id: string; name: string | null; phone_normalized: string | null; email: string | null }>(
    (de, ate) => admin.from("contacts").select("id, name, phone_normalized, email").eq("account_id", accountId).order("id").range(de, ate),
    "contatos",
  );
  return linhas.map((l) => ({ id: l.id, nome: l.name, telefone: l.phone_normalized || null, email: l.email }));
}

/** A PONTE DO CALENDLY: e-mail → contato, dos agendamentos que já resolveram o contato. */
async function lerEmailsDoCalendly(admin: SupabaseClient, accountId: string): Promise<Map<string, Set<string>>> {
  const mapa = new Map<string, Set<string>>();
  const linhas = await lerTudo<{ email: string | null; contact_id: string | null }>(
    (de, ate) =>
      admin
        .from("cb_calendly_eventos")
        .select("email, contact_id")
        .eq("account_id", accountId)
        .not("email", "is", null)
        .not("contact_id", "is", null)
        .order("id")
        .range(de, ate),
    "agendamentos",
  );
  for (const l of linhas) {
    const email = l.email?.trim().toLowerCase();
    if (!email || !l.contact_id) continue;
    const atual = mapa.get(email);
    if (atual) atual.add(l.contact_id);
    else mapa.set(email, new Set([l.contact_id]));
  }
  return mapa;
}

async function lerTelefonesDasConexoes(admin: SupabaseClient, accountId: string): Promise<string[]> {
  const { data, error } = await admin.from("cb_channels").select("display_phone").eq("account_id", accountId);
  if (error) throw new Error(`conexões: ${error.message}`);
  return ((data ?? []) as { display_phone: string | null }[]).map((c) => c.display_phone ?? "").filter((t) => t !== "");
}

/**
 * O cliente AINDA está elegível para a regra? Relido no banco, no instante
 * — a lista do ciclo é uma foto, e entre ela e a criação da ficha cabe um
 * "Ligar" ou "Ignorar" do administrador (achado do Codex no PR #201).
 */
async function aindaElegivel(admin: SupabaseClient, accountId: string, linhaId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("cb_asaas_clientes")
    .select("id")
    .eq("id", linhaId)
    .eq("account_id", accountId)
    .is("contact_id", null)
    .or("vinculo_origem.is.null,vinculo_origem.in.(telefone,cpf,email,criada)")
    .limit(1);
  if (error) return false;
  return (data?.length ?? 0) > 0;
}

/** O UPDATE do vínculo automático, cercado pela elegibilidade: gente que ligou no meio vence. */
async function gravarVinculo(
  admin: SupabaseClient,
  accountId: string,
  linhaId: string,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const { data, error } = await admin
    .from("cb_asaas_clientes")
    .update(patch)
    .eq("id", linhaId)
    .eq("account_id", accountId)
    .is("contact_id", null)
    .or("vinculo_origem.is.null,vinculo_origem.in.(telefone,cpf,email,criada)")
    .select("id");
  if (error) throw new Error(`vínculo: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/** O passo 7: decide cliente a cliente, grava o vínculo, os candidatos e cria as fichas. */
async function vincular(
  admin: SupabaseClient,
  accountId: string,
  clientes: readonly LinhaDeCliente[],
  vistoEm: string,
  prazoMs: number,
  tetoDeFichas: number,
): Promise<Pick<ContagemDoCiclo, "ligados" | "fichasCriadas" | "candidatosAtualizados" | "adiadas">> {
  const contagem = { ligados: 0, fichasCriadas: 0, candidatosAtualizados: 0, adiadas: 0 };
  const elegiveis = clientes.filter((c) => elegivel(c));
  if (elegiveis.length === 0) return contagem;

  const [fichas, calendly, conexoes] = await Promise.all([lerFichas(admin, accountId), lerEmailsDoCalendly(admin, accountId), lerTelefonesDasConexoes(admin, accountId)]);
  const idx: IndicesDoVinculo = montarIndices(fichas, calendly, conexoes, clientes.filter((c) => c.contact_id !== null));
  // O dono da conta e a etiqueta são resolvidos UMA vez por ciclo.
  const contextoDaFicha: ContextoDaFicha = {};
  const semEtiqueta: string[] = [];

  const registrarLigado = (c: LinhaDeCliente, contactId: string) => {
    if (c.cpf_cnpj && !idx.contatoPorDocumento.has(c.cpf_cnpj)) idx.contatoPorDocumento.set(c.cpf_cnpj, contactId);
    if (!idx.clientePorContato.has(contactId)) idx.clientePorContato.set(contactId, { customerId: c.asaas_customer_id, nome: c.nome, cpfCnpj: c.cpf_cnpj });
  };
  const gravarCandidatos = async (c: LinhaDeCliente, candidatos: Candidato[]) => {
    if (mesmosCandidatos(c.candidatos, candidatos)) return;
    if (await gravarVinculo(admin, accountId, c.id, { candidatos, updated_at: vistoEm })) contagem.candidatosAtualizados++;
  };

  for (const c of elegiveis) {
    const decisao = decidir(c, idx);
    if (decisao.acao === "nada") continue;
    if (decisao.acao === "ligar") {
      const gravou = await gravarVinculo(admin, accountId, c.id, {
        contact_id: decisao.contactId,
        vinculo_origem: decisao.origem,
        vinculado_por: null,
        vinculado_por_nome: null,
        vinculado_em: vistoEm,
        candidatos: [],
        updated_at: vistoEm,
      });
      if (gravou) {
        contagem.ligados++;
        registrarLigado(c, decisao.contactId);
      }
      continue;
    }
    if (decisao.acao === "confirmar" || decisao.acao === "sem_ficha") {
      await gravarCandidatos(c, decisao.candidatos);
      continue;
    }
    // criar (D2)
    if (contagem.fichasCriadas >= tetoDeFichas || Date.now() > prazoMs) {
      contagem.adiadas++;
      continue;
    }
    // A criação é irreversível e a foto do ciclo pode estar velha: reconfere.
    if (!(await aindaElegivel(admin, accountId, c.id))) continue;
    const ficha = await criarFichaDoAsaas(admin, accountId, { nome: c.nome, telefone: decisao.telefone }, contextoDaFicha);
    if (!ficha.ok) {
      if (ficha.codigo === "sufixo") await gravarCandidatos(c, [{ contact_id: ficha.candidatoId, motivo: "sufixo" }]);
      else console.warn(`[asaas] ficha do cliente ${c.asaas_customer_id} não criada: ${ficha.codigo}`);
      continue;
    }
    // ⚠️ A ficha "encontrada" pode ser justamente a que gente DESLIGOU deste
    // cliente: o número é o mesmo (a ficha guarda o telefone do Asaas) e o
    // índice único de `contacts` impede uma segunda ficha com ele. Religar
    // desfaria a decisão; criar é impossível. Fica em "Sem ficha".
    if (!ficha.criou && c.contatos_recusados.includes(ficha.contactId)) {
      await gravarCandidatos(c, []);
      continue;
    }
    const gravou = await gravarVinculo(admin, accountId, c.id, {
      contact_id: ficha.contactId,
      vinculo_origem: ficha.criou ? "criada" : "telefone",
      vinculado_por: null,
      vinculado_por_nome: null,
      vinculado_em: vistoEm,
      candidatos: [],
      updated_at: vistoEm,
    });
    if (gravou) {
      if (ficha.criou) {
        contagem.fichasCriadas++;
        if (!ficha.etiquetada) semEtiqueta.push(ficha.contactId);
      } else contagem.ligados++;
      registrarLigado(c, ficha.contactId);
      // A ficha nova entra nos índices: o próximo cliente com o mesmo número
      // (a empresa dele) cai em "contato já ligado", não em outra ficha.
      idx.fichas.set(ficha.contactId, { id: ficha.contactId, nome: c.nome, telefone: decisao.telefone, email: null });
      const atual = idx.porTelefone.get(decisao.telefone);
      if (atual) atual.add(ficha.contactId);
      else idx.porTelefone.set(decisao.telefone, new Set([ficha.contactId]));
    } else if (ficha.criou) {
      // Perdeu a corrida para gente entre a reconferência e o vínculo: a
      // ficha que ACABOU de nascer aqui não tem conversa, mensagem nem
      // negócio — apagá-la é desfazer o próprio passo, não apagar contato.
      const { error } = await admin.from("contacts").delete().eq("id", ficha.contactId).eq("account_id", accountId);
      if (error) console.warn(`[asaas] ficha órfã ${ficha.contactId} não pôde ser desfeita: ${error.message}`);
    }
  }
  // A etiqueta que falhou num ciclo anterior (o upsert devolveu erro) é
  // refeita aqui: as fichas criadas pelo CRM que ainda não a têm.
  const criadas = clientes.filter((c) => c.vinculo_origem === "criada" && c.contact_id !== null).map((c) => c.contact_id as string);
  await etiquetarFichasCriadas(admin, accountId, [...new Set([...criadas, ...semEtiqueta])], contextoDaFicha);
  return contagem;
}

/** Erro do CICLO que não é do Asaas nem do banco: a chave é de outra conta. */
export class SyncError extends Error {
  constructor(public readonly codigo: "conta_trocada") {
    super(codigo);
    this.name = "SyncError";
  }
}

/** Com espelho existente, a chave tem de enxergar um cliente conhecido. */
async function provarIdentidade(cliente: ClienteAsaas, conhecidos: readonly LinhaDeCliente[]): Promise<void> {
  const sondas = conhecidos.filter((c) => !c.deleted).slice(0, 2);
  if (sondas.length === 0) return;
  for (const s of sondas) {
    if ((await cliente.obter<unknown>(`/customers/${s.asaas_customer_id}`)) !== null) return;
  }
  throw new SyncError("conta_trocada");
}

export async function sincronizarAsaas(admin: SupabaseClient, accountId: string, opcoes: OpcoesDeSync = {}): Promise<ResultadoDaSync> {
  const agora = opcoes.agora ?? new Date();
  // ⚠️ O prazo é medido pelo relógio REAL (`Date.now()`), não por `agora`:
  // `agora` é o carimbo das escritas e pode ser injetado; o prazo é "quanto
  // tempo esta chamada ainda pode gastar".
  const prazoMs = opcoes.prazoMs ?? Date.now() + PRAZO_PADRAO_MS;
  const fuso = opcoes.fuso ?? FUSO_PADRAO;
  const tetoDeFichas = opcoes.tetoDeFichas ?? FICHAS_POR_CICLO;
  const vistoEm = agora.toISOString();

  const config = await lerConfig(admin, accountId);
  if (!config.ok) return { ok: false, codigo: config.codigo };
  // ⚠️ A TENTATIVA é carimbada ANTES de qualquer trabalho, dê certo ou errado:
  // é por esta coluna que o cron ordena as contas (o rodízio da 988).
  await admin.from("cb_asaas_config").update({ last_sync_attempt_at: vistoEm }).eq("account_id", accountId);
  const cliente = (opcoes.cliente ?? criarPadrao)(config.chave, config.ambiente);

  const contagem: ContagemDoCiclo = { clientesListados: 0, cobrancasGravadas: 0, reconciliadas: 0, ligados: 0, fichasCriadas: 0, candidatosAtualizados: 0, adiadas: 0 };
  try {
    // 2) a chave ainda é desta conta do Asaas?
    let clientes = await lerClientesDoEspelho(admin, accountId);
    await provarIdentidade(cliente, clientes);

    // 3) clientes, uma vez por dia
    if (opcoes.completa || listagemDiariaDevida(config.lastFullSyncAt, agora, fuso)) {
      contagem.clientesListados = await listarClientes(admin, accountId, cliente, vistoEm);
      clientes = await lerClientesDoEspelho(admin, accountId);
    }

    // 4) vencidas, sempre completas — e o que vence hoje (D17)
    const hoje = diaNoFuso(agora, fuso);
    const brutas = [
      ...(await cliente.listarTudo<unknown>("/payments", { status: "OVERDUE,DUNNING_REQUESTED", limit: 100 })),
      ...(await cliente.listarTudo<unknown>("/payments", { status: "PENDING", "dueDate[ge]": hoje, "dueDate[le]": hoje, limit: 100 })),
    ];
    const cobrancas = brutas.map(lerCobranca).filter((c): c is CobrancaDoAsaas => c !== null && c.clienteId !== null);
    const semLinha = await garantirClientes(
      admin,
      accountId,
      cliente,
      cobrancas.map((c) => c.clienteId as string),
      vistoEm,
      prazoMs,
    );
    const aplicaveis = cobrancas.filter((c) => !semLinha.has(c.clienteId as string));
    const aplicadas = await aplicarCobrancas(admin, accountId, aplicaveis, vistoEm);
    contagem.cobrancasGravadas = aplicadas.gravadas;
    if (semLinha.size > 0) {
      // Cliente que o Asaas não devolveu: a listagem fica incompleta para ele,
      // e o carimbo abaixo mandaria as cobranças dele para "em conferência".
      console.warn(`[asaas] ${semLinha.size} cliente(s) de cobrança vencida sem linha no Asaas (conta ${accountId})`);
    }
    const { error: erroListagem } = await admin.from("cb_asaas_config").update({ vencidas_listadas_em: vistoEm }).eq("account_id", accountId);
    if (erroListagem) throw new Error(`vencidas_listadas_em: ${erroListagem.message}`);

    // 5) reconciliação
    const ligados = new Set(clientes.filter((c) => c.contact_id !== null).map((c) => c.asaas_customer_id));
    const rec = await reconciliar(admin, accountId, cliente, hoje, vistoEm, ligados, prazoMs);
    contagem.reconciliadas = rec.relidas;
    contagem.adiadas += rec.adiadas;

    // 6) totais dos parcelamentos
    await completarParcelamentos(admin, accountId, cliente, prazoMs);

    // 7) vínculo e criação da ficha
    if (contagem.clientesListados === 0) clientes = await lerClientesDoEspelho(admin, accountId);
    const v = await vincular(admin, accountId, clientes, vistoEm, prazoMs, tetoDeFichas);
    contagem.ligados = v.ligados;
    contagem.fichasCriadas = v.fichasCriadas;
    contagem.candidatosAtualizados = v.candidatosAtualizados;
    contagem.adiadas += v.adiadas;

    // 8) sucesso
    const { error: erroFim } = await admin
      .from("cb_asaas_config")
      .update({ status: "conectado", last_sync_at: vistoEm, last_error: null, updated_at: vistoEm })
      .eq("account_id", accountId);
    if (erroFim) throw new Error(`fim do ciclo: ${erroFim.message}`);
    return { ok: true, ...contagem };
  } catch (e) {
    const codigo = e instanceof AsaasError ? e.codigo : e instanceof SyncError ? e.codigo : "db_error";
    console.error(`[asaas] sincronização da conta ${accountId} falhou (${codigo}):`, e instanceof Error ? e.message : e);
    await marcarErro(admin, accountId, codigo);
    return { ok: false, codigo };
  }
}
