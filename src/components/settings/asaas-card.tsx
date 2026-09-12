"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Copy, Receipt, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AVISAR_EXPIRACAO_EM_DIAS, codigoConhecido, type CartaoDoAsaas } from "@/lib/asaas/cartao";
import type { MotivoDoVinculo, RelatorioDoLevantamento } from "@/lib/asaas/levantamento";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";

import { SettingsChip } from "./settings-chip";

/**
 * O cartão "Asaas" da aba Integrações (991). Faz DUAS coisas, e só elas:
 * guarda a chave da API (testada e cifrada pela rota) e roda o LEVANTAMENTO
 * da conta, que é só leitura e não grava nada.
 *
 * ⚠️ O espelho das cobranças, o aviso na conversa e a régua de cobrança
 * NÃO estão aqui de propósito: a forma das tabelas depende dos números do
 * levantamento (docs/PLANO-integracao-asaas.md, D2/D5/D10), e migration
 * aplicada não se reescreve.
 *
 * Só admin chega aqui (a aba inteira é admin). Nenhuma chave volta da rota;
 * o campo nasce vazio sempre.
 */

const MOTIVOS: MotivoDoVinculo[] = [
  "telefone_igual",
  "nono_digito",
  "email_da_ficha",
  "email_do_calendly",
  "sufixo_8",
  "nome",
  "ambiguo",
  "sem_candidato",
];

/** "13 dígitos, com 55: 420 · 12 dígitos, com 55: 168" — maiores primeiro. */
function listar(mapa: Record<string, number>): string {
  const linhas = Object.entries(mapa).sort((a, b) => b[1] - a[1]);
  return linhas.length > 0 ? linhas.map(([chave, n]) => `${chave}: ${n}`).join(" · ") : "—";
}

/** O mesmo, para mapa de TEXTO (os cabeçalhos de cota vêm como string). */
function listarTexto(mapa: Record<string, string>): string {
  const linhas = Object.entries(mapa);
  return linhas.length > 0 ? linhas.map(([chave, valor]) => `${chave}: ${valor}`).join(" · ") : "—";
}

export function AsaasCard() {
  const t = useTranslations("Settings.integracoes");
  const [cartao, setCartao] = useState<CartaoDoAsaas | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [chave, setChave] = useState("");
  const [nome, setNome] = useState("");
  const [validade, setValidade] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [desconectando, setDesconectando] = useState(false);
  const [levantando, setLevantando] = useState(false);
  const [relatorio, setRelatorio] = useState<RelatorioDoLevantamento | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const vivoRef = useRef(true);
  const tinhaDadosRef = useRef(false);

  const motivo = (codigo: string) =>
    // chave montada: `asaas.motivo.<codigo>` — a lista fechada mora em
    // `lib/asaas/cartao.ts` e há teste cobrando cada uma nos dois dicionários.
    codigoConhecido(codigo)
      ? t(`asaas.motivo.${codigo}` as Parameters<typeof t>[0])
      : t("asaas.motivo.asaas_error");

  const carregar = useCallback(async () => {
    try {
      const res = await fetch("/api/cb/asaas");
      if (!res.ok) throw new Error(String(res.status));
      const corpo = (await res.json()) as { cartao: CartaoDoAsaas };
      if (vivoRef.current) {
        setCartao(corpo.cartao);
        setFalhou(false);
        tinhaDadosRef.current = true;
      }
    } catch {
      if (!vivoRef.current) return;
      setFalhou(true);
      if (tinhaDadosRef.current) toast.error(t("recarregarFalhou"));
    }
  }, [t]);

  useEffect(() => {
    vivoRef.current = true;
    void carregar();
    return () => {
      vivoRef.current = false;
    };
  }, [carregar]);

  const conectar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      const res = await fetch("/api/cb/asaas/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: chave, chave_nome: nome, chave_expira_em: validade || null }),
      });
      const corpo = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setErro(motivo(corpo.error ?? "asaas_error"));
        return;
      }
      setChave("");
      toast.success(t("asaas.conectado"));
      await carregar();
    } finally {
      if (vivoRef.current) setSalvando(false);
    }
  };

  const desconectar = async () => {
    if (desconectando) return;
    if (!window.confirm(t("asaas.confirmarDesconectar"))) return;
    setDesconectando(true);
    try {
      const res = await fetch("/api/cb/asaas/config", { method: "DELETE" });
      if (!res.ok) {
        toast.error(t("salvarFalhou"));
        return;
      }
      setRelatorio(null);
      await carregar();
    } finally {
      if (vivoRef.current) setDesconectando(false);
    }
  };

  const levantar = async () => {
    setLevantando(true);
    setErro(null);
    try {
      const res = await fetch("/api/cb/asaas/levantamento", { method: "POST" });
      const corpo = (await res.json().catch(() => ({}))) as { relatorio?: RelatorioDoLevantamento; error?: string };
      if (!res.ok || !corpo.relatorio) {
        setErro(motivo(corpo.error ?? "asaas_error"));
        return;
      }
      if (vivoRef.current) setRelatorio(corpo.relatorio);
    } finally {
      if (vivoRef.current) setLevantando(false);
    }
  };

  const copiarRelatorio = async () => {
    if (!relatorio) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(relatorio, null, 2));
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      toast.error(t("salvarFalhou"));
    }
  };

  const estado = cartao?.estado ?? "nao_conectado";
  // ⚠️ O chip fica no cabeçalho, sempre visível, e é uma AFIRMAÇÃO. Enquanto
  // a carga corre — ou quando ela falha — dizer "Não conectada" acusa de
  // desconexão uma integração que pode estar de pé (regra do Meta Ads).
  const [variante, rotuloDoChip] =
    cartao === null && !falhou
      ? (["muted", t("chipConferindo")] as const)
      : falhou && !cartao
        ? (["err", t("chipErro")] as const)
        : estado === "conectado"
          ? (["ok", t("chipOk")] as const)
          : estado === "erro"
            ? (["err", t("chipErro")] as const)
            : (["muted", t("chipNaoConectado")] as const);

  const avisoDaChave = (() => {
    if (!cartao?.expiraEm) return null;
    const dias = cartao.diasAteExpirar;
    if (dias !== null && dias < 0) return t("asaas.expirada", { dia: cartao.expiraEm });
    if (dias !== null && dias <= AVISAR_EXPIRACAO_EM_DIAS) return t("asaas.expiraEmBreve", { dia: cartao.expiraEm, dias });
    return t("asaas.expiraEm", { dia: cartao.expiraEm });
  })();

  return (
    <div className="rounded-lg border border-border bg-card">
      <button type="button" onClick={() => setAberto((a) => !a)} aria-expanded={aberto} className="flex w-full items-center gap-3 p-4 text-left">
        <Receipt className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">Asaas</span>
        <SettingsChip variant={variante}>{rotuloDoChip}</SettingsChip>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", aberto && "rotate-180")} />
      </button>

      {aberto ? (
        <div className="min-w-0 space-y-4 border-t border-border p-4 text-sm">
          {falhou && !cartao ? (
            <p className="text-muted-foreground">
              {t("carregarFalhou")}{" "}
              <button type="button" onClick={() => void carregar()} className="underline">
                {t("tentarDeNovo")}
              </button>
            </p>
          ) : !cartao ? (
            <p className="text-muted-foreground">{t("asaas.carregando")}</p>
          ) : cartao.estado === "nao_conectado" ? (
            <>
              <p className="max-w-[62ch] text-muted-foreground">{t("asaas.desc")}</p>
              <div className="grid gap-3 sm:max-w-md">
                <div className="space-y-1">
                  <Label htmlFor="asaas-chave">{t("asaas.campoChave")}</Label>
                  <Input
                    id="asaas-chave"
                    type="password"
                    value={chave}
                    onChange={(e) => setChave(e.target.value)}
                    placeholder={t("asaas.chaveVazia")}
                    autoComplete="off"
                  />
                  <p className="text-xs text-muted-foreground">{t("asaas.chaveDica")}</p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="asaas-nome">{t("asaas.campoNome")}</Label>
                  <Input id="asaas-nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder={t("asaas.nomePlaceholder")} autoComplete="off" />
                  <p className="text-xs text-muted-foreground">{t("asaas.nomeDica")}</p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="asaas-validade">{t("asaas.campoValidade")}</Label>
                  <Input id="asaas-validade" type="date" value={validade} onChange={(e) => setValidade(e.target.value)} />
                  <p className="text-xs text-muted-foreground">{t("asaas.validadeDica")}</p>
                </div>
                {erro && <p className="text-xs text-destructive">{t("falha", { motivo: erro })}</p>}
                <div>
                  <Button type="button" size="sm" onClick={() => void conectar()} disabled={salvando || !chave.trim()}>
                    {salvando ? t("asaas.conectando") : t("asaas.conectar")}
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0 text-muted-foreground">
                  {cartao.chaveNome ? t("asaas.chaveRotulada", { nome: cartao.chaveNome }) : t("asaas.semNome")}
                  {cartao.conectadoEm ? ` · ${t("asaas.conectadoEm", { quando: new Date(cartao.conectadoEm).toLocaleDateString(undefined) })}` : ""}
                </div>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => void levantar()} disabled={levantando}>
                    <Search className={cn("size-4", levantando && "animate-pulse")} />
                    {levantando ? t("asaas.levantando") : t("asaas.levantar")}
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => void desconectar()} disabled={desconectando}>
                    {t("asaas.desconectar")}
                  </Button>
                </div>
              </div>
              {cartao.sandbox && <p className="text-xs text-amber-600 dark:text-amber-400">{t("asaas.sandboxAviso")}</p>}
              {avisoDaChave && (
                <p className={cn("text-xs", cartao.diasAteExpirar !== null && cartao.diasAteExpirar <= AVISAR_EXPIRACAO_EM_DIAS ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>
                  {avisoDaChave}
                </p>
              )}
              {cartao.erro && <p className="text-xs text-destructive">{t("falha", { motivo: motivo(cartao.erro) })}</p>}
              {erro && <p className="text-xs text-destructive">{t("falha", { motivo: erro })}</p>}
              <p className="max-w-[62ch] text-xs text-muted-foreground">{t("asaas.levantamentoAjuda")}</p>

              {relatorio && <Relatorio relatorio={relatorio} t={t} onCopiar={() => void copiarRelatorio()} copiado={copiado} />}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Secao({ titulo, linhas }: { titulo: string; linhas: (string | null)[] }) {
  const uteis = linhas.filter((l): l is string => l !== null && l !== "");
  if (uteis.length === 0) return null;
  return (
    <div className="space-y-0.5">
      <p className="text-xs font-medium text-foreground">{titulo}</p>
      {uteis.map((linha, i) => (
        <p key={`${titulo}-${i}`} className="text-xs text-muted-foreground">
          {linha}
        </p>
      ))}
    </div>
  );
}

function Relatorio({
  relatorio,
  t,
  onCopiar,
  copiado,
}: {
  relatorio: RelatorioDoLevantamento;
  t: ReturnType<typeof useTranslations<"Settings.integracoes">>;
  onCopiar: () => void;
  copiado: boolean;
}) {
  const { clientes: c, vinculo: v, cobrancas: cob } = relatorio;
  return (
    <div className="min-w-0 space-y-3 rounded-md border border-border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium">{t("asaas.levantamentoTitulo", { quando: new Date(relatorio.geradoEm).toLocaleString(undefined) })}</p>
        <Button type="button" variant="outline" size="sm" onClick={onCopiar}>
          {copiado ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copiado ? t("asaas.relatorioCopiado") : t("asaas.copiarRelatorio")}
        </Button>
      </div>

      {relatorio.avisos.length > 0 && (
        <div className="space-y-0.5">
          <p className="text-xs font-medium text-amber-600 dark:text-amber-400">{t("asaas.lev.avisosTitulo")}</p>
          {relatorio.avisos.map((aviso) => (
            <p key={aviso} className="text-xs text-amber-600 dark:text-amber-400">
              {aviso}
            </p>
          ))}
        </div>
      )}

      <Secao
        titulo={t("asaas.lev.clientesTitulo")}
        linhas={[
          t("asaas.lev.clientesResumo", { total: c.total, apagados: c.apagados, semTelefone: c.semTelefoneNenhum }),
          t("asaas.lev.contato", { comEmail: c.comEmail, comCelular: c.comCelular, comTelefone: c.comTelefone }),
          t("asaas.lev.documentos", { cpf: c.comCpf, cnpj: c.comCnpj, outro: c.comDocumentoDeOutroTamanho, sem: c.semDocumento }),
          t("asaas.lev.repetidos", { documentos: c.documentosRepetidos, telefones: c.telefonesRepetidos }),
          t("asaas.lev.outros", { notificacoes: c.notificacoesDesligadas, referencia: c.comReferenciaExterna }),
          t("asaas.lev.formatos", { lista: listar(c.porFormatoDeTelefone) }),
          t("asaas.lev.tipos", { lista: listar(c.porTipoDePessoa) }),
        ]}
      />

      <Secao
        titulo={t("asaas.lev.vinculoTitulo")}
        linhas={[
          t("asaas.lev.vinculoBase", { contatos: v.contatosNoCrm, comEmail: v.contatosComEmail, calendly: v.emailsDoCalendly }),
          ...MOTIVOS.map((m) =>
            // chave montada: `asaas.vinculoMotivo.<motivo>` — a lista é o
            // tipo `MotivoDoVinculo`, e há teste cobrando as oito.
            `${v[m]} · ${t(`asaas.vinculoMotivo.${m}` as Parameters<typeof t>[0])}`,
          ),
          v.contatosDisputados > 0 ? t("asaas.lev.disputados", { n: v.contatosDisputados }) : null,
        ]}
      />

      <Secao
        titulo={t("asaas.lev.cobrancasTitulo")}
        linhas={[
          t("asaas.lev.cobrancasResumo", { n: cob.vencidas, clientes: cob.clientesComVencida, comFicha: cob.clientesComVencidaEFicha }),
          t("asaas.lev.valores", { valor: formatCurrency(cob.valorVencido), juros: formatCurrency(cob.jurosAcumulado) }),
          cob.vencimentoMaisAntigo ? t("asaas.lev.maisAntiga", { dia: cob.vencimentoMaisAntigo }) : null,
          t("asaas.lev.faixas", { lista: listar(cob.porFaixaDeAtraso) }),
          t("asaas.lev.formas", { lista: listar(cob.porForma) }),
          t("asaas.lev.detalhes", {
            boleto: cob.boletoJaNaoPagavel,
            parcelamento: cob.comParcelamento,
            assinatura: cob.deAssinatura,
            mesmoDia: cob.clientesComDoisVencimentosNoMesmoDia,
          }),
        ]}
      />

      <Secao titulo={t("asaas.lev.sondasTitulo")} linhas={Object.entries(relatorio.sondas).map(([pergunta, resposta]) => `${pergunta} → ${resposta}`)} />

      <Secao
        titulo={t("asaas.lev.exemplosTitulo")}
        linhas={relatorio.exemplos.map(
          (e) =>
            `${e.cliente} → ${e.contato ?? t("asaas.lev.semDado")} (${t(`asaas.vinculoMotivo.${e.motivo}` as Parameters<typeof t>[0])})`,
        )}
      />

      <Secao titulo={t("asaas.lev.cotaTitulo")} linhas={[listarTexto(relatorio.cota)]} />
    </div>
  );
}
