"use client"

import { use, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Loader2 } from "lucide-react"
import { useTranslations } from "next-intl"

import {
  AutomationBuilder,
  fromServerSteps,
  type BuilderInitial,
  type ServerStepNode,
} from "@/components/automations/automation-builder"
import { origemDoConstrutor, voltaDoConstrutor } from "@/lib/pipelines/url"
import type { AutomationTriggerType } from "@/types"

export default function EditAutomationPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const router = useRouter()
  const t = useTranslations("Automations.edit")
  const tBuilder = useTranslations("Automations.builder")
  // A mesma volta do construtor: quem abriu pela grade do funil volta para
  // ela também quando a automação não carrega.
  const origem = origemDoConstrutor(useSearchParams())
  const [initial, setInitial] = useState<BuilderInitial | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const res = await fetch(`/api/automations/${id}`)
      if (!res.ok) {
        if (!cancelled) setError(t("loadError", { status: res.status }))
        return
      }
      const body = await res.json()
      if (cancelled) return
      setInitial({
        id: body.automation.id,
        name: body.automation.name ?? "",
        description: body.automation.description ?? "",
        trigger_type: body.automation.trigger_type as AutomationTriggerType,
        trigger_config: body.automation.trigger_config ?? {},
        // `null` no banco = todos os canais; no formulário isso é o array
        // vazio (ver BuilderInitial.channel_ids).
        channel_ids: (body.automation.channel_ids as string[] | null) ?? [],
        // Idem para o recorte por etapa (933): `null` no banco = todas.
        stage_ids: (body.automation.stage_ids as string[] | null) ?? [],
        assinatura_personalizada: (body.automation.assinatura_personalizada as string | null) ?? null,
        is_active: !!body.automation.is_active,
        steps: fromServerSteps((body.steps ?? []) as ServerStepNode[]),
      })
    }
    load()
    return () => {
      cancelled = true
    }
  }, [id])

  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3">
        <p className="text-sm text-red-400">{error}</p>
        <button
          onClick={() => router.push(voltaDoConstrutor(origem))}
          className="text-sm text-primary hover:text-primary/80"
        >
          {origem ? tBuilder("backToPipeline") : t("back")}
        </button>
      </div>
    )
  }

  if (!initial) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  return <AutomationBuilder initial={initial} />
}
