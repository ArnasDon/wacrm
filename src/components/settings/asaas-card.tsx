"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Copy, Receipt, RefreshCw, Search, Zap } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { avisarAsaasMudou } from "@/lib/asaas/aviso";
import { AVISAR_EXPIRACAO_EM_DIAS, codigoConhecido, type CartaoDoAsaas, type WebhookDoCartao } from "@/lib/asaas/cartao";
import type { MotivoDoVinculo, RelatorioDoLevantamento } from "@/lib/asaas/levantamento";
import type { ResumoDoEspelho } from "@/lib/asaas/listas";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";

import { AsaasListas } from "./asaas-listas";
import { SettingsChip } from "./settings-chip";

/**
 * O cartão "Asaas" da aba Integrações (992/994). Guarda a chave da API
 * (testada e cifrada pela rota), mostra o RESUMO do espelho — quantos
 * clientes do Asaas, quantos ligados a uma ficha, quantos para confirmar,
 * sem ficha e inadimplentes —, dispara a sincronização e abre as cinco
 * listas (`asaas-listas.tsx`) onde uma pessoa liga, desliga e ignora. O
 * LEVANTAMENTO da Fase 0 (só leitura) continua disponível, atrás de um
 * botão menor.
 *
 * ⚠️ Os NÚMEROS do resumo somem enquanto a carga corre ou falha (a regra da
 * tela de agendadas): "Inadimplentes: 0" por um segundo, ou depois de um
 * 500, afirmaria o contrário do que a conta tem. Quando uma RECARGA falha,
 * a resposta anterior fica em memória (o formulário e os botões continuam
 * de pé), mas o resumo é ESCONDIDO e o chip vira vermelho — número velho
 * com cara de número atual é o mesmo erro (achado da revisão do PR #201).
 *
 * Só admin chega aqui (a aba inteira é admin). Nenhuma chave volta da rota;
 * o campo nasce vazio sempre.
 */

interface Resposta {
  cartao: CartaoDoAsaas;
  resumo: ResumoDoEspelho;
  leituraFresca: boolean;
  guardado: { clientes: number; cobrancas: number };
  /** a URL registrada no Asaas (só para conferência); `null` sem token ou sem endereço público */
  webhookUrl: string | null;
  origemAlcancavel: boolean;
  /** o botão "Ativar" funciona A PARTIR deste host (o preview carrega a URL da produção e não pode criar) */
  podeCriarDaqui: boolean;
}

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
  const [dados, setDados] = useState<Resposta | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [chave, setChave] = useState("");
  const [nome, setNome] = useState("");
  const [validade, setValidade] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [desconectando, setDesconectando] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [levantando, setLevantando] = useState(false);
  const [relatorio, setRelatorio] = useState<RelatorioDoLevantamento | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [mostrarListas, setMostrarListas] = useState(false);
  const [webhookAcao, setWebhookAcao] = useState<"ativar" | "religar" | "desativar" | null>(null);
  const [versao, setVersao] = useState(0);
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
      const corpo = (await res.json()) as Resposta;
      if (vivoRef.current) {
        setDados(corpo);
        setFalhou(false);
        tinhaDadosRef.current = true;
        setVersao((v) => v + 1);
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
      avisarAsaasMudou();
      // a primeira sincronização roda em `after()` na rota
      setTimeout(() => void carregar(), 6000);
      await carregar();
    } finally {
      if (vivoRef.current) setSalvando(false);
    }
  };

  const desconectar = async (apagarEspelho: boolean) => {
    if (desconectando) return;
    const guardado = dados?.guardado ?? { clientes: 0, cobrancas: 0 };
    const pergunta = apagarEspelho ? t("asaas.confirmarApagar", { clientes: guardado.clientes, cobrancas: guardado.cobrancas }) : t("asaas.confirmarDesconectar");
    if (!window.confirm(pergunta)) return;
    setDesconectando(true);
    try {
      const res = await fetch(`/api/cb/asaas/config${apagarEspelho ? "?espelho=1" : ""}`, { method: "DELETE" });
      const corpo = (await res.json().catch(() => ({}))) as { error?: string; webhookNaoApagado?: boolean };
      if (!res.ok) {
        toast.error(corpo.error ? t("falha", { motivo: motivo(corpo.error) }) : t("salvarFalhou"));
        return;
      }
      // O Asaas não aceitou o DELETE do webhook (chave já inválida, rede):
      // ele insistiria por horas numa URL que não responde mais.
      if (corpo.webhookNaoApagado) toast.warning(t("asaas.webhook.naoApagado"), { duration: 12_000 });
      setRelatorio(null);
      setMostrarListas(false);
      avisarAsaasMudou();
      await carregar();
    } finally {
      if (vivoRef.current) setDesconectando(false);
    }
  };

  const sincronizar = async (completa: boolean) => {
    setSincronizando(true);
    setErro(null);
    try {
      const res = await fetch("/api/cb/asaas/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ completa }) });
      if (!res.ok) {
        toast.error(t("salvarFalhou"));
        return;
      }
      toast.success(t("asaas.sincronizacaoPedida"));
      // 202: o trabalho corre em `after()`; dá um tempo e relê.
      await new Promise((r) => setTimeout(r, 6000));
      avisarAsaasMudou();
      await carregar();
    } finally {
      if (vivoRef.current) setSincronizando(false);
    }
  };

  const mexerNoWebhook = async (acao: "ativar" | "religar" | "desativar") => {
    if (webhookAcao) return;
    if (acao === "desativar" && !window.confirm(t("asaas.webhook.confirmarDesativar"))) return;
    setWebhookAcao(acao);
    try {
      const res =
        acao === "desativar"
          ? await fetch("/api/cb/asaas/webhook", { method: "DELETE" })
          : await fetch("/api/cb/asaas/webhook", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acao }) });
      const corpo = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(t("falha", { motivo: motivo(corpo.error ?? "asaas_error") }));
        return;
      }
      toast.success(t(acao === "ativar" ? "asaas.webhook.ativado" : acao === "religar" ? "asaas.webhook.religado" : "asaas.webhook.desativado"));
      await carregar();
    } finally {
      if (vivoRef.current) setWebhookAcao(null);
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

  const cartao = dados?.cartao ?? null;
  const resumo = dados?.resumo ?? null;
  const estado = cartao?.estado ?? "nao_conectado";
  // ⚠️ O chip fica no cabeçalho, sempre visível, e é uma AFIRMAÇÃO. Enquanto
  // a carga corre — ou quando ela falha — dizer "Não conectada" acusa de
  // desconexão uma integração que pode estar de pé (regra do Meta Ads).
  const [variante, rotuloDoChip] =
    cartao === null && !falhou
      ? (["muted", t("chipConferindo")] as const)
      : falhou
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

  const quando = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });

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
              {dados && dados.guardado.clientes > 0 && (
                <p className="max-w-[62ch] text-xs text-amber-600 dark:text-amber-400">
                  {t("asaas.espelhoGuardado", { clientes: dados.guardado.clientes, cobrancas: dados.guardado.cobrancas })}
                </p>
              )}
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
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => void sincronizar(false)} disabled={sincronizando || !!cartao.sincronizandoDesde}>
                    <RefreshCw className={cn("size-4", sincronizando && "animate-spin")} />
                    {sincronizando ? t("asaas.sincronizando") : t("asaas.sincronizar")}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => void sincronizar(true)} disabled={sincronizando || !!cartao.sincronizandoDesde} title={t("asaas.sincronizarTudoDica")}>
                    {t("asaas.sincronizarTudo")}
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => void desconectar(false)} disabled={desconectando}>
                    {t("asaas.desconectar")}
                  </Button>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                {cartao.sincronizandoDesde ? `${t("asaas.sincronizandoDesde", { quando: quando(cartao.sincronizandoDesde) })} · ` : ""}
                {cartao.ultimaSync ? t("asaas.ultimaSync", { quando: quando(cartao.ultimaSync) }) : t("asaas.nuncaSincronizado")}
                {cartao.ultimaTentativa && cartao.ultimaTentativa !== cartao.ultimaSync ? ` · ${t("asaas.ultimaTentativa", { quando: quando(cartao.ultimaTentativa) })}` : ""}
                {cartao.vencidasListadasEm && !dados?.leituraFresca ? ` · ${t("asaas.leituraAntiga", { quando: quando(cartao.vencidasListadasEm) })}` : ""}
              </p>

              {cartao.sandbox && <p className="text-xs text-amber-600 dark:text-amber-400">{t("asaas.sandboxAviso")}</p>}
              {avisoDaChave && (
                <p className={cn("text-xs", cartao.diasAteExpirar !== null && cartao.diasAteExpirar <= AVISAR_EXPIRACAO_EM_DIAS ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>
                  {avisoDaChave}
                </p>
              )}
              {cartao.erro && <p className="text-xs text-destructive">{t("falha", { motivo: motivo(cartao.erro) })}</p>}
              {erro && <p className="text-xs text-destructive">{t("falha", { motivo: erro })}</p>}

              {falhou && <p className="text-xs text-destructive">{t("recarregarFalhou")}</p>}

              {dados && (
                <BlocoDoWebhook
                  webhook={cartao.webhook}
                  url={dados.webhookUrl}
                  origemAlcancavel={dados.origemAlcancavel}
                  podeCriarDaqui={dados.podeCriarDaqui}
                  acaoEmCurso={webhookAcao}
                  aoMexer={(acao) => void mexerNoWebhook(acao)}
                  motivo={motivo}
                  quando={quando}
                  t={t}
                />
              )}

              {resumo && !falhou && (
                <div className="rounded-md border border-border bg-muted/30 p-3 text-xs">
                  <p className="text-foreground">
                    {t("asaas.resumo.clientes", { n: resumo.clientes })}
                    {" · "}
                    <span className="font-medium">{t("asaas.resumo.ligados", { n: resumo.ligados })}</span>
                    {resumo.ligados > 0
                      ? ` (${t("asaas.resumo.ligadosDetalhe", {
                          telefone: (resumo.ligadosPorOrigem.telefone ?? 0) + (resumo.ligadosPorOrigem.cpf ?? 0) + (resumo.ligadosPorOrigem.email ?? 0),
                          criadas: resumo.ligadosPorOrigem.criada ?? 0,
                          manual: resumo.ligadosPorOrigem.manual ?? 0,
                        })})`
                      : ""}
                    {" · "}
                    <span className={cn(resumo.confirmar > 0 && "font-medium text-amber-600 dark:text-amber-400")}>{t("asaas.resumo.confirmar", { n: resumo.confirmar })}</span>
                    {" · "}
                    {t("asaas.resumo.semFicha", { n: resumo.semFicha })}
                    {" · "}
                    <span className={cn(resumo.inadimplentes > 0 && "font-medium text-red-700 dark:text-red-300")}>{t("asaas.resumo.inadimplentes", { n: resumo.inadimplentes })}</span>
                    {resumo.inadimplentes > 0
                      ? ` (${t("asaas.resumo.inadimplentesDetalhe", { valor: formatCurrency(resumo.valorVencido), parcelas: resumo.parcelasVencidas, semFicha: resumo.inadimplentesSemFicha })})`
                      : ""}
                    {resumo.comMaisDeTresParcelas > 0 ? ` · ${t("asaas.resumo.maisDeTres", { n: resumo.comMaisDeTresParcelas })}` : ""}
                    {resumo.parcelasEmConferencia > 0 ? (
                      <span className="text-amber-600 dark:text-amber-400">{` · ${t("asaas.resumo.emConferencia", { n: resumo.parcelasEmConferencia, valor: formatCurrency(resumo.valorEmConferencia) })}`}</span>
                    ) : ""}
                    {resumo.statusDesconhecidos > 0 ? ` · ${t("asaas.resumo.desconhecidos", { n: resumo.statusDesconhecidos })}` : ""}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => setMostrarListas((m) => !m)}>
                      {mostrarListas ? t("asaas.esconderListas") : t("asaas.verListas")}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => void levantar()} disabled={levantando}>
                      <Search className={cn("size-4", levantando && "animate-pulse")} />
                      {levantando ? t("asaas.levantando") : t("asaas.levantar")}
                    </Button>
                  </div>
                </div>
              )}

              {mostrarListas && <AsaasListas resumo={resumo} versao={versao} aoMudar={() => void carregar()} />}

              {relatorio && <Relatorio relatorio={relatorio} t={t} onCopiar={() => void copiarRelatorio()} copiado={copiado} />}

              <p className="text-xs text-muted-foreground">
                <button type="button" className="underline" onClick={() => void desconectar(true)} disabled={desconectando}>
                  {t("asaas.desconectarEApagar")}
                </button>{" "}
                {t("asaas.desconectarEApagarDica")}
              </p>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * O bloco "Aviso na hora" (997): o estado do webhook, para quem vão os
 * alertas, a URL registrada e os três gestos. ⚠️ O estado NULO é "nunca
 * tentado" — o cron cria no próximo ciclo —, e o bloco DIZ isso em vez de
 * afirmar "desligado": afirmar o contrário do que vai acontecer em 15 min
 * é a mesma família do chip "Não conectada" durante a carga.
 */
function BlocoDoWebhook({
  webhook,
  url,
  origemAlcancavel,
  podeCriarDaqui,
  acaoEmCurso,
  aoMexer,
  motivo,
  quando,
  t,
}: {
  webhook: WebhookDoCartao;
  url: string | null;
  origemAlcancavel: boolean;
  podeCriarDaqui: boolean;
  acaoEmCurso: "ativar" | "religar" | "desativar" | null;
  aoMexer: (acao: "ativar" | "religar" | "desativar") => void;
  motivo: (codigo: string) => string;
  quando: (iso: string) => string;
  t: ReturnType<typeof useTranslations<"Settings.integracoes">>;
}) {
  const estado = webhook.estado;
  const precisaDeGente = estado === "ausente" || estado === "desligado" || estado === "sem_permissao" || estado === "erro";
  const ativo = estado === "ativo" || estado === "penalizado";
  const corDoEstado =
    estado === "interrompido" || estado === "erro" || estado === "ausente"
      ? "text-destructive"
      : estado === "penalizado" || estado === "sem_permissao"
        ? "text-amber-600 dark:text-amber-400"
        : "text-muted-foreground";
  // chave montada: `asaas.webhook.estado.<estado>` — a lista fechada mora em
  // `lib/asaas/cartao.ts` (ESTADOS_DO_WEBHOOK) e há teste cobrando cada uma.
  // Sem endereço público não há "o agendador cria no próximo ciclo": o
  // aviso `semEndereco` logo abaixo é a única afirmação verdadeira.
  const frase = estado ? t(`asaas.webhook.estado.${estado}` as Parameters<typeof t>[0]) : origemAlcancavel ? t("asaas.webhook.nunca") : t("asaas.webhook.semEnderecoCurto");
  return (
    <div className="min-w-0 space-y-2 rounded-md border border-border bg-muted/30 p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 font-medium text-foreground">
          <Zap className="size-3.5" aria-hidden="true" />
          {t("asaas.webhook.titulo")}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {(precisaDeGente || estado === null) && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => aoMexer("ativar")}
              disabled={acaoEmCurso !== null || !podeCriarDaqui}
              title={!origemAlcancavel ? t("asaas.webhook.semEndereco") : !podeCriarDaqui ? t("asaas.webhook.soDaProducao") : undefined}
            >
              {acaoEmCurso === "ativar" ? t("asaas.webhook.ativando") : precisaDeGente ? t("asaas.webhook.tentarDeNovo") : t("asaas.webhook.ativar")}
            </Button>
          )}
          {estado === "interrompido" && (
            <Button type="button" variant="outline" size="sm" onClick={() => aoMexer("religar")} disabled={acaoEmCurso !== null || !podeCriarDaqui} title={!podeCriarDaqui ? t("asaas.webhook.soDaProducao") : undefined}>
              {t("asaas.webhook.religar")}
            </Button>
          )}
          {webhook.registrado && (
            <Button type="button" variant="ghost" size="sm" onClick={() => aoMexer("desativar")} disabled={acaoEmCurso !== null || !podeCriarDaqui} title={!podeCriarDaqui ? t("asaas.webhook.soDaProducao") : undefined}>
              {t("asaas.webhook.desativar")}
            </Button>
          )}
        </div>
      </div>
      <p className="max-w-[62ch] text-muted-foreground">{t("asaas.webhook.desc")}</p>
      <p className={corDoEstado}>
        {frase}
        {estado === "erro" && webhook.erro ? `: ${motivo(webhook.erro)}` : ""}
        {ativo ? ` · ${webhook.ultimoEvento ? t("asaas.webhook.ultimoEvento", { quando: quando(webhook.ultimoEvento) }) : t("asaas.webhook.semEvento")}` : ""}
        {webhook.conferidoEm && webhook.registrado ? ` · ${t("asaas.webhook.conferidoEm", { quando: quando(webhook.conferidoEm) })}` : ""}
      </p>
      {/* O último erro aparece SEMPRE que existe: rede e cota mantêm o
          estado nulo e a tela diria "ainda não criado" para sempre, com o
          motivo real invisível. */}
      {webhook.erro && estado !== "erro" && <p className="text-amber-600 dark:text-amber-400">{t("asaas.webhook.ultimoErro", { motivo: motivo(webhook.erro) })}</p>}
      {webhook.email && webhook.registrado && <p className="text-muted-foreground">{t("asaas.webhook.email", { email: webhook.email })}</p>}
      {!origemAlcancavel && <p className="text-destructive">{t("asaas.webhook.semEndereco")}</p>}
      {url && webhook.registrado && (
        <div className="space-y-1">
          <Label>{t("asaas.webhook.urlLabel")}</Label>
          <Input value={url} readOnly className="font-mono text-xs" />
          <p className="text-muted-foreground">{t("asaas.webhook.urlHint")}</p>
        </div>
      )}
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
