"use client";

// ============================================================
// Aba "Cobranças" do painel da conversa E da ficha de Contatos (Fase 1b do
// plano do Asaas): os clientes do Asaas ligados a este contato e as parcelas
// deles — vencidas, em conferência, pendentes, regularizadas, estornadas.
//
// Os dados chegam por props (hook `useCobrancasDoContato`, chamado no TOPO
// do painel como as outras buscas — a etiqueta da aba precisa do número
// antes de a aba abrir). A repartição é pura (`separarParcelas`), com o
// relógio da tela.
//
// ⚠️ Três estados que NÃO podem virar "em dia": carregando (spinner),
// falhou (aviso + tentar de novo) e Asaas desconectado (aviso). E "nenhuma
// parcela vencida" só sai com leitura FRESCA, o ciclo da listagem vigente
// terminado e nenhuma parcela em conferência — senão a aba diz que não sabe.
//
// ⚠️ `LinhaDaParcela` e `SecaoDeParcelas` moram FORA do componente: definidas
// dentro, o React as trataria como tipos novos a cada render e remontaria
// as `<li>` — o botão "Copiar link" recém-clicado seria destruído e o foco
// cairia no `<body>` (revisão independente do PR #203).
// ============================================================

import { useState } from "react";
import { BellOff, BellRing, Check, CircleDollarSign, Copy, ExternalLink, Loader2, RefreshCw, Unlink } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useCan } from "@/hooks/use-can";
import { avisarAsaasMudou } from "@/lib/asaas/aviso";
import { leituraAindaFresca, REGULARIZADAS_DIAS, separarParcelas, type RespostaDoContato } from "@/lib/asaas/aviso-na-conversa";
import { classificar, diaPorExtenso, diasDeAtraso, dinheiro, rotuloDaParcela, valorAtualizado, type ParcelaDoEspelho } from "@/lib/asaas/inadimplencia";
import { cn } from "@/lib/utils";

import { TituloDeSecao } from "./titulo-de-secao";

interface AbaCobrancasProps {
  dados: RespostaDoContato | null;
  /**
   * ⚠️ Obrigatórias de propósito (o padrão de `aba-arquivos.tsx`): sem
   * `carregando`, a aba afirmaria "nenhuma parcela vencida" enquanto a
   * consulta está no ar — a armadilha do efeito passivo.
   */
  carregando: boolean;
  falhou: boolean;
  recarregar: () => void;
}

const ORIGENS = new Set(["telefone", "cpf", "email", "criada", "manual", "desvinculado"]);

function quandoFoi(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

type T = ReturnType<typeof useTranslations<"Inbox.cobrancas">>;

function LinhaDaParcela({ p, devida, agora, copiada, onCopiar, t }: { p: ParcelaDoEspelho; devida: boolean; agora: Date; copiada: boolean; onCopiar: (p: ParcelaDoEspelho) => void; t: T }) {
  const dias = devida ? diasDeAtraso(p.vencimento, agora) : null;
  const classe = classificar(p.status, p.deleted);
  const atualizado = valorAtualizado(p);
  return (
    <li className="border-border bg-muted/40 rounded-md border px-2.5 py-2 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-foreground truncate font-medium">
            {rotuloDaParcela(p)}
            {classe === "negativada" && (
              <span className="ml-1 rounded-full bg-red-500/15 px-1.5 py-px text-[10px] font-semibold uppercase text-red-700 dark:text-red-300">{t("negativada")}</span>
            )}
          </p>
          <p className="text-muted-foreground">
            {t("vencimento", { dia: diaPorExtenso(p.vencimento) })}
            {devida && dias !== null && (
              <>
                {" · "}
                <span className={dias >= 0 ? "text-red-700 dark:text-red-300" : undefined}>{dias >= 0 ? t("diasDeAtraso", { dias }) : t("prorrogada")}</span>
              </>
            )}
            {classe === "paga" && p.pago_em && <span> · {t("pagaEm", { dia: diaPorExtenso(p.pago_em.slice(0, 10)) })}</span>}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className={cn("font-semibold", devida ? "text-red-700 dark:text-red-300" : "text-foreground")}>{dinheiro(p.valor)}</p>
          {devida && atualizado > p.valor && <p className="text-muted-foreground text-[11px]">{t("valorAtualizado", { valor: dinheiro(atualizado) })}</p>}
        </div>
      </div>
      {devida && (p.link_boleto || p.link_fatura) && (
        <p className="mt-1 flex flex-wrap gap-2">
          {/* O link da FATURA (mostra o valor atualizado e todas as formas
              de pagamento), para colar na conversa. Boleto só na falta. */}
          <button type="button" onClick={() => onCopiar(p)} className="text-primary inline-flex items-center gap-0.5 hover:underline">
            {copiada ? <Check className="h-3 w-3" aria-hidden="true" /> : <Copy className="h-3 w-3" aria-hidden="true" />}
            {copiada ? t("linkCopiado") : t("copiarLink")}
          </button>
          {p.link_boleto && (
            <a href={p.link_boleto} target="_blank" rel="noopener noreferrer" className="text-primary inline-flex items-center gap-0.5 hover:underline">
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
              {t("boleto")}
            </a>
          )}
          {p.link_fatura && (
            <a href={p.link_fatura} target="_blank" rel="noopener noreferrer" className="text-primary inline-flex items-center gap-0.5 hover:underline">
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
              {t("fatura")}
            </a>
          )}
        </p>
      )}
    </li>
  );
}

function SecaoDeParcelas({ titulo, dica, parcelas, devida, agora, copiada, onCopiar, t }: { titulo: string; dica?: string; parcelas: ParcelaDoEspelho[]; devida: boolean; agora: Date; copiada: string | null; onCopiar: (p: ParcelaDoEspelho) => void; t: T }) {
  if (parcelas.length === 0) return null;
  return (
    <div>
      <TituloDeSecao className="mb-1.5">{titulo}</TituloDeSecao>
      {dica && <p className="text-muted-foreground/70 mb-1.5 px-1 text-[11px]">{dica}</p>}
      <ul className="space-y-1.5">
        {parcelas.map((p) => (
          <LinhaDaParcela key={p.id} p={p} devida={devida} agora={agora} copiada={copiada === p.id} onCopiar={onCopiar} t={t} />
        ))}
      </ul>
    </div>
  );
}

export function AbaCobrancas({ dados, carregando, falhou, recarregar }: AbaCobrancasProps) {
  const t = useTranslations("Inbox.cobrancas");
  // O nome da origem do vínculo é o MESMO do cartão do Asaas em
  // Configurações — uma tradução só.
  const tAsaas = useTranslations("Settings.integracoes.asaas");
  // Desligar um cliente é ação de ADMINISTRADOR (a rota exige `admin`);
  // `manage-members` é o gate de admin deste projeto.
  const podeDesligar = useCan("manage-members");
  const [desligando, setDesligando] = useState<string | null>(null);
  /** id do cliente cuja exceção da cobrança automática está sendo trocada */
  const [trocandoRegua, setTrocandoRegua] = useState<string | null>(null);
  /** Id da parcela cujo link acabou de ser copiado (o "Copiado" some em 2 s). */
  const [copiada, setCopiada] = useState<string | null>(null);

  async function copiarLink(p: ParcelaDoEspelho) {
    const link = p.link_fatura ?? p.link_boleto;
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopiada(p.id);
      setTimeout(() => setCopiada((atual) => (atual === p.id ? null : atual)), 2000);
    } catch {
      toast.error(t("erroCopiar"));
    }
  }

  async function desligar(clienteId: string) {
    setDesligando(clienteId);
    try {
      const res = await fetch(`/api/cb/asaas/clientes/${clienteId}/vinculo`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao: "desligar" }),
      });
      if (!res.ok) {
        toast.error(t("erroDesligar"));
        return;
      }
      toast.success(t("desligado"));
      // A lista (ícone e filtro), a faixa e esta aba releem pelo evento.
      avisarAsaasMudou();
      recarregar();
    } catch {
      toast.error(t("erroDesligar"));
    } finally {
      setDesligando(null);
    }
  }

  // A LISTA DE EXCEÇÃO da cobrança automática (998, D21): por cliente do
  // Asaas, decisão de administrador, com quem e quando carimbados na rota.
  async function trocarRegua(clienteId: string, desligada: boolean) {
    setTrocandoRegua(clienteId);
    try {
      const res = await fetch(`/api/cb/asaas/clientes/${clienteId}/regua`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ desligada }),
      });
      if (!res.ok) {
        toast.error(t("regua.erroTrocar"));
        return;
      }
      toast.success(t(desligada ? "regua.desligadaParaEste" : "regua.religadaParaEste"));
      avisarAsaasMudou();
      recarregar();
    } catch {
      toast.error(t("regua.erroTrocar"));
    } finally {
      setTrocandoRegua(null);
    }
  }

  if (carregando) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (falhou || !dados) {
    return (
      <div className="py-4 text-center">
        <p className="text-muted-foreground text-sm">{t("erroCarregar")}</p>
        <Button size="sm" variant="outline" className="mt-3" onClick={recarregar}>
          <RefreshCw className="size-3.5" />
          {t("tentarDeNovo")}
        </Button>
      </div>
    );
  }

  if (!dados.conectado) {
    return (
      <div className="py-6 text-center">
        <CircleDollarSign className="text-muted-foreground/40 mx-auto h-8 w-8" />
        <p className="text-muted-foreground mt-2 text-sm">{t("naoConectado")}</p>
        <p className="text-muted-foreground/70 mt-1 text-xs">{t("naoConectadoDica")}</p>
      </div>
    );
  }

  if (dados.clientes.length === 0) {
    // ⚠️ Sem o ciclo da listagem vigente terminado (`atualizadoEm` nulo:
    // recém-conectado, a primeira sincronização no ar ou falhada; ou
    // `cicloCompleto` falso: o vínculo desta listagem ainda por rodar) o
    // espelho ainda não tem os clientes — "nenhum cliente ligado" seria
    // afirmação sobre o que não se sabe (Codex, PR #203). O vazio de verdade
    // é o do ciclo inteiro que não achou vínculo.
    const semListagem = dados.atualizadoEm === null || !dados.cicloCompleto;
    return (
      <div className="py-6 text-center">
        <CircleDollarSign className="text-muted-foreground/40 mx-auto h-8 w-8" />
        <p className={cn("mt-2 text-sm", semListagem ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>
          {semListagem ? t("semListagem") : t("semCliente")}
        </p>
        {!semListagem && <p className="text-muted-foreground/70 mt-1 text-xs">{t("semClienteDica")}</p>}
      </div>
    );
  }

  // O relógio da tela: os dias de atraso são calculados na leitura, nunca
  // gravados (`inadimplencia.ts`). Precedente de `aba-automacoes.tsx`.
  const agora = new Date();
  const { divida, regularizadas, estornadas, aVencer } = separarParcelas(dados.parcelas, agora, dados.atualizadoEm);
  const quando = dados.atualizadoEm ? quandoFoi(dados.atualizadoEm) : null;
  // Pelo relógio da tela, não pelo booleano da resposta: a aba fica aberta
  // e a resposta envelhece — ver `leituraAindaFresca`.
  const fresca = leituraAindaFresca(dados, agora);
  const secao = { agora, copiada, onCopiar: (p: ParcelaDoEspelho) => void copiarLink(p), t };

  return (
    <div className="space-y-4">
      <div>
        <TituloDeSecao className="mb-1.5">{t("clientes")}</TituloDeSecao>
        <ul className="space-y-1.5">
          {dados.clientes.map((c) => (
            <li key={c.id} className="border-border bg-muted/40 flex items-center gap-2 rounded-md border px-2.5 py-2 text-xs">
              <div className="min-w-0 flex-1">
                <p className="text-foreground truncate font-medium">{c.nome || c.asaasId}</p>
                <p className="text-muted-foreground truncate">
                  {c.origem && ORIGENS.has(c.origem) ? tAsaas(`origem.${c.origem}` as Parameters<typeof tAsaas>[0]) : c.asaasId}
                  {c.notificacoesDesligadas && <span> · {t("avisosDesligados")}</span>}
                  {c.reguaDesligada && <span className="text-amber-700 dark:text-amber-300"> · {t("regua.excecao")}</span>}
                </p>
              </div>
              {podeDesligar && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={trocandoRegua === c.id}
                  title={c.reguaDesligada ? t("regua.cobrarDeNovo") : t("regua.naoCobrar")}
                  aria-label={c.reguaDesligada ? t("regua.cobrarDeNovo") : t("regua.naoCobrar")}
                  className={cn("h-7 shrink-0 px-2", c.reguaDesligada ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")}
                  onClick={() => void trocarRegua(c.id, !c.reguaDesligada)}
                >
                  {trocandoRegua === c.id ? <Loader2 className="size-3.5 animate-spin" /> : c.reguaDesligada ? <BellOff className="size-3.5" /> : <BellRing className="size-3.5" />}
                </Button>
              )}
              {podeDesligar && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={desligando === c.id}
                  title={t("naoEhEsteCliente")}
                  aria-label={t("naoEhEsteCliente")}
                  className="text-muted-foreground hover:text-destructive h-7 shrink-0 px-2"
                  onClick={() => void desligar(c.id)}
                >
                  {desligando === c.id ? <Loader2 className="size-3.5 animate-spin" /> : <Unlink className="size-3.5" />}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </div>

      {/* ⚠️ "Nenhuma parcela vencida" só com o ciclo da listagem vigente
          terminado, leitura FRESCA e sem parcela em conferência: sobre o
          espelho parado (ou no meio de um ciclo) seria afirmar "em dia" a
          partir de dado velho — e o atendente repetiria ao cliente; e acima
          de uma lista de vencidas "em conferência" seria contradição na mesma
          tela (Codex e revisão do PR #203). Sem isso, a aba diz que não sabe. */}
      {divida.vencidas.length === 0 ? (
        <p className={cn("px-1 text-sm", fresca && dados.cicloCompleto && divida.emConferencia.length === 0 ? "text-muted-foreground" : "text-amber-700 dark:text-amber-300")}>
          {!dados.cicloCompleto
            ? t("semListagem")
            : !fresca
              ? quando
                ? t("semLeituraRecente", { quando })
                : t("semListagem")
              : divida.emConferencia.length > 0
                ? t("nadaConfirmado", { n: divida.emConferencia.length })
                : t("emDia")}
        </p>
      ) : (
        <div>
          <SecaoDeParcelas titulo={t("vencidas")} parcelas={divida.vencidas} devida {...secao} />
          <div className="mt-2 px-1 text-xs">
            <p className="font-semibold text-red-700 dark:text-red-300">{t("totalVencido", { valor: dinheiro(divida.total) })}</p>
            {divida.totalAtualizado > divida.total && <p className="text-muted-foreground">{t("totalAtualizado", { valor: dinheiro(divida.totalAtualizado) })}</p>}
          </div>
        </div>
      )}

      {/* A régua (998): o histórico deste contato e o estado do interruptor
          (D20) — "Cobrança automática desligada" só quando há automação
          ligada e o interruptor não; sem automação nenhuma, nada a dizer. */}
      {(dados.envios.length > 0 || (dados.reguaComAutomacoes && !dados.reguaAtiva)) && (
        <div>
          <TituloDeSecao className="mb-1.5">{t("regua.titulo")}</TituloDeSecao>
          {dados.reguaComAutomacoes && !dados.reguaAtiva && <p className="mb-1.5 px-1 text-xs text-amber-700 dark:text-amber-300">{t("regua.desligadaNaConta")}</p>}
          {dados.envios.length > 0 && (
            <ul className="space-y-1 px-1 text-xs">
              {dados.envios.slice(0, 8).map((e) => (
                <li key={e.id} className="text-muted-foreground">
                  <span className="text-foreground">{e.automationNome}</span>
                  {" · "}
                  {e.tipo === "vence_hoje" ? t("regua.lembrete") : t("regua.marco", { dias: e.marco })}
                  {" · "}
                  {/* chave montada: `regua.resultado.<resultado>` — os nove valores do CHECK da 998 (`RESULTADOS_DA_TRAVA`), cobrados por teste */}
                  {t(`regua.resultado.${e.resultado}` as Parameters<typeof t>[0], { quando: quandoFoi(e.finalizadoEm ?? e.criadoEm) ?? "" })}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <SecaoDeParcelas titulo={t("emConferencia")} dica={t("emConferenciaDica")} parcelas={divida.emConferencia} devida {...secao} />
      <SecaoDeParcelas titulo={t("aVencer")} parcelas={aVencer} devida={false} {...secao} />
      <SecaoDeParcelas titulo={t("regularizadas", { dias: REGULARIZADAS_DIAS })} parcelas={regularizadas} devida={false} {...secao} />
      <SecaoDeParcelas titulo={t("estornadas")} parcelas={estornadas} devida={false} {...secao} />

      {quando && (
        <p className={cn("px-1 text-[11px]", fresca ? "text-muted-foreground/70" : "text-amber-700 dark:text-amber-300")}>
          {fresca ? t("dadosDe", { quando }) : t("leituraAntiga", { quando })}
        </p>
      )}
    </div>
  );
}
