"use client"

import { use, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  ArrowLeft,
  Check,
  Loader2,
  Minus,
  X,
  ChevronDown,
  ChevronRight,
} from "lucide-react"
import { useTranslations } from "next-intl"

import { createClient } from "@/lib/supabase/client"
import type {
  Automation,
  AutomationLog,
  AutomationLogStepResult,
} from "@/types"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { formatRelative } from "@/lib/automations/trigger-meta"
import { ChannelCell, ChannelScopeBadge } from "@/components/channels/channel-badge"
import { useChannels } from "@/hooks/use-channels"
import { nomeDoContato } from "@/lib/contacts/identidade"

export default function AutomationLogsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const router = useRouter()
  const t = useTranslations("Automations.logs")

  const [automation, setAutomation] = useState<Automation | null>(null)
  const [logs, setLogs] = useState<AutomationLog[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openLogId, setOpenLogId] = useState<string | null>(null)
  const { channels } = useChannels()

  useEffect(() => {
    async function load() {
      try {
        const supabase = createClient()
        const [autRes, logRes] = await Promise.all([
          supabase
            .from("automations")
            .select("*")
            .eq("id", id)
            .maybeSingle(),
          supabase
            .from("automation_logs")
            .select("*, contact:contacts(id, name, phone, instagram_username)")
            .eq("automation_id", id)
            .order("created_at", { ascending: false })
            .limit(100),
        ])
        if (autRes.error) throw autRes.error
        if (logRes.error) throw logRes.error
        setAutomation(autRes.data as Automation | null)
        setLogs((logRes.data ?? []) as AutomationLog[])
      } catch (err) {
        setError(err instanceof Error ? err.message : t("loadError"))
      }
    }
    load()
  }, [id])

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3">
        <p className="text-sm text-red-400">{error}</p>
        <Button variant="outline" onClick={() => router.push("/automations")}>
          {t("back")}
        </Button>
      </div>
    )
  }

  if (!automation || logs === null) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.push("/automations")}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={t("backAria")}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-foreground">{automation.name}</h1>
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            <p className="text-sm text-muted-foreground">{t("title")}</p>
            {/* No detalhe mostramos o escopo SEMPRE, inclusive "todos os
                canais": aqui o silêncio seria ambíguo — o operador não
                saberia se a automação vale para tudo ou se ninguém
                configurou. Nas listas a regra é a inversa. */}
            <ChannelScopeBadge
              channels={channels}
              scope={automation.channel_ids}
              hideWhenAll={false}
            />
          </div>
        </div>
      </div>

      {logs.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/40">
          <p className="text-sm text-foreground">{t("emptyTitle")}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("emptyDesc")}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {logs.map((log) => {
            const isOpen = openLogId === log.id
            return (
              <li
                key={log.id}
                className="rounded-xl border border-border bg-card"
              >
                <button
                  type="button"
                  onClick={() => setOpenLogId(isOpen ? null : log.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left"
                >
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                  <StatusBadge status={log.status} desfecho={log.desfecho} t={t} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">
                      {nomeDoContato(log.contact, t("unknownContact"))}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {log.trigger_event} · {log.steps_executed?.length ?? 0}{" "}
                      {log.steps_executed?.length === 1 ? t("step", { count: 1 }).replace("1 ", "") : t("stepPlural", { count: log.steps_executed?.length ?? 0 }).replace(/^[0-9]+ /, "")}
                    </div>
                  </div>
                  <ChannelCell
                    channels={channels}
                    channelId={log.channel_id}
                    className="hidden sm:inline-flex"
                  />
                  <div className="text-xs text-muted-foreground">
                    {formatRelative(log.created_at)}
                  </div>
                </button>
                {isOpen && (
                  <div className="border-t border-border px-4 py-3">
                    {log.error_message && (
                      <p className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                        {log.error_message}
                      </p>
                    )}
                    <ul className="space-y-1.5">
                      {(log.steps_executed ?? []).map((r, i) => (
                        <StepRow key={i} result={r} />
                      ))}
                      {(log.steps_executed ?? []).length === 0 && (
                        <li className="text-xs text-muted-foreground">{t("noSteps")}</li>
                      )}
                    </ul>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/**
 * ⚠️ O DESFECHO manda quando existe (985); `status` é a queda.
 *
 * `status` nasce `'failed'` no INSERT, ANTES do primeiro passo (semente
 * pessimista da issue #409), então esta etiqueta pintava VERMELHO toda
 * execução em curso — inclusive uma automação de 30 dias parada num
 * "Aguardar", que fica `partial` mas só depois de enfileirar. E execução
 * BARRADA por uma condição termina `'success'`, ou seja: verde para algo que
 * não rodou.
 *
 * A queda para `status` continua porque as 15 execuções gravadas antes da 985
 * não têm desfecho, e não há backfill possível (ninguém registrou quando cada
 * uma terminou).
 */
function StatusBadge({
  status,
  desfecho,
  t,
}: {
  status: AutomationLog["status"]
  desfecho?: AutomationLog["desfecho"]
  t: ReturnType<typeof useTranslations>
}) {
  const chave = desfecho ? `desfecho.${desfecho}` : `status.${status}`
  const classes = desfecho
    ? desfecho === "concluida"
      ? "border-primary/30 bg-primary/10 text-primary"
      : desfecho === "barrada"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
        : "border-red-500/30 bg-red-500/10 text-red-300"
    : status === "success"
      ? "border-primary/30 bg-primary/10 text-primary"
      : status === "partial"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
        : "border-red-500/30 bg-red-500/10 text-red-300"
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
        classes,
      )}
    >
      {t(chave as Parameters<typeof t>[0])}
    </span>
  )
}

function StepRow({ result }: { result: AutomationLogStepResult }) {
  const ok = result.status === "success"
  // ⚠️ `skipped` NÃO é falha: é a condição que desviou para um ramo vazio
  // (985) e a espera interrompida porque o cliente respondeu (18/09/2026).
  // Até aqui tudo que não era `success` ganhava o ✗ vermelho, e "a automação
  // parou porque o cliente respondeu" — que é a regra funcionando — era lido
  // como erro. Classes literais, como o Tailwind exige.
  const pulado = result.status === "skipped"
  return (
    <li className="flex items-start gap-2 text-xs">
      <span
        className={cn(
          "mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full",
          ok
            ? "bg-primary/20 text-primary"
            : pulado
              ? "bg-muted text-muted-foreground"
              : "bg-red-500/20 text-red-400",
        )}
        aria-hidden
      >
        {ok ? (
          <Check className="h-3 w-3" />
        ) : pulado ? (
          <Minus className="h-3 w-3" />
        ) : (
          <X className="h-3 w-3" />
        )}
      </span>
      <span className="text-muted-foreground">{result.step_type}</span>
      {result.detail && (
        <span className="truncate text-muted-foreground">— {result.detail}</span>
      )}
    </li>
  )
}
