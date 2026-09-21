"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  AlertTriangle,
  Anchor,
  ArrowDownToLine,
  Copy,
  Globe,
  Columns3,
  Plus,
  Zap,
} from "lucide-react"
import { useTranslations } from "next-intl"

import type { Automation, AutomationStep, PipelineStage } from "@/types"
import { montarGrade, type CartaoDaGrade } from "@/lib/automations/grade-do-funil"
import {
  descreverPasso,
  type NomesConhecidos,
} from "@/lib/automations/descrever-passo"
import { urlDoConstrutor } from "@/lib/pipelines/url"
import { useCan } from "@/hooks/use-can"
import { GatedButton } from "@/components/ui/gated-button"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

/**
 * A visão "Automações" do funil — colunas são as etapas, cada cartão ocupa as
 * colunas em que a regra dispara. É o formato do Kommo, pedido pelo operador.
 *
 * ⚠️ A LARGURA DO CARTÃO É O DADO. Expandir para mais colunas grava mais
 * etapas em `trigger_config.stage_ids`; sem etapa nenhuma, o cartão atravessa
 * o quadro porque a regra vale em todas. Não há coluna nova nem migration —
 * ver `lib/automations/grade-do-funil.ts`, que é onde a conta mora e onde há
 * teste.
 */
export function AutomationsBoard({
  pipelineId,
  stages,
  automations,
  steps,
  nomes,
  onChanged,
}: {
  /** O funil exibido — vai na URL do construtor, para o voltar trazer de volta a ele. */
  pipelineId: string
  stages: PipelineStage[]
  automations: Automation[]
  /** Passos por automação, já em ordem. Só o 1º e a contagem são exibidos. */
  steps: Record<string, AutomationStep[]>
  nomes: NomesConhecidos
  onChanged: () => void
}) {
  const t = useTranslations("Pipelines.automacoes")
  const router = useRouter()
  const canCreate = useCan("manage-automations")
  // ⚠️ O "expandir" edita DUAS listas diferentes conforme o cartão: o de
  // gatilho mexe em `trigger_config.stage_ids` ("para qual etapa o card tem de
  // ENTRAR") e o de escopo em `automations.stage_ids` ("em qual etapa o
  // contato precisa ESTAR"). Por isso o estado carrega o campo, e não só a
  // automação — um diálogo que adivinhasse pelo gatilho gravaria na lista
  // errada em silêncio.
  const [expandindo, setExpandindo] = useState<{
    automation: Automation
    campo: "gatilho" | "escopo"
  } | null>(null)
  const [copiando, setCopiando] = useState<string | null>(null)
  // Criar e editar abrem o construtor COM a origem: sem ela, o voltar de lá
  // levava à tela de Automações do menu, e não a esta grade (ver
  // `lib/pipelines/url.ts`).
  const origem = { funil: pipelineId || null }

  const ordenadas = useMemo(
    () => [...stages].sort((a, b) => a.position - b.position),
    [stages],
  )
  // Com os passos, a grade também posiciona os cartões de CHEGADA: regras
  // de outro gatilho (Calendly, palavra-chave…) que movem o card para uma
  // etapa deste quadro — ver `grade-do-funil.ts`.
  const linhas = useMemo(
    () => montarGrade(automations, ordenadas.map((s) => s.id), steps),
    [automations, ordenadas, steps],
  )

  const colunas = `repeat(${ordenadas.length}, minmax(240px, 1fr))`

  async function duplicar(a: Automation) {
    setCopiando(a.id)
    const res = await fetch(`/api/automations/${a.id}/duplicate`, { method: "POST" })
    setCopiando(null)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      toast.error(body?.error ?? t("toastCopiaFalhou"))
      return
    }
    onChanged()
    toast.success(t("toastCopiada"))
  }

  return (
    <div className="overflow-x-auto pb-4">
      <div className="grid gap-2" style={{ gridTemplateColumns: colunas }}>
        {/* Cabeçalho: as etapas, na mesma ordem e cor do quadro de leads, para
            que o operador reconheça a coluna sem reler o nome. */}
        {ordenadas.map((s, i) => (
          <div
            key={s.id}
            className="min-w-0"
            style={{ gridColumn: i + 1, gridRow: 1 }}
          >
            <div className="h-[3px] rounded-full" style={{ backgroundColor: s.color }} />
            <div className="flex items-center justify-between gap-1 pt-2">
              <h3 className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {s.name}
              </h3>
              <GatedButton
                canAct={canCreate}
                gateReason="create automations"
                variant="ghost"
                size="icon-xs"
                aria-label={t("novaAqui")}
                title={t("novaAqui")}
                onClick={() => router.push(urlDoConstrutor({ etapa: s.id, origem }))}
                className="shrink-0 text-muted-foreground hover:text-foreground"
              >
                <Plus className="h-3.5 w-3.5" />
              </GatedButton>
            </div>
          </div>
        ))}

        {linhas.flatMap((linha, r) =>
          linha.map((cartao) => (
            <Cartao
              key={`${cartao.automation.id}-${cartao.colunaInicial}`}
              cartao={cartao}
              linha={r + 2}
              passos={steps[cartao.automation.id] ?? []}
              nomes={nomes}
              copiando={copiando === cartao.automation.id}
              onAbrir={() => router.push(urlDoConstrutor({ id: cartao.automation.id, origem }))}
              onDuplicar={() => duplicar(cartao.automation)}
              onExpandir={() =>
                setExpandindo({
                  automation: cartao.automation,
                  campo: cartao.tipo === "escopo" ? "escopo" : "gatilho",
                })
              }
              t={t}
            />
          )),
        )}
      </div>

      {linhas.length === 0 && (
        <div className="mt-4 flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-14 text-center">
          <Zap className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-foreground">{t("vazio")}</p>
          <p className="max-w-sm text-xs text-muted-foreground">{t("vazioDesc")}</p>
        </div>
      )}

      {expandindo && (
        <EscolherEtapas
          automation={expandindo.automation}
          campo={expandindo.campo}
          stages={ordenadas}
          onClose={() => setExpandindo(null)}
          onSaved={() => {
            setExpandindo(null)
            onChanged()
          }}
        />
      )}
    </div>
  )
}

function Cartao({
  cartao,
  linha,
  passos,
  nomes,
  copiando,
  onAbrir,
  onDuplicar,
  onExpandir,
  t,
}: {
  cartao: CartaoDaGrade
  linha: number
  passos: AutomationStep[]
  nomes: NomesConhecidos
  copiando: boolean
  onAbrir: () => void
  onDuplicar: () => void
  onExpandir: () => void
  t: ReturnType<typeof useTranslations>
}) {
  const a = cartao.automation
  const primeiro = passos[0]
  const resumo = primeiro ? descreverPasso(primeiro, nomes) : null
  const tGatilhos = useTranslations("Automations.builder")
  const chegada = cartao.tipo === "chegada"
  const escopo = cartao.tipo === "escopo"

  // Chegada: o cabeçalho diz POR QUAL gatilho o card chega aqui — o rótulo é
  // o mesmo do editor (chave montada; toda `AutomationTriggerType` tem uma).
  const gatilho = chegada
    ? t("chegaPor", {
        gatilho: tGatilhos(`triggers.${a.trigger_type}.label` as Parameters<typeof tGatilhos>[0]),
      })
    : escopo
      ? t(cartao.colunas > 1 ? "rodaNasEtapas" : "rodaNaEtapa", {
          gatilho: tGatilhos(`triggers.${a.trigger_type}.label` as Parameters<typeof tGatilhos>[0]),
        })
    : cartao.todasAsEtapas
      ? t("todasAsEtapas")
      : cartao.colunas > 1
        ? t("quandoEntraVarias")
        : t("quandoEntra")

  return (
    <div
      style={{
        gridColumn: `${cartao.colunaInicial + 1} / span ${cartao.colunas}`,
        gridRow: linha,
      }}
      className={cn(
        "min-w-0 rounded-lg border p-2.5 transition-colors",
        // Pausada fica translúcida: no meio de um quadro cheio, a diferença
        // entre "roda" e "não roda" precisa ser vista de longe.
        a.is_active
          ? "border-border bg-card hover:border-primary/40"
          : "border-dashed border-border bg-card/40",
        cartao.todasAsEtapas && "border-violet-500/40 bg-violet-500/5",
        chegada && "border-sky-500/40 bg-sky-500/5",
        escopo && "border-emerald-500/40 bg-emerald-500/5",
      )}
      title={chegada ? t("chegaAjuda") : escopo ? t("escopoAjuda") : undefined}
    >
      <button type="button" onClick={onAbrir} className="block w-full min-w-0 text-left">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {cartao.todasAsEtapas && <Globe className="h-3 w-3 shrink-0 text-violet-400" />}
          {chegada && <ArrowDownToLine className="h-3 w-3 shrink-0 text-sky-400" />}
          {escopo && <Anchor className="h-3 w-3 shrink-0 text-emerald-400" />}
          <span className="truncate">{gatilho}</span>
        </div>

        {/* O que a automação FAZ, em negrito — é o que o operador lê primeiro. */}
        <p className="mt-0.5 truncate text-sm font-medium text-foreground">
          {resumo ? (
            <>
              {t(`resumo.${resumo.chave}`, {
                ...resumo.valores,
                // Id órfão vira "(apagado)". O UUID cru seria lido como nome.
                alvo: resumo.alvoSumiu ? t("alvoSumiu") : resumo.valores.alvo,
              })}
            </>
          ) : (
            <span className="text-muted-foreground">{t("semAcoes")}</span>
          )}
        </p>

        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
          <span className="truncate font-medium">{a.name}</span>
          {passos.length > 1 && <span>{t("maisAcoes", { count: passos.length - 1 })}</span>}
          {!a.is_active && <span className="text-amber-400">{t("pausada")}</span>}
          {/* Etapas não vizinhas viram vários cartões; sem este aviso o
              operador acha que cada um é uma automação diferente. */}
          {cartao.temOutrosTrechos && (
            <span className="inline-flex items-center gap-0.5 text-amber-400">
              <AlertTriangle className="h-2.5 w-2.5" />
              {t("temOutrosTrechos")}
            </span>
          )}
        </div>
      </button>

      <div className="mt-1.5 flex justify-end gap-0.5">
        <button
          type="button"
          onClick={onDuplicar}
          disabled={copiando}
          aria-label={t("copiar")}
          title={t("copiar")}
          className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
        >
          <Copy className="h-3 w-3" />
        </button>
        {/* Chegada não "expande": a coluna é o passo que move, não o gatilho. */}
        {!chegada && (
          <button
            type="button"
            onClick={onExpandir}
            aria-label={t("expandir")}
            title={t("expandir")}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Columns3 className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * O "expandir": escolher em quais etapas a automação dispara.
 *
 * ⚠️ Desmarcar TUDO não é "nenhuma etapa" — é TODAS, e a caixa precisa dizer
 * isso na hora, não depois de salvar. É a convenção do projeto inteiro
 * (`channelInScope`, `findEntryFlow`, o escopo do inbox), e uma tela que
 * sugerisse o contrário faria o operador desligar a regra errada.
 */
function EscolherEtapas({
  automation,
  campo,
  stages,
  onClose,
  onSaved,
}: {
  automation: Automation
  /**
   * ⚠️ QUAL das duas listas de etapa esta caixa edita:
   *   `gatilho` → `trigger_config.stage_ids` (para qual etapa o card ENTRA)
   *   `escopo`  → `automations.stage_ids`   (em qual etapa o contato ESTÁ)
   * Ver `por-etapa.ts`. Gravar numa achando que é a outra deixa a automação
   * configurada, visível e incapaz de rodar.
   */
  campo: "gatilho" | "escopo"
  stages: PipelineStage[]
  onClose: () => void
  onSaved: () => void
}) {
  const t = useTranslations("Pipelines.automacoes")
  const tEtapas = useTranslations("Automations.builder.stages")
  const atuais = useMemo(() => {
    if (campo === "escopo") {
      return Array.isArray(automation.stage_ids) ? automation.stage_ids : []
    }
    const cfg = automation.trigger_config as { stage_ids?: string[] } | undefined
    return Array.isArray(cfg?.stage_ids) ? cfg.stage_ids : []
  }, [automation, campo])

  const [escolhidas, setEscolhidas] = useState<string[]>(atuais)
  const [salvando, setSalvando] = useState(false)

  // Etapa de OUTRO funil que a automação também cobre. Ela não aparece nesta
  // caixa, e salvar sem preservá-la apagaria a configuração em silêncio.
  const deOutroFunil = atuais.filter((id) => !stages.some((s) => s.id === id))

  const escolhidasComAsDeFora = [
    ...escolhidas.filter((id) => stages.some((s) => s.id === id)),
    ...deOutroFunil,
  ]

  async function salvar() {
    setSalvando(true)
    const res = await fetch(`/api/automations/${automation.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        campo === "escopo"
          ? { stage_ids: escolhidasComAsDeFora }
          : {
              trigger_config: {
                ...(automation.trigger_config as Record<string, unknown>),
                stage_ids: escolhidasComAsDeFora,
              },
            },
      ),
    })
    setSalvando(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      toast.error(body?.error ?? t("toastEtapasFalhou"))
      return
    }
    toast.success(t("toastEtapasSalvas"))
    onSaved()
  }

  const alternar = (id: string) =>
    setEscolhidas((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]))

  const nenhumaMarcada = escolhidas.length === 0 && deOutroFunil.length === 0

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="truncate">{automation.name}</DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">
          {campo === "escopo" ? t("expandirEscopoAjuda") : t("expandirGatilhoAjuda")}
        </p>

        <p
          className={cn(
            "text-xs",
            nenhumaMarcada ? "font-medium text-violet-400" : "text-muted-foreground",
          )}
        >
          {nenhumaMarcada
            ? campo === "escopo"
              ? t("escopoVazioAviso")
              : t("todasAsEtapas")
            : tEtapas("selectedCount", { count: escolhidas.length })}
        </p>

        <div className="max-h-64 space-y-0.5 overflow-y-auto">
          {stages.map((s) => (
            <label
              key={s.id}
              className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm text-foreground hover:bg-muted"
            >
              <input
                type="checkbox"
                checked={escolhidas.includes(s.id)}
                onChange={() => alternar(s.id)}
                className="h-3.5 w-3.5 accent-primary"
              />
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: s.color }}
                aria-hidden
              />
              <span className="truncate">{s.name}</span>
            </label>
          ))}
        </div>

        {deOutroFunil.length > 0 && (
          <p className="text-[11px] text-amber-400">
            {t("temOutrosTrechos")}
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={salvando}>
            {t("cancelar")}
          </Button>
          <Button onClick={salvar} disabled={salvando}>
            {salvando ? t("salvando") : t("salvar")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
