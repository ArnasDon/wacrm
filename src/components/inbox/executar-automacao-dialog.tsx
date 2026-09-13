"use client";

// ============================================================
// "Executar automação" — popup do menu + do compositor (referência Kommo,
// adaptada por decisão do operador: botão, nunca "/" no texto).
//
// Lista as automações LIGADAS e os robôs ATIVOS da conta (leitura direta
// sob RLS — policies por conta desde a 017) e dispara pelo POST
// /api/cb/execucoes/executar, que valida grupo/escopo/papel no servidor.
//
// Item fora do escopo de canal da conversa fica VISÍVEL e desabilitado,
// com o motivo — escondê-lo faria o operador achar que a automação sumiu.
// Clique pede confirmação NO LUGAR (a execução pode enviar mensagem real
// ao cliente; não há janela de desfazer aqui).
//
// ⚠️ "O acervo está vazio" antes da primeira resposta já mordeu (953):
// `carregou` nasce false e o estado vazio só aparece depois dela.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { Bot, Loader2, Play, Search, Zap } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { ehGatilhoDaRegua } from "@/lib/asaas/regua";
import { semAcento } from "@/lib/inbox/busca-em-mensagens";
import { avisarExecucoesMudaram } from "@/hooks/use-execucoes-do-contato";

interface AutomacaoDaLista {
  id: string;
  name: string;
  description: string | null;
  /** Escopo de canal (903): vazio/nulo = todos os números. */
  channel_ids: string[] | null;
  /** a régua do Asaas (998) não é oferecida aqui */
  trigger_type: string;
}

interface RoboDaLista {
  id: string;
  name: string;
  /** Escopo SINGULAR (903): nulo = todos os números. */
  channel_id: string | null;
}

type Selecao =
  | { tipo: "automacao"; id: string; nome: string }
  | { tipo: "robo"; id: string; nome: string };

interface ExecutarAutomacaoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  contactName: string;
  /** Canal da conversa (`conversations.channel_id`); null = desconhecido. */
  channelId: string | null;
}

export function ExecutarAutomacaoDialog({
  open,
  onOpenChange,
  conversationId,
  contactName,
  channelId,
}: ExecutarAutomacaoDialogProps) {
  const t = useTranslations("Inbox.execucoes.executar");

  const [automacoes, setAutomacoes] = useState<AutomacaoDaLista[]>([]);
  const [robos, setRobos] = useState<RoboDaLista[]>([]);
  const [carregou, setCarregou] = useState(false);
  const [erroCarga, setErroCarga] = useState(false);
  const [busca, setBusca] = useState("");
  const [selecao, setSelecao] = useState<Selecao | null>(null);
  const [executando, setExecutando] = useState(false);

  useEffect(() => {
    if (!open) return;
    // Estado zerado A CADA abertura: a lista muda pouco, mas o custo do
    // refetch é pequeno e o estado velho custa caro (lição do acervo).
    setCarregou(false);
    setErroCarga(false);
    setBusca("");
    setSelecao(null);

    const supabase = createClient();
    let cancelado = false;
    void (async () => {
      const [autosRes, robosRes] = await Promise.all([
        supabase
          .from("automations")
          .select("id, name, description, channel_ids, trigger_type")
          .eq("is_active", true)
          .order("name"),
        supabase
          .from("flows")
          .select("id, name, channel_id")
          .eq("status", "active")
          .order("name"),
      ]);
      if (cancelado) return;
      if (autosRes.error || robosRes.error) {
        console.error(
          "[executar] carga falhou:",
          autosRes.error?.message ?? robosRes.error?.message,
        );
        setErroCarga(true);
      } else {
        setAutomacoes((autosRes.data ?? []) as AutomacaoDaLista[]);
        setRobos((robosRes.data ?? []) as RoboDaLista[]);
      }
      setCarregou(true);
    })();
    return () => {
      cancelado = true;
    };
  }, [open]);

  // ⚠️ `semAcento` como o resto do inbox: com o `.toLowerCase()` cru,
  // "cobranca" não achava "Cobrança" e o dialog dizia "Nada casa com a
  // busca" sobre item existente (ledger 48h).
  const termo = semAcento(busca.trim());
  // A régua do Asaas (998) só roda pela varredura: por aqui sairia com as
  // `{{vars.*}}` vazias, sem reconfirmar o pagamento e sem trava — a rota
  // também recusa (`runAutomationById`), mas oferecer o botão seria mentir.
  const automacoesVisiveis = useMemo(
    () =>
      automacoes.filter((a) => !ehGatilhoDaRegua(a.trigger_type) && (!termo || semAcento(a.name).includes(termo))),
    [automacoes, termo],
  );
  const robosVisiveis = useMemo(
    () =>
      termo ? robos.filter((r) => semAcento(r.name).includes(termo)) : robos,
    [robos, termo],
  );

  // Falha ABERTA, como o motor: canal da conversa desconhecido (pré-903)
  // não desabilita nada — o envio resolve o canal padrão, igual aos gatilhos.
  function automacaoForaDoCanal(a: AutomacaoDaLista): boolean {
    if (!a.channel_ids || a.channel_ids.length === 0 || !channelId) return false;
    return !a.channel_ids.includes(channelId);
  }
  function roboForaDoCanal(r: RoboDaLista): boolean {
    return Boolean(r.channel_id && channelId && r.channel_id !== channelId);
  }

  async function executar() {
    if (!selecao) return;
    setExecutando(true);
    try {
      const res = await fetch("/api/cb/execucoes/executar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversationId,
          tipo: selecao.tipo,
          id: selecao.id,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        detail?: string;
      };
      if (!res.ok) {
        if (data.error === "channel_out_of_scope") toast.error(t("foraDoCanal"));
        else if (data.error === "stage_out_of_scope") toast.error(t("foraDaEtapa"));
        else if (data.error === "inactive") toast.error(t("inativa"));
        else if (data.error === "engine_refused" && data.detail)
          toast.error(data.detail);
        else toast.error(t("erro"));
        return;
      }
      toast.success(
        selecao.tipo === "robo" ? t("roboIniciado") : t("automacaoDisparada"),
      );
      // A aba Automações do painel vive em outra árvore — o evento global a
      // faz recarregar sem fiar callback por page → thread → composer.
      avisarExecucoesMudaram();
      onOpenChange(false);
    } catch {
      toast.error(t("erro"));
    } finally {
      setExecutando(false);
    }
  }

  function LinhaDeItem({
    icone,
    nome,
    descricao,
    fora,
    onClick,
  }: {
    icone: React.ReactNode;
    nome: string;
    descricao?: string | null;
    fora: boolean;
    onClick: () => void;
  }) {
    return (
      <button
        type="button"
        disabled={fora}
        onClick={onClick}
        className="border-border bg-muted/40 hover:border-primary/50 hover:bg-muted flex w-full items-center gap-2 rounded-md border p-2.5 text-left disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border disabled:hover:bg-muted/40"
      >
        {icone}
        <span className="min-w-0 flex-1">
          <span className="text-foreground block truncate text-sm font-medium">
            {nome}
          </span>
          {/* Fora do escopo, o MOTIVO ocupa a linha de baixo — é a
              informação que decide, a descrição pode esperar. */}
          {fora ? (
            <span className="text-muted-foreground block text-xs">
              {t("foraDoCanal")}
            </span>
          ) : descricao ? (
            <span className="text-muted-foreground block truncate text-xs">
              {descricao}
            </span>
          ) : null}
        </span>
      </button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("titulo")}</DialogTitle>
        </DialogHeader>

        {selecao ? (
          /* ---- Confirmação: mensagens reais podem sair daqui. ---- */
          /* min-w-0: filho de grid (DialogContent) nasce com min-width:auto,
             e a descrição em `truncate` (nowrap) infla o intrínseco — o
             card ficava com 448px e o conteúdo com 1124px (medido). */
          <div className="min-w-0 space-y-4">
            <p className="text-foreground text-sm">
              {t("confirmarTexto", { nome: selecao.nome, contato: contactName })}
            </p>
            <p className="text-muted-foreground text-xs">{t("avisoEnvio")}</p>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={executando}
                onClick={() => setSelecao(null)}
              >
                {t("voltar")}
              </Button>
              <Button size="sm" disabled={executando} onClick={() => void executar()}>
                {executando ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Play className="size-3.5" />
                )}
                {t("executar")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="min-w-0 space-y-3">
            <div className="relative">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2" />
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder={t("buscar")}
                className="pl-8"
              />
            </div>

            <div className="max-h-[55vh] space-y-4 overflow-y-auto">
              {!carregou ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
                </div>
              ) : erroCarga ? (
                <p className="text-muted-foreground py-8 text-center text-sm">
                  {t("erroCarregar")}
                </p>
              ) : automacoesVisiveis.length === 0 && robosVisiveis.length === 0 ? (
                <p className="text-muted-foreground py-8 text-center text-sm">
                  {termo ? t("nadaNaBusca") : t("nadaDisponivel")}
                </p>
              ) : (
                <>
                  {automacoesVisiveis.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-muted-foreground text-xs font-semibold uppercase">
                        {t("grupoAutomacoes")}
                      </p>
                      {automacoesVisiveis.map((a) => (
                        <LinhaDeItem
                          key={a.id}
                          icone={<Zap className="text-primary h-4 w-4 shrink-0" />}
                          nome={a.name}
                          descricao={a.description}
                          fora={automacaoForaDoCanal(a)}
                          onClick={() =>
                            setSelecao({ tipo: "automacao", id: a.id, nome: a.name })
                          }
                        />
                      ))}
                    </div>
                  )}
                  {robosVisiveis.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-muted-foreground text-xs font-semibold uppercase">
                        {t("grupoRobos")}
                      </p>
                      {robosVisiveis.map((r) => (
                        <LinhaDeItem
                          key={r.id}
                          icone={<Bot className="text-primary h-4 w-4 shrink-0" />}
                          nome={r.name}
                          fora={roboForaDoCanal(r)}
                          onClick={() =>
                            setSelecao({ tipo: "robo", id: r.id, nome: r.name })
                          }
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
