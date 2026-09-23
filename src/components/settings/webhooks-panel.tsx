"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  BookOpen,
  ChevronDown,
  Copy,
  ListChecks,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Webhook,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FONTE_MONO } from "@/components/settings/copiar";
import {
  EVENTOS_POR_GRUPO,
  useRotulosDosEventos,
  useRotulosDosGrupos,
} from "@/components/settings/documentacao/rotulos-dos-eventos";
import { SettingsChip } from "@/components/settings/settings-chip";
import {
  FALHAS_QUE_DESLIGAM,
  PRAZO_DA_ENTREGA_SEGUNDOS,
} from "@/lib/integracoes/exemplos-de-requisicao";
import { cn } from "@/lib/utils";
import { RESULTADOS_REPROCESSAVEIS } from "@/lib/webhooks-de-entrada/log";
import type { MotivoDaFalhaDoTeste } from "@/lib/webhooks/enviar-teste";
import {
  WEBHOOK_EVENTS,
  isWebhookEvent,
  type WebhookEvent,
} from "@/lib/webhooks/events";

/**
 * Configurações → Webhooks (982). DUAS direções, duas abas:
 *
 *  - **Recebidos**: os webhooks de ENTRADA. O operador cria um com nome,
 *    copia a URL, cola no Typebot/n8n, e cada acionamento vira linha de um
 *    LOG — é por essa lista que "configurei e não aconteceu nada" tem
 *    resposta.
 *  - **Enviados**: os `webhook_endpoints` da 028, que existem desde o
 *    upstream e nunca tiveram tela (até aqui, só `curl` com chave de API).
 *    Cada endereço mostra os eventos com rótulo traduzido, deixa EDITAR os
 *    eventos (um endereço antigo não recebe evento novo sozinho) e tem o
 *    "Enviar teste", que manda o exemplo de `webhooks/exemplos.ts` com
 *    `"test": true` e mostra o resultado na linha.
 *
 * ⚠️ O log copia a forma do cartão do Calendly de propósito: `<table>` cru
 * com duas `<tr>` por linha (a linha e o detalhe) e `<dl>` dentro. Nada de
 * `Table`/`Collapsible` do shadcn — é o padrão da casa para log.
 */

// ------------------------------------------------------------
// Tipos
// ------------------------------------------------------------

interface WebhookRecebido {
  id: string;
  nome: string;
  token: string;
  sem_segredo: boolean;
  is_active: boolean;
  campo_telefone: string | null;
  campo_nome: string | null;
  campo_id: string | null;
  last_event_at: string | null;
  created_at: string;
  total: number;
  url: string | null;
}

interface EventoDoLog {
  id: string;
  nome: string | null;
  telefone: string | null;
  variaveis: Record<string, string>;
  contact_id: string | null;
  resultado: string;
  detalhe: string | null;
  recebido_em: string;
  processado_em: string | null;
}

interface EndpointDeSaida {
  id: string;
  url: string;
  events: string[];
  is_active: boolean;
  last_delivery_at: string | null;
  failure_count: number;
  created_at: string;
}

// ------------------------------------------------------------
// Peças pequenas
// ------------------------------------------------------------

function quando(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  });
}

/** Cores por resultado, nas mesmas 4 faixas do log do Calendly. */
function corDoResultado(r: string): string {
  if (r === "disparado") return "text-emerald-600 dark:text-emerald-400";
  if (r === "falhou") return "text-destructive";
  if (r === "recebido" || r === "em_espera") return "text-muted-foreground";
  return "text-amber-600 dark:text-amber-400";
}

function CampoParaCopiar({ valor }: { valor: string }) {
  const t = useTranslations("Settings.webhooks");
  const [copiou, setCopiou] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <Input value={valor} readOnly className="font-mono text-xs" />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(valor);
            setCopiou(true);
            setTimeout(() => setCopiou(false), 2000);
          } catch {
            toast.error(t("copiaFalhou"));
          }
        }}
      >
        <Copy className="size-3.5" />
        {copiou ? t("copiado") : t("copiar")}
      </Button>
    </div>
  );
}

// ------------------------------------------------------------
// O log de um webhook
// ------------------------------------------------------------

function LogDoWebhook({ webhookId }: { webhookId: string }) {
  const t = useTranslations("Settings.webhooks");
  const [eventos, setEventos] = useState<EventoDoLog[]>([]);
  const [total, setTotal] = useState(0);
  const [contagem, setContagem] = useState<Record<string, number> | null>(null);
  const [pagina, setPagina] = useState(1);
  const [carregando, setCarregando] = useState(true);
  const [aberto, setAberto] = useState<string | null>(null);
  const [reprocessando, setReprocessando] = useState<string | null>(null);
  const [porPagina, setPorPagina] = useState(20);

  const carregar = useCallback(
    async (n: number) => {
      setCarregando(true);
      try {
        const res = await fetch(
          `/api/cb/webhooks/${webhookId}/eventos?pagina=${n}`
        );
        if (!res.ok) throw new Error("falhou");
        const corpo = (await res.json()) as {
          eventos: EventoDoLog[];
          total: number;
          porPagina: number;
          contagem: Record<string, number> | null;
        };
        setEventos(corpo.eventos);
        setTotal(corpo.total);
        setPorPagina(corpo.porPagina);
        if (corpo.contagem) setContagem(corpo.contagem);
      } catch {
        toast.error(t("logFalhou"));
      } finally {
        setCarregando(false);
      }
    },
    [webhookId, t]
  );

  useEffect(() => {
    void carregar(pagina);
  }, [carregar, pagina]);

  const reprocessar = async (eventoId: string) => {
    setReprocessando(eventoId);
    try {
      const res = await fetch(
        `/api/cb/webhooks/${webhookId}/eventos/${eventoId}/reprocessar`,
        { method: "POST" }
      );
      const corpo = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        // "espere, está rodando" e "não insista, já rodou" são conselhos
        // diferentes, e a rota os distingue.
        toast.error(
          corpo.error === "ainda_processando"
            ? t("aindaProcessando")
            : corpo.error === "ja_processado"
              ? t("jaProcessado")
              : t("reprocessarFalhou")
        );
      } else {
        toast.success(t("reprocessado"));
      }
    } catch {
      toast.error(t("reprocessarFalhou"));
    } finally {
      setReprocessando(null);
      // A lista na tela é uma foto de antes do clique — recarrega sempre.
      void carregar(pagina);
    }
  };

  const paginas = Math.max(1, Math.ceil(total / porPagina));

  return (
    <div className="mt-3 rounded-md border border-border">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-2">
        <span className="text-xs font-medium text-foreground">
          {t("logTitulo", { n: total })}
        </span>
        {contagem ? (
          <span className="ml-auto text-[11px] text-muted-foreground">
            {t("logResumo", {
              disparado: contagem.disparado ?? 0,
              semAutomacao: contagem.sem_automacao ?? 0,
              semTelefone: contagem.sem_telefone ?? 0,
              falhou: contagem.falhou ?? 0,
            })}
          </span>
        ) : null}
      </div>

      <div className="p-3">
        {total === 0 && !carregando ? (
          <p className="text-xs text-muted-foreground">{t("logVazio")}</p>
        ) : (
          <div className={cn("overflow-x-auto", carregando && "opacity-60")}>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="pb-1 font-medium">{t("colQuando")}</th>
                  <th className="pb-1 font-medium">{t("colNome")}</th>
                  <th className="pb-1 font-medium">{t("colTelefone")}</th>
                  <th className="pb-1 font-medium">{t("colResultado")}</th>
                </tr>
              </thead>
              <tbody>
                {eventos.map((e) => {
                  const abertoAqui = aberto === e.id;
                  const chaves = Object.keys(e.variaveis ?? {});
                  return (
                    <tr
                      key={e.id}
                      className="border-t border-border align-top"
                    >
                      <td colSpan={4} className="p-0">
                        <button
                          type="button"
                          onClick={() => setAberto(abertoAqui ? null : e.id)}
                          aria-expanded={abertoAqui}
                          className="grid w-full grid-cols-4 gap-2 py-1.5 text-left hover:bg-muted/40"
                        >
                          <span className="whitespace-nowrap">
                            {quando(e.recebido_em)}
                          </span>
                          <span
                            className="max-w-[12rem] truncate"
                            title={e.nome ?? ""}
                          >
                            {e.nome || "—"}
                          </span>
                          <span className="whitespace-nowrap">
                            {e.telefone || "—"}
                          </span>
                          <span
                            className={cn("font-medium", corDoResultado(e.resultado))}
                          >
                            {t(`resultado.${e.resultado}` as "resultado.disparado")}
                          </span>
                        </button>

                        {abertoAqui ? (
                          <div className="border-t border-border/60 bg-muted/30 p-3">
                            <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[max-content_1fr]">
                              <dt className="text-muted-foreground">
                                {t("detDetalhe")}
                              </dt>
                              <dd>
                                {e.detalhe || "—"}
                                {e.processado_em
                                  ? ` · ${t("detProcessadoEm", { quando: quando(e.processado_em) })}`
                                  : ` · ${t("detNaoProcessado")}`}
                              </dd>

                              <dt className="text-muted-foreground">
                                {t("detVariaveis")}
                              </dt>
                              <dd>
                                {chaves.length === 0 ? (
                                  <span className="text-muted-foreground">
                                    {t("detSemVariaveis")}
                                  </span>
                                ) : (
                                  <ul className="space-y-0.5">
                                    {chaves.map((k) => (
                                      <li key={k} className="font-mono text-[11px]">
                                        <span className="text-muted-foreground">
                                          {`{{vars.${k}}}`}
                                        </span>{" "}
                                        {e.variaveis[k] || (
                                          <span className="text-muted-foreground">
                                            {t("detVazio")}
                                          </span>
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </dd>

                              {e.contact_id ? (
                                <>
                                  <dt className="text-muted-foreground">
                                    {t("detContato")}
                                  </dt>
                                  <dd>
                                    <a
                                      href={`/contacts?contact=${e.contact_id}`}
                                      className="underline"
                                    >
                                      {t("detAbrirContato")}
                                    </a>
                                  </dd>
                                </>
                              ) : null}
                            </dl>

                            {(RESULTADOS_REPROCESSAVEIS as readonly string[]).includes(
                              e.resultado
                            ) ? (
                              <div className="mt-2 flex items-center gap-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  disabled={reprocessando !== null}
                                  onClick={() => void reprocessar(e.id)}
                                >
                                  <RefreshCw
                                    className={cn(
                                      "size-3.5",
                                      reprocessando === e.id && "animate-spin"
                                    )}
                                  />
                                  {reprocessando === e.id
                                    ? t("reprocessando")
                                    : t("reprocessar")}
                                </Button>
                                <span className="text-[11px] text-muted-foreground">
                                  {t("reprocessarAjuda")}
                                </span>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {total > porPagina ? (
          <div className="mt-2 flex items-center justify-between text-[11px]">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={carregando || pagina <= 1}
              onClick={() => setPagina((n) => Math.max(1, n - 1))}
            >
              {t("maisRecentes")}
            </Button>
            <span className="text-muted-foreground">
              {t("logPagina", { pagina, total: paginas })}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={carregando || pagina * porPagina >= total}
              onClick={() => setPagina((n) => n + 1)}
            >
              {t("maisAntigos")}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Aba "Recebidos"
// ------------------------------------------------------------

function AbaRecebidos() {
  const t = useTranslations("Settings.webhooks");
  const [webhooks, setWebhooks] = useState<WebhookRecebido[] | null>(null);
  const [origemAlcancavel, setOrigemAlcancavel] = useState(true);
  const [falhou, setFalhou] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [segredoNovo, setSegredoNovo] = useState<string | null>(null);

  const [nome, setNome] = useState("");
  const [campoTelefone, setCampoTelefone] = useState("telefone");
  const [campoNome, setCampoNome] = useState("nome");
  const [campoId, setCampoId] = useState("");
  const [semSegredo, setSemSegredo] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const res = await fetch("/api/cb/webhooks");
      if (!res.ok) throw new Error("falhou");
      const corpo = (await res.json()) as {
        webhooks: WebhookRecebido[];
        origemAlcancavel: boolean;
      };
      setWebhooks(corpo.webhooks);
      setOrigemAlcancavel(corpo.origemAlcancavel);
      setFalhou(false);
    } catch {
      setFalhou(true);
      setWebhooks([]);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const criar = async () => {
    if (!nome.trim()) return;
    setSalvando(true);
    try {
      const res = await fetch("/api/cb/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome,
          sem_segredo: semSegredo,
          campo_telefone: campoTelefone,
          campo_nome: campoNome,
          campo_id: campoId,
        }),
      });
      const corpo = (await res.json().catch(() => ({}))) as {
        error?: string;
        segredo?: string | null;
      };
      if (!res.ok) {
        toast.error(
          corpo.error === "nome_repetido" ? t("nomeRepetido") : t("criarFalhou")
        );
        return;
      }
      // O segredo só existe em claro AQUI. Some ao fechar o aviso.
      if (corpo.segredo) setSegredoNovo(corpo.segredo);
      setNome("");
      setCampoId("");
      setSemSegredo(false);
      setCriando(false);
      await carregar();
      toast.success(t("criado"));
    } catch {
      toast.error(t("criarFalhou"));
    } finally {
      setSalvando(false);
    }
  };

  const alternar = async (w: WebhookRecebido) => {
    try {
      const res = await fetch(`/api/cb/webhooks/${w.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !w.is_active }),
      });
      if (!res.ok) throw new Error("falhou");
      await carregar();
    } catch {
      toast.error(t("salvarFalhou"));
    }
  };

  const apagar = async (w: WebhookRecebido) => {
    // ⚠️ Apagar leva o LOG junto (a FK é CASCADE). O número vai na pergunta:
    // "apagar" e "apagar 340 registros de acionamento" são decisões
    // diferentes.
    if (!confirm(t("apagarConfirma", { nome: w.nome, n: w.total }))) return;
    try {
      const res = await fetch(`/api/cb/webhooks/${w.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("falhou");
      await carregar();
      toast.success(t("apagado"));
    } catch {
      toast.error(t("apagarFalhou"));
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("recebidosAjuda")}</p>

      {segredoNovo ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
          <p className="text-xs font-medium text-foreground">
            {t("segredoTitulo")}
          </p>
          <p className="mb-2 mt-1 text-[11px] text-muted-foreground">
            {t("segredoAviso")}
          </p>
          <CampoParaCopiar valor={segredoNovo} />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2"
            onClick={() => setSegredoNovo(null)}
          >
            {t("segredoGuardei")}
          </Button>
        </div>
      ) : null}

      {!origemAlcancavel ? (
        <p className="text-xs text-destructive">{t("origemLocal")}</p>
      ) : null}

      {criando ? (
        <div className="space-y-3 rounded-md border border-border p-3">
          <div>
            <Label className="text-xs">{t("campoNomeDoWebhook")}</Label>
            <Input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder={t("campoNomePlaceholder")}
              maxLength={60}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label className="text-xs">{t("campoTelefone")}</Label>
              <Input
                value={campoTelefone}
                onChange={(e) => setCampoTelefone(e.target.value)}
                className="font-mono text-xs"
              />
            </div>
            <div>
              <Label className="text-xs">{t("campoNomeDoContato")}</Label>
              <Input
                value={campoNome}
                onChange={(e) => setCampoNome(e.target.value)}
                className="font-mono text-xs"
              />
            </div>
            <div>
              <Label className="text-xs">{t("campoId")}</Label>
              <Input
                value={campoId}
                onChange={(e) => setCampoId(e.target.value)}
                placeholder={t("campoIdPlaceholder")}
                className="font-mono text-xs"
              />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {t("camposAjuda")}
          </p>
          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={semSegredo}
              onChange={(e) => setSemSegredo(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium text-foreground">
                {t("semSegredo")}
              </span>
              <span className="block text-[11px] text-muted-foreground">
                {t("semSegredoAjuda")}
              </span>
            </span>
          </label>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => void criar()}
              disabled={salvando || !nome.trim()}
            >
              {salvando ? t("criando") : t("criar")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setCriando(false)}
            >
              {t("cancelar")}
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" size="sm" onClick={() => setCriando(true)}>
          <Plus className="size-3.5" />
          {t("novoWebhook")}
        </Button>
      )}

      {falhou ? (
        <p className="text-xs text-destructive">{t("listaFalhou")}</p>
      ) : null}

      {webhooks === null ? (
        <p className="text-xs text-muted-foreground">{t("carregando")}</p>
      ) : webhooks.length === 0 && !falhou ? (
        <p className="text-xs text-muted-foreground">{t("recebidosVazio")}</p>
      ) : (
        <div className="space-y-2">
          {webhooks.map((w) => {
            const abertoAqui = aberto === w.id;
            return (
              <div key={w.id} className="rounded-lg border border-border bg-card">
                <button
                  type="button"
                  onClick={() => setAberto(abertoAqui ? null : w.id)}
                  aria-expanded={abertoAqui}
                  className="flex w-full items-center gap-3 p-3 text-left"
                >
                  <Webhook className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                    {w.nome}
                  </span>
                  <span className="hidden text-[11px] text-muted-foreground sm:inline">
                    {w.last_event_at
                      ? t("ultimoAcionamento", { quando: quando(w.last_event_at) })
                      : t("nuncaAcionado")}
                  </span>
                  <SettingsChip variant={w.is_active ? "ok" : "muted"}>
                    {w.is_active ? t("ligado") : t("desligado")}
                  </SettingsChip>
                  <ChevronDown
                    className={cn(
                      "size-4 shrink-0 text-muted-foreground transition-transform",
                      abertoAqui && "rotate-180"
                    )}
                  />
                </button>

                {abertoAqui ? (
                  <div className="space-y-3 border-t border-border p-3">
                    <div>
                      <Label className="text-xs">{t("urlLabel")}</Label>
                      {w.url ? (
                        <CampoParaCopiar valor={w.url} />
                      ) : (
                        <p className="text-xs text-destructive">
                          {t("origemLocal")}
                        </p>
                      )}
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {w.sem_segredo ? t("urlAjudaSemSegredo") : t("urlAjuda")}
                      </p>
                    </div>

                    {w.sem_segredo ? (
                      <p className="text-[11px] text-amber-600 dark:text-amber-400">
                        {t("semSegredoAviso")}
                      </p>
                    ) : null}

                    <dl className="grid gap-x-4 gap-y-1 text-[11px] sm:grid-cols-[max-content_1fr]">
                      <dt className="text-muted-foreground">
                        {t("campoTelefone")}
                      </dt>
                      <dd className="font-mono">{w.campo_telefone || "—"}</dd>
                      <dt className="text-muted-foreground">
                        {t("campoNomeDoContato")}
                      </dt>
                      <dd className="font-mono">{w.campo_nome || "—"}</dd>
                      <dt className="text-muted-foreground">{t("campoId")}</dt>
                      <dd className="font-mono">{w.campo_id || "—"}</dd>
                    </dl>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void alternar(w)}
                      >
                        {w.is_active ? t("desligar") : t("ligar")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void apagar(w)}
                      >
                        <Trash2 className="size-3.5" />
                        {t("apagar")}
                      </Button>
                    </div>

                    <LogDoWebhook webhookId={w.id} />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------
// Aba "Enviados"
// ------------------------------------------------------------

/**
 * O resultado de `POST /api/cb/webhooks-de-saida/{id}/teste`, como a tela o
 * LÊ: campo a campo (`lerResultadoDoTeste`), nunca `as`. Um corpo
 * inesperado vira "não foi possível enviar", e não um "Entregue" inventado;
 * um motivo que esta tela não conhece (a rota ganhou um novo) vira `null`,
 * com texto genérico, em vez de chave crua.
 *
 * `import type`: `enviar-teste.ts` arrasta `node:crypto`, e só o tipo
 * atravessa para o navegador (é apagado na compilação).
 */
const MOTIVOS_DE_FALHA = [
  "http",
  "redirecionamento",
  "tempo",
  "rede",
  "endereco_bloqueado",
  "segredo_ilegivel",
] as const satisfies readonly MotivoDaFalhaDoTeste[];

type ResultadoDoTeste =
  | { ok: true; status: number; ms: number }
  | {
      ok: false;
      status: number | null;
      motivo: MotivoDaFalhaDoTeste | null;
      ms: number;
    };

function lerResultadoDoTeste(corpo: unknown): ResultadoDoTeste | null {
  if (typeof corpo !== "object" || corpo === null) return null;
  const c = corpo as Record<string, unknown>;
  // Arredondado: "312.4471 ms" na tela é ruído, e a rota pode medir com
  // `performance.now()`.
  const ms = typeof c.ms === "number" && Number.isFinite(c.ms) ? Math.round(c.ms) : 0;
  if (c.ok === true && typeof c.status === "number") {
    return { ok: true, status: c.status, ms };
  }
  if (c.ok === false) {
    const motivo = (MOTIVOS_DE_FALHA as readonly unknown[]).includes(c.motivo)
      ? (c.motivo as MotivoDaFalhaDoTeste)
      : null;
    return {
      ok: false,
      status: typeof c.status === "number" ? c.status : null,
      motivo,
      ms,
    };
  }
  return null;
}

type EstadoDoTeste =
  | { tipo: "enviando" }
  | { tipo: "resultado"; resultado: ResultadoDoTeste }
  | { tipo: "erro"; mensagem: string };

/** Os eventos na ordem do vocabulário — a ordem em que a tela os lista. */
function naOrdem(eventos: Iterable<WebhookEvent>): WebhookEvent[] {
  const marcados = new Set(eventos);
  return WEBHOOK_EVENTS.filter((ev) => marcados.has(ev));
}

/**
 * Os checkboxes de eventos, agrupados (Mensagens e conversas / Negócios),
 * com o rótulo traduzido, a descrição e o NOME TÉCNICO em fonte mono — é o
 * nome que o n8n e o Make mostram no cabeçalho `X-Wacrm-Event`, e quem
 * monta o fluxo precisa dele. Usado no cadastro e na edição.
 */
function SeletorDeEventos({
  marcados,
  onChange,
}: {
  marcados: WebhookEvent[];
  onChange: (eventos: WebhookEvent[]) => void;
}) {
  const rotulos = useRotulosDosEventos();
  const grupos = useRotulosDosGrupos();
  return (
    <div className="mt-1 space-y-3">
      {EVENTOS_POR_GRUPO.map(({ grupo, eventos }) => (
        <fieldset key={grupo} className="min-w-0 space-y-1.5">
          <legend className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {grupos[grupo]}
          </legend>
          {eventos.map((ev) => (
            <label key={ev} className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={marcados.includes(ev)}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? naOrdem([...marcados, ev])
                      : marcados.filter((x) => x !== ev)
                  )
                }
              />
              <span className="min-w-0">
                <span className="font-medium text-foreground">
                  {rotulos[ev].rotulo}
                </span>{" "}
                <code
                  className="text-[10.5px] text-muted-foreground"
                  style={{ fontFamily: FONTE_MONO }}
                >
                  {ev}
                </code>
                <span className="block text-[11px] text-muted-foreground">
                  {rotulos[ev].descricao}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      ))}
    </div>
  );
}

/**
 * Um endereço cadastrado: os eventos que ele assina, a edição desses
 * eventos e o "Enviar teste".
 *
 * A edição existe porque os eventos de um endereço são um `text[]` gravado
 * no cadastro: um endereço criado antes dos eventos de negócio NÃO passa a
 * recebê-los sozinho, e a única saída antes desta tela era apagar e criar de
 * novo — gerando um segredo novo para reconfigurar no n8n.
 *
 * O teste existe porque, sem ele, quem monta o fluxo depende de um fato
 * real acontecer no CRM — e a "Test URL" do n8n só escuta por 120 s. O
 * resultado aparece NA LINHA, com o status e o tempo: um toast some antes
 * de a pessoa ler "HTTP 404".
 */
function CartaoDoEndereco({
  endpoint: e,
  onMudou,
  onAlternar,
  onApagar,
}: {
  endpoint: EndpointDeSaida;
  onMudou: () => Promise<void>;
  onAlternar: () => void;
  onApagar: () => void;
}) {
  const t = useTranslations("Settings.webhooks");
  const rotulos = useRotulosDosEventos();

  const assinados = naOrdem(e.events.filter(isWebhookEvent));
  // Evento que o banco guarda e este código não conhece mais (um evento
  // retirado do vocabulário): aparece cru, nunca some da tela.
  const desconhecidos = e.events.filter((ev) => !isWebhookEvent(ev));

  const [editando, setEditando] = useState<WebhookEvent[] | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erroDaEdicao, setErroDaEdicao] = useState<string | null>(null);

  const [eventoDoTeste, setEventoDoTeste] = useState<WebhookEvent>(
    () => assinados[0] ?? WEBHOOK_EVENTS[0]
  );
  const [teste, setTeste] = useState<EstadoDoTeste | null>(null);

  const motivo: Record<
    MotivoDaFalhaDoTeste,
    (status: number | null) => string
  > = {
    http: (s) => t("testeMotivo.http", { status: s ?? "—" }),
    redirecionamento: (s) =>
      t("testeMotivo.redirecionamento", { status: s ?? "—" }),
    tempo: () => t("testeMotivo.tempo", { segundos: PRAZO_DA_ENTREGA_SEGUNDOS }),
    rede: () => t("testeMotivo.rede"),
    endereco_bloqueado: () => t("testeMotivo.enderecoBloqueado"),
    segredo_ilegivel: () => t("testeMotivo.segredoIlegivel"),
  };

  const salvarEventos = async () => {
    if (!editando || editando.length === 0) return;
    setSalvando(true);
    setErroDaEdicao(null);
    try {
      const res = await fetch(`/api/cb/webhooks-de-saida/${e.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: editando }),
      });
      const corpo = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        if (res.status === 404) {
          setErroDaEdicao(t("enderecoSumiu"));
          await onMudou();
        } else {
          setErroDaEdicao(
            corpo.error === "eventos_invalidos"
              ? t("eventosInvalidos")
              : t("salvarFalhou")
          );
        }
        return;
      }
      setEditando(null);
      await onMudou();
      toast.success(t("eventosSalvos"));
    } catch {
      setErroDaEdicao(t("salvarFalhou"));
    } finally {
      setSalvando(false);
    }
  };

  const enviarTeste = async () => {
    setTeste({ tipo: "enviando" });
    try {
      const res = await fetch(`/api/cb/webhooks-de-saida/${e.id}/teste`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ evento: eventoDoTeste }),
      });
      const corpo = await res.json().catch(() => null);
      if (!res.ok) {
        if (res.status === 404) {
          setTeste({ tipo: "erro", mensagem: t("enderecoSumiu") });
          await onMudou();
        } else {
          setTeste({ tipo: "erro", mensagem: t("testeErro") });
        }
        return;
      }
      const resultado = lerResultadoDoTeste(corpo);
      setTeste(
        resultado
          ? { tipo: "resultado", resultado }
          : { tipo: "erro", mensagem: t("testeErro") }
      );
    } catch {
      setTeste({ tipo: "erro", mensagem: t("testeErro") });
    }
  };

  const outros = WEBHOOK_EVENTS.filter((ev) => !assinados.includes(ev));
  const editadoIgual =
    editando !== null &&
    editando.length === assinados.length &&
    editando.every((ev) => assinados.includes(ev));

  return (
    <div className="min-w-0 space-y-2 rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-2">
        <span
          className="min-w-0 flex-1 truncate text-xs"
          style={{ fontFamily: FONTE_MONO }}
          title={e.url}
        >
          {e.url}
        </span>
        <SettingsChip
          variant={e.is_active ? "ok" : e.failure_count > 0 ? "err" : "muted"}
        >
          {e.is_active ? t("ligado") : t("desligado")}
        </SettingsChip>
      </div>

      <ul className="flex flex-wrap gap-1.5">
        {assinados.map((ev) => (
          <li
            key={ev}
            className="inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-foreground"
            title={rotulos[ev].descricao}
          >
            <span className="truncate">{rotulos[ev].rotulo}</span>
            <code
              className="shrink-0 text-[10px] text-muted-foreground"
              style={{ fontFamily: FONTE_MONO }}
            >
              {ev}
            </code>
          </li>
        ))}
        {desconhecidos.map((ev) => (
          <li
            key={ev}
            className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
            style={{ fontFamily: FONTE_MONO }}
          >
            {ev}
          </li>
        ))}
      </ul>

      <p className="text-[11px] text-muted-foreground">
        {t("ultimaEntrega", { quando: quando(e.last_delivery_at) })}
        {e.failure_count > 0
          ? ` · ${t("falhasSeguidas", { n: e.failure_count })}`
          : ""}
      </p>
      {!e.is_active && e.failure_count > 0 ? (
        <p className="text-[11px] text-destructive">{t("desativadoPorFalhas")}</p>
      ) : null}

      {editando !== null ? (
        <div className="space-y-2 rounded-md border border-border p-3">
          <Label className="text-xs">{t("eventos")}</Label>
          <SeletorDeEventos marcados={editando} onChange={setEditando} />
          {editando.length === 0 ? (
            <p className="text-[11px] text-destructive">
              {t("eventosInvalidos")}
            </p>
          ) : null}
          {erroDaEdicao ? (
            <p role="alert" className="text-[11px] text-destructive">
              {erroDaEdicao}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => void salvarEventos()}
              disabled={salvando || editando.length === 0 || editadoIgual}
            >
              {salvando ? t("salvando") : t("salvarEventos")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditando(null);
                setErroDaEdicao(null);
              }}
            >
              {t("cancelar")}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/40 p-2">
        <label className="flex min-w-0 flex-1 items-center gap-2 text-[11px] text-muted-foreground">
          <span className="shrink-0">{t("testeEvento")}</span>
          <select
            value={eventoDoTeste}
            onChange={(ev) => {
              if (isWebhookEvent(ev.target.value)) {
                setEventoDoTeste(ev.target.value);
              }
            }}
            className="h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs text-foreground"
          >
            {assinados.length > 0 ? (
              <optgroup label={t("testeAssinados")}>
                {assinados.map((ev) => (
                  <option key={ev} value={ev}>
                    {rotulos[ev].rotulo} ({ev})
                  </option>
                ))}
              </optgroup>
            ) : null}
            {outros.length > 0 ? (
              <optgroup label={t("testeOutros")}>
                {outros.map((ev) => (
                  <option key={ev} value={ev}>
                    {rotulos[ev].rotulo} ({ev})
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
        </label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={teste?.tipo === "enviando"}
          onClick={() => void enviarTeste()}
        >
          <Send className="size-3.5" />
          {teste?.tipo === "enviando" ? t("enviandoTeste") : t("enviarTeste")}
        </Button>
        <p className="basis-full text-[11px] text-muted-foreground">
          {t("testeAjuda")}
        </p>
        {teste?.tipo === "resultado" ? (
          <p
            role="status"
            className={cn(
              "basis-full text-xs font-medium",
              teste.resultado.ok
                ? "text-emerald-700 dark:text-emerald-300"
                : "text-destructive"
            )}
          >
            {teste.resultado.ok
              ? t("testeEntregue", {
                  status: teste.resultado.status,
                  ms: teste.resultado.ms,
                })
              : t("testeFalhou", {
                  motivo: teste.resultado.motivo
                    ? motivo[teste.resultado.motivo](teste.resultado.status)
                    : t("testeMotivo.outro"),
                })}
          </p>
        ) : null}
        {teste?.tipo === "erro" ? (
          <p role="alert" className="basis-full text-xs text-destructive">
            {teste.mensagem}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {editando === null ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setEditando(assinados);
              setErroDaEdicao(null);
            }}
          >
            <ListChecks className="size-3.5" />
            {t("editarEventos")}
          </Button>
        ) : null}
        <Button type="button" variant="outline" size="sm" onClick={onAlternar}>
          {e.is_active ? t("desligar") : t("religar")}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onApagar}>
          <Trash2 className="size-3.5" />
          {t("apagar")}
        </Button>
      </div>
    </div>
  );
}

function AbaEnviados() {
  const t = useTranslations("Settings.webhooks");
  const [endpoints, setEndpoints] = useState<EndpointDeSaida[] | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [criando, setCriando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [url, setUrl] = useState("");
  // ⚠️ Nasce SEM evento marcado. Nascia com todos — com os eventos de
  // negócio no vocabulário isso despejaria cada mensagem de cliente no n8n
  // de quem só queria acompanhar o funil. O botão Criar exige um.
  const [eventos, setEventos] = useState<WebhookEvent[]>([]);
  const [segredoNovo, setSegredoNovo] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const res = await fetch("/api/cb/webhooks-de-saida");
      if (!res.ok) throw new Error("falhou");
      const corpo = (await res.json()) as { endpoints: EndpointDeSaida[] };
      setEndpoints(corpo.endpoints);
      setFalhou(false);
    } catch {
      setFalhou(true);
      setEndpoints([]);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const criar = async () => {
    setSalvando(true);
    try {
      const res = await fetch("/api/cb/webhooks-de-saida", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, events: eventos }),
      });
      const corpo = (await res.json().catch(() => ({}))) as {
        error?: string;
        segredo?: string;
      };
      if (!res.ok) {
        toast.error(
          corpo.error === "url_invalida"
            ? t("urlInvalida")
            : corpo.error === "eventos_invalidos"
              ? t("eventosInvalidos")
              : t("criarFalhou")
        );
        return;
      }
      if (corpo.segredo) setSegredoNovo(corpo.segredo);
      setUrl("");
      setEventos([]);
      setCriando(false);
      await carregar();
      toast.success(t("criado"));
    } catch {
      toast.error(t("criarFalhou"));
    } finally {
      setSalvando(false);
    }
  };

  const alternar = async (e: EndpointDeSaida) => {
    try {
      const res = await fetch(`/api/cb/webhooks-de-saida/${e.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !e.is_active }),
      });
      if (!res.ok) throw new Error("falhou");
      await carregar();
    } catch {
      toast.error(t("salvarFalhou"));
    }
  };

  const apagar = async (e: EndpointDeSaida) => {
    if (!confirm(t("apagarEndpointConfirma", { url: e.url }))) return;
    try {
      const res = await fetch(`/api/cb/webhooks-de-saida/${e.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("falhou");
      await carregar();
      toast.success(t("apagado"));
    } catch {
      toast.error(t("apagarFalhou"));
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("enviadosAjuda")}</p>
      {/* ⚠️ As limitações da entrega precisam estar na TELA: ela é
          best-effort (uma tentativa, prazo curto, sem retry) e desliga o
          endereço depois de uma sequência de falhas. Sem isso o operador
          conta com garantia que não existe. Os números vêm das constantes
          espelhadas (amarradas ao `deliver.ts` por teste), nunca digitados
          no dicionário. */}
      <p className="text-[11px] text-muted-foreground">
        {t("enviadosLimites", {
          segundos: PRAZO_DA_ENTREGA_SEGUNDOS,
          falhas: FALHAS_QUE_DESLIGAM,
        })}
      </p>
      <Link
        href="/settings?tab=api&aba=docs"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
      >
        <BookOpen className="size-3.5" />
        {t("comoConfigurar")}
      </Link>

      {segredoNovo ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
          <p className="text-xs font-medium text-foreground">
            {t("segredoTitulo")}
          </p>
          <p className="mb-2 mt-1 text-[11px] text-muted-foreground">
            {t("segredoAvisoSaida")}
          </p>
          <CampoParaCopiar valor={segredoNovo} />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2"
            onClick={() => setSegredoNovo(null)}
          >
            {t("segredoGuardei")}
          </Button>
        </div>
      ) : null}

      {criando ? (
        <div className="space-y-3 rounded-md border border-border p-3">
          <div>
            <Label className="text-xs">{t("urlDeDestino")}</Label>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
              className="font-mono text-xs"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              {t("urlDeDestinoAjuda")}
            </p>
          </div>
          <div>
            <Label className="text-xs">{t("eventos")}</Label>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {t("eventosAjuda")}
            </p>
            <SeletorDeEventos marcados={eventos} onChange={setEventos} />
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => void criar()}
              disabled={salvando || !url.trim() || eventos.length === 0}
            >
              {salvando ? t("criando") : t("criar")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setCriando(false)}
            >
              {t("cancelar")}
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" size="sm" onClick={() => setCriando(true)}>
          <Plus className="size-3.5" />
          {t("novoEndpoint")}
        </Button>
      )}

      {falhou ? (
        <p className="text-xs text-destructive">{t("listaFalhou")}</p>
      ) : null}

      {endpoints === null ? (
        <p className="text-xs text-muted-foreground">{t("carregando")}</p>
      ) : endpoints.length === 0 && !falhou ? (
        <p className="text-xs text-muted-foreground">{t("enviadosVazio")}</p>
      ) : (
        <div className="space-y-2">
          {endpoints.map((e) => (
            <CartaoDoEndereco
              key={e.id}
              endpoint={e}
              onMudou={carregar}
              onAlternar={() => void alternar(e)}
              onApagar={() => void apagar(e)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------
// A seção
// ------------------------------------------------------------

export function WebhooksPanel() {
  const t = useTranslations("Settings.webhooks");
  // `?aba=enviados` abre direto na aba Enviados — é para onde a
  // Documentação (Configurações → API) manda quem vai cadastrar um aviso.
  // Lido só na montagem: a sub-aba continua sendo estado local.
  const searchParams = useSearchParams();
  const [aba, setAba] = useState<"recebidos" | "enviados">(() =>
    searchParams.get("aba") === "enviados" ? "enviados" : "recebidos"
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t("titulo")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("descricao")}</p>
      </div>

      <div className="flex gap-4 border-b border-border">
        {(["recebidos", "enviados"] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setAba(id)}
            aria-current={aba === id}
            className={cn(
              "-mb-px border-b-2 px-1 pb-2 text-sm",
              aba === id
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {id === "recebidos" ? t("abaRecebidos") : t("abaEnviados")}
          </button>
        ))}
      </div>

      {aba === "recebidos" ? <AbaRecebidos /> : <AbaEnviados />}
    </div>
  );
}
