"use client"

import { use, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { useTranslations } from "next-intl"

import {
  AutomationBuilder,
  fromServerSteps,
  type BuilderInitial,
  type ServerStepNode,
} from "@/components/automations/automation-builder"
import type { AutomationTriggerType } from "@/types"

export default function EditAutomationPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const router = useRouter()
  const t = useTranslations("Automations.edit")
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
          onClick={() => router.push("/automations")}
          className="text-sm text-primary hover:text-primary/80"
        >
          {t("back")}
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
