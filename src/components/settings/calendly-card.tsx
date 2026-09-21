"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { CalendarClock, ChevronDown, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { RESULTADOS_REPROCESSAVEIS } from "@/lib/calendly/log";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CartaoDoCalendly, EventoDoCalendly } from "@/lib/calendly/cartao";
import { EVENTOS_POR_PAGINA } from "@/lib/calendly/log";
import { formatarTelefone } from "@/lib/contacts/telefone";
import { cn } from "@/lib/utils";

import { SettingsChip } from "./settings-chip";

/**
 * O cartão "Calendly" da aba Integrações (977). Conecta com um Personal
 * Access Token (testado e guardado cifrado pela rota), assina o webhook,
 * mostra quem conectou, o estado da assinatura, a pergunta do telefone e os
 * últimos agendamentos recebidos com o que aconteceu a cada um — é por
 * essa lista que "marquei e nada aconteceu" tem resposta.
 *
 * Mesmo esqueleto do `meta-ads-card.tsx`: só admin chega aqui, nenhum
 * segredo volta da rota, o campo do token nasce vazio sempre.
 */

interface Resposta {
  cartao: CartaoDoCalendly;
  /** A primeira página do log (os 20 mais recentes). */
  eventos: EventoDoCalendly[];
  totalEventos: number;
  webhookUrl: string | null;
  origemAlcancavel: boolean;
}


const CODIGOS_CONHECIDOS = new Set([
  "token_invalido",
  "sem_permissao",
  "nao_encontrado",
  "limite",
  "rede",
  "calendly_error",
  "url_inalcancavel",
  "db_error",
  "nao_conectado",
  "chave_ilegivel",
  "webhook_desativado",
]);

const RESULTADOS = new Set(["recebido", "disparado", "em_espera", "cancelado", "sem_automacao", "sem_contato", "sem_telefone", "ignorado", "falhou"]);
const ORIGENS = new Set(["sms", "pergunta", "heuristica"]);

export function CalendlyCard() {
  const t = useTranslations("Settings.integracoes");
  const [dados, setDados] = useState<Resposta | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [token, setToken] = useState("");
  const [pergunta, setPergunta] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [reassinando, setReassinando] = useState(false);
  const [salvandoPergunta, setSalvandoPergunta] = useState(false);
  const [desconectando, setDesconectando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // O log é EXPANSÍVEL (pedido do operador): fechado, o cartão diz só
  // quantos chegaram; aberto, lista cada recebimento, e cada linha abre os
  // dados que vieram — é a auditoria de "marquei e o que aconteceu?".
  const [logAberto, setLogAberto] = useState(false);
  const [eventoAberto, setEventoAberto] = useState<string | null>(null);
  // Paginado (pedido do operador): 20 por página, dos mais recentes para os
  // mais antigos. A página 1 vem junto com o cartão; as outras, sob demanda.
  const [pagina, setPagina] = useState(1);
  const [paginaCarregada, setPaginaCarregada] = useState<{ pagina: number; eventos: EventoDoCalendly[] } | null>(null);
  const [carregandoPagina, setCarregandoPagina] = useState(false);
  const [reprocessando, setReprocessando] = useState<string | null>(null);
  const vivoRef = useRef(true);
  const dadosRef = useRef<Resposta | null>(null);
  dadosRef.current = dados;

  const motivo = (codigo: string) =>
    CODIGOS_CONHECIDOS.has(codigo)
      ? // chave montada: `calendly.motivo.<codigo>` — lista fechada acima
        t(`calendly.motivo.${codigo}` as Parameters<typeof t>[0])
      : t("calendly.motivo.calendly_error");

  const carregar = useCallback(async () => {
    try {
      const res = await fetch("/api/cb/calendly");
      if (!res.ok) throw new Error(String(res.status));
      const corpo = (await res.json()) as Resposta;
      if (vivoRef.current) {
        setDados(corpo);
        setPergunta(corpo.cartao.perguntaTelefone ?? "");
        setPagina(1);
        setPaginaCarregada(null);
        setFalhou(false);
      }
    } catch {
      if (!vivoRef.current) return;
      setFalhou(true);
      if (dadosRef.current !== null) toast.error(t("recarregarFalhou"));
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
      const res = await fetch("/api/cb/calendly/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_token: token }),
      });
      const corpo = (await res.json().catch(() => ({}))) as { error?: string; webhookErro?: string | null };
      if (!res.ok) {
        setErro(motivo(corpo.error ?? "calendly_error"));
        return;
      }
      setToken("");
      if (corpo.webhookErro) toast.warning(t("calendly.conectadoSemWebhook"));
      else toast.success(t("calendly.conectado"));
      await carregar();
    } finally {
      if (vivoRef.current) setSalvando(false);
    }
  };

  const reassinar = async () => {
    setReassinando(true);
    try {
      const res = await fetch("/api/cb/calendly/reassinar", { method: "POST" });
      const corpo = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(t("falha", { motivo: motivo(corpo.error ?? "calendly_error") }));
      } else {
        toast.success(t("calendly.reassinado"));
      }
      await carregar();
    } finally {
      if (vivoRef.current) setReassinando(false);
    }
  };

  const salvarPergunta = async () => {
    setSalvandoPergunta(true);
    try {
      const res = await fetch("/api/cb/calendly/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pergunta_telefone: pergunta }),
      });
      if (!res.ok) {
        toast.error(t("salvarFalhou"));
        return;
      }
      toast.success(t("calendly.perguntaSalva"));
      await carregar();
    } finally {
      if (vivoRef.current) setSalvandoPergunta(false);
    }
  };

  const desconectar = async () => {
    if (desconectando) return;
    if (!window.confirm(t("calendly.confirmarDesconectar"))) return;
    setDesconectando(true);
    try {
      const res = await fetch("/api/cb/calendly/config", { method: "DELETE" });
      if (!res.ok) {
        toast.error(t("salvarFalhou"));
        return;
      }
      await carregar();
    } finally {
      if (vivoRef.current) setDesconectando(false);
    }
  };

  const irParaPagina = async (n: number) => {
    if (n < 1) return;
    if (n === 1) {
      setPagina(1);
      setPaginaCarregada(null);
      return;
    }
    setCarregandoPagina(true);
    try {
      const res = await fetch(`/api/cb/calendly/eventos?pagina=${n}`);
      if (!res.ok) throw new Error(String(res.status));
      const corpo = (await res.json()) as { eventos: EventoDoCalendly[]; pagina: number };
      if (vivoRef.current) {
        setPagina(corpo.pagina);
        setPaginaCarregada({ pagina: corpo.pagina, eventos: corpo.eventos });
        setEventoAberto(null);
      }
    } catch {
      if (vivoRef.current) toast.error(t("recarregarFalhou"));
    } finally {
      if (vivoRef.current) setCarregandoPagina(false);
    }
  };

  /**
   * "Processar de novo" numa linha do log. Existe porque o motivo de um
   * agendamento não ter disparado costuma ser passageiro e externo — o
   * telefone ainda não era de nenhum contato (a ficha nasce segundos
   * depois), a automação ainda não existia. Depois de arrumar, o operador
   * não tinha como pedir a repetição sem marcar outro horário no Calendly.
   */
  const reprocessar = async (id: string) => {
    setReprocessando(id);
    try {
      const res = await fetch(`/api/cb/calendly/eventos/${id}/reprocessar`, { method: "POST" });
      const corpo = (await res.json().catch(() => null)) as { resultado?: string; error?: string } | null;
      if (!res.ok) {
        toast.error(
          corpo?.error === "ja_processado"
            ? t("calendly.jaProcessado")
            : corpo?.error === "ainda_processando"
              ? t("calendly.aindaProcessando")
              : t("calendly.reprocessarFalhou"),
        );
        // O estado da linha mudou (outro já processou, ou está processando):
        // a lista na tela é uma foto de antes do clique.
        await carregar();
        return;
      }
      toast.success(t("calendly.reprocessado", { resultado: rotuloDoResultado(corpo?.resultado ?? "") }));
      // Recarrega o cartão inteiro: o resultado da linha mudou, e com ele as
      // contagens do rodapé.
      await carregar();
    } catch {
      toast.error(t("calendly.reprocessarFalhou"));
    } finally {
      if (vivoRef.current) setReprocessando(null);
    }
  };

  const cartao = dados?.cartao;
  const estado = cartao?.estado ?? "nao_conectado";
  // O chip é uma AFIRMAÇÃO no cabeçalho: enquanto não se sabe, "Conferindo"
  // — nunca "Não conectada" sobre uma integração que pode estar de pé.
  const [variante, rotuloDoChip] =
    dados === null && !falhou
      ? (["muted", t("chipConferindo")] as const)
      : falhou && !dados
        ? (["err", t("chipErro")] as const)
        : estado === "conectado"
          ? (["ok", t("chipOk")] as const)
          : estado === "erro"
            ? (["err", t("chipErro")] as const)
            : (["muted", t("chipNaoConectado")] as const);

  const rotuloDoResultado = (r: string) =>
    RESULTADOS.has(r) ? t(`calendly.resultado.${r}` as Parameters<typeof t>[0]) : r;
  const rotuloDaOrigem = (o: string | null) =>
    o && ORIGENS.has(o) ? t(`calendly.origem.${o}` as Parameters<typeof t>[0]) : null;

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-expanded={aberto}
        className="flex w-full items-center gap-3 p-4 text-left"
      >
        <CalendarClock className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">Calendly</span>
        <SettingsChip variant={variante}>{rotuloDoChip}</SettingsChip>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", aberto && "rotate-180")} />
      </button>

      {aberto ? (
        <div className="space-y-4 border-t border-border p-4 text-sm">
          {falhou && !dados ? (
            <p className="text-muted-foreground">
              {t("carregarFalhou")}{" "}
              <button type="button" onClick={() => void carregar()} className="underline">
                {t("tentarDeNovo")}
              </button>
            </p>
          ) : !cartao ? (
            <p className="text-muted-foreground">{t("calendly.carregando")}</p>
          ) : cartao.estado === "nao_conectado" ? (
            <>
              <p className="max-w-[62ch] text-muted-foreground">{t("calendly.desc")}</p>
              {dados && !dados.origemAlcancavel && (
                <p className="text-xs text-destructive">{t("calendly.urlInalcancavel")}</p>
              )}
              <div className="grid gap-3 sm:max-w-md">
                <div className="space-y-1">
                  <Label htmlFor="calendly-token">{t("calendly.campoToken")}</Label>
                  <Input
                    id="calendly-token"
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder={t("calendly.tokenVazio")}
                    autoComplete="off"
                  />
                  <p className="text-xs text-muted-foreground">{t("calendly.tokenDica")}</p>
                  <p className="text-xs text-muted-foreground">{t("calendly.planoDica")}</p>
                </div>
                {erro && <p className="text-xs text-destructive">{t("falha", { motivo: erro })}</p>}
                <div>
                  <Button type="button" size="sm" onClick={() => void conectar()} disabled={salvando || !token}>
                    {salvando ? t("calendly.conectando") : t("calendly.conectar")}
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-muted-foreground">
                  <span className="text-foreground">
                    {t("calendly.usuario", { nome: cartao.usuario?.nome ?? "", email: cartao.usuario?.email ?? "" })}
                  </span>
                  {cartao.usuario?.agenda && (
                    <>
                      {" "}
                      ·{" "}
                      <a href={cartao.usuario.agenda} target="_blank" rel="noreferrer" className="underline">
                        {t("calendly.agenda")}
                      </a>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => void reassinar()} disabled={reassinando}>
                    <RefreshCw className={cn("size-4", reassinando && "animate-spin")} />
                    {reassinando ? t("calendly.reassinando") : t("calendly.reassinar")}
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => void desconectar()} disabled={desconectando}>
                    {t("calendly.desconectar")}
                  </Button>
                </div>
              </div>

              {cartao.webhook && cartao.webhook.estado === "active" ? (
                <p className="text-xs text-muted-foreground">
                  {t("calendly.webhookAtivo", {
                    escopo: t(`calendly.escopo.${cartao.webhook.escopo === "user" ? "user" : "organization"}`),
                  })}
                </p>
              ) : cartao.webhook ? (
                <p className="text-xs text-destructive">{t("calendly.webhookDesativado")}</p>
              ) : (
                <p className="text-xs text-destructive">{t("calendly.webhookAusente")}</p>
              )}
              {cartao.erro && cartao.erro !== "webhook_desativado" && (
                <p className="text-xs text-destructive">{t("falha", { motivo: motivo(cartao.erro) })}</p>
              )}
              {dados && !dados.origemAlcancavel && (
                <p className="text-xs text-destructive">{t("calendly.urlInalcancavel")}</p>
              )}
              {dados?.webhookUrl && (
                <div className="space-y-1">
                  <Label>{t("calendly.urlLabel")}</Label>
                  <Input value={dados.webhookUrl} readOnly className="font-mono text-xs" />
                  <p className="text-xs text-muted-foreground">{t("calendly.urlHint")}</p>
                </div>
              )}

              <div className="grid gap-1 sm:max-w-md">
                <Label htmlFor="calendly-pergunta">{t("calendly.perguntaLabel")}</Label>
                <div className="flex gap-2">
                  <Input
                    id="calendly-pergunta"
                    value={pergunta}
                    onChange={(e) => setPergunta(e.target.value)}
                    placeholder={t("calendly.perguntaPlaceholder")}
                    autoComplete="off"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void salvarPergunta()}
                    disabled={salvandoPergunta || pergunta.trim() === (cartao.perguntaTelefone ?? "")}
                  >
                    {t("calendly.salvarPergunta")}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{t("calendly.perguntaHint")}</p>
              </div>

              <LogDeRecebimentos
                eventos={pagina === 1 || !paginaCarregada ? (dados?.eventos ?? []) : paginaCarregada.eventos}
                total={dados?.totalEventos ?? 0}
                pagina={pagina}
                carregando={carregandoPagina}
                onPagina={(n) => void irParaPagina(n)}
                cartao={cartao}
                aberto={logAberto}
                onToggle={() => setLogAberto((a) => !a)}
                eventoAberto={eventoAberto}
                onAbrirEvento={(id) => setEventoAberto((atual) => (atual === id ? null : id))}
                onReprocessar={(id) => void reprocessar(id)}
                reprocessando={reprocessando}
                t={t}
                rotuloDoResultado={rotuloDoResultado}
                rotuloDaOrigem={rotuloDaOrigem}
              />
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function quando(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

function LogDeRecebimentos({
  eventos,
  total,
  pagina,
  carregando,
  onPagina,
  cartao,
  aberto,
  onToggle,
  eventoAberto,
  onAbrirEvento,
  onReprocessar,
  reprocessando,
  t,
  rotuloDoResultado,
  rotuloDaOrigem,
}: {
  eventos: EventoDoCalendly[];
  total: number;
  pagina: number;
  carregando: boolean;
  onPagina: (n: number) => void;
  cartao: CartaoDoCalendly;
  aberto: boolean;
  onToggle: () => void;
  eventoAberto: string | null;
  onAbrirEvento: (id: string) => void;
  onReprocessar: (id: string) => void;
  /** id da linha em processamento, ou null. */
  reprocessando: string | null;
  t: ReturnType<typeof useTranslations>;
  rotuloDoResultado: (r: string) => string;
  rotuloDaOrigem: (o: string | null) => string | null;
}) {
  return (
    <div className="rounded-md border border-border">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={aberto}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs"
      >
        <ChevronDown className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", aberto && "rotate-180")} />
        <span className="font-medium text-foreground">{t("calendly.log", { n: total })}</span>
        <span className="ml-auto truncate text-muted-foreground">
          {t("calendly.contagem", {
            disparados: cartao.contagem.disparado,
            semContato: cartao.contagem.sem_contato,
            semAutomacao: cartao.contagem.sem_automacao,
            semTelefone: cartao.contagem.sem_telefone,
          })}
        </span>
      </button>
      {aberto ? (
        <div className="space-y-2 border-t border-border p-3">
          <p className="text-[11px] text-muted-foreground">{t("calendly.logAjuda")}</p>
          {total === 0 ? (
            <p className="text-xs text-muted-foreground">{t("calendly.semEventos")}</p>
          ) : (
            <div className={cn("overflow-x-auto", carregando && "opacity-60")}>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="py-1 pr-2 font-medium">{t("calendly.colQuando")}</th>
                    <th className="py-1 pr-2 font-medium">{t("calendly.colNome")}</th>
                    <th className="py-1 pr-2 font-medium">{t("calendly.colTelefone")}</th>
                    <th className="py-1 pr-2 font-medium">{t("calendly.colEvento")}</th>
                    <th className="py-1 font-medium">{t("calendly.colResultado")}</th>
                  </tr>
                </thead>
                <tbody>
                  {eventos.map((e) => {
                    const abertoAqui = eventoAberto === e.id;
                    return (
                      <React.Fragment key={e.id}>
                        <tr
                          className="cursor-pointer border-t border-border align-top hover:bg-muted/40"
                          onClick={() => onAbrirEvento(e.id)}
                          aria-expanded={abertoAqui}
                        >
                          <td className="whitespace-nowrap py-1.5 pr-2 text-muted-foreground">{quando(e.recebido_em)}</td>
                          <td className="max-w-[12rem] truncate py-1.5 pr-2" title={e.nome ?? ""}>
                            {e.nome ?? "—"}
                          </td>
                          <td className="whitespace-nowrap py-1.5 pr-2">{e.telefone ? formatarTelefone(e.telefone) : "—"}</td>
                          <td className="max-w-[14rem] truncate py-1.5 pr-2" title={e.event_type_nome ?? ""}>
                            {e.event_type_nome ?? "—"}
                          </td>
                          <td
                            className={cn(
                              "py-1.5",
                              e.resultado === "disparado"
                                ? "text-emerald-600 dark:text-emerald-400"
                                : e.resultado === "falhou"
                                  ? "text-destructive"
                                  : e.resultado === "recebido" || e.resultado === "em_espera"
                                    ? "text-muted-foreground"
                                    : "text-amber-600 dark:text-amber-400",
                            )}
                          >
                            {rotuloDoResultado(e.resultado)}
                          </td>
                        </tr>
                        {abertoAqui && (
                          <tr className="border-t border-border/60 bg-muted/30">
                            <td colSpan={5} className="px-2 py-2">
                              <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[max-content_1fr]">
                                <dt className="text-muted-foreground">{t("calendly.detEvento")}</dt>
                                <dd>
                                  {e.event_type_nome ?? "—"}
                                  {e.inicio && (
                                    <span className="text-muted-foreground">
                                      {" "}
                                      · {quando(e.inicio)}
                                      {e.fim ? ` – ${quando(e.fim)}` : ""}
                                    </span>
                                  )}
                                </dd>
                                <dt className="text-muted-foreground">{t("calendly.detEmail")}</dt>
                                <dd>{e.email ?? "—"}</dd>
                                <dt className="text-muted-foreground">{t("calendly.detTelefone")}</dt>
                                <dd>
                                  {e.telefone ? formatarTelefone(e.telefone) : "—"}
                                  {rotuloDaOrigem(e.telefone_origem) && (
                                    <span className="text-muted-foreground"> · {rotuloDaOrigem(e.telefone_origem)}</span>
                                  )}
                                </dd>
                                <dt className="text-muted-foreground">{t("calendly.detLink")}</dt>
                                <dd className="break-all">
                                  {e.link ? (
                                    <a href={e.link} target="_blank" rel="noreferrer" className="underline">
                                      {e.link}
                                    </a>
                                  ) : (
                                    "—"
                                  )}
                                </dd>
                                <dt className="text-muted-foreground">{t("calendly.detPerguntas")}</dt>
                                <dd>
                                  {e.perguntas && e.perguntas.length > 0 ? (
                                    <ul className="space-y-0.5">
                                      {e.perguntas.map((q, i) => (
                                        <li key={i}>
                                          <span className="text-muted-foreground">{q.pergunta}:</span> {q.resposta}
                                        </li>
                                      ))}
                                    </ul>
                                  ) : (
                                    t("calendly.detSemPerguntas")
                                  )}
                                </dd>
                                <dt className="text-muted-foreground">{t("calendly.detResultado")}</dt>
                                <dd>
                                  {rotuloDoResultado(e.resultado)}
                                  {e.detalhe && <span className="text-muted-foreground"> · {e.detalhe}</span>}
                                  <span className="text-muted-foreground">
                                    {" "}
                                    · {e.processado_em ? t("calendly.detProcessado", { quando: quando(e.processado_em) }) : t("calendly.detNaoProcessado")}
                                  </span>
                                </dd>
                                <dt className="text-muted-foreground">{t("calendly.detContato")}</dt>
                                <dd>
                                  {e.contact_id ? (
                                    <a href={`/contacts?contact=${e.contact_id}`} className="underline">
                                      {t("calendly.abrirNoCrm")}
                                    </a>
                                  ) : (
                                    "—"
                                  )}
                                </dd>
                              </dl>
                              {(RESULTADOS_REPROCESSAVEIS as readonly string[]).includes(e.resultado) && (
                                <div className="mt-2 flex items-center gap-2">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => onReprocessar(e.id)}
                                    disabled={reprocessando !== null}
                                  >
                                    {reprocessando === e.id ? t("calendly.reprocessando") : t("calendly.reprocessar")}
                                  </Button>
                                  <span className="text-xs text-muted-foreground">{t("calendly.reprocessarAjuda")}</span>
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {total > EVENTOS_POR_PAGINA && (
            <div className="flex items-center justify-between gap-2 text-xs">
              <Button type="button" variant="outline" size="sm" onClick={() => onPagina(pagina - 1)} disabled={carregando || pagina <= 1}>
                {t("calendly.logMaisRecentes")}
              </Button>
              <span className="text-muted-foreground">
                {t("calendly.logPagina", { pagina, total: Math.max(1, Math.ceil(total / EVENTOS_POR_PAGINA)) })}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onPagina(pagina + 1)}
                disabled={carregando || pagina * EVENTOS_POR_PAGINA >= total}
              >
                {t("calendly.logMaisAntigos")}
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
