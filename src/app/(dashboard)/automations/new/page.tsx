"use client"

import { Suspense, useMemo } from "react"
import { useSearchParams } from "next/navigation"

import {
  AutomationBuilder,
  type BuilderInitial,
  type BuilderStep,
} from "@/components/automations/automation-builder"
import { AUTOMATION_TEMPLATES, type TemplateSlug } from "@/lib/automations/templates"
import type { AutomationStepType, AutomationTriggerType } from "@/types"

// `useSearchParams` requires a Suspense boundary or the production build
// bails to CSR and errors out. Thin wrapper supplies it; the inner
// component reads the `?template=` query string.
export default function NewAutomationPage() {
  return (
    <Suspense fallback={null}>
      <NewAutomationPageInner />
    </Suspense>
  )
}

function NewAutomationPageInner() {
  const params = useSearchParams()
  const template = params.get("template") as TemplateSlug | null
  // Veio do painel de uma etapa do funil (Fase 5). O construtor nasce com o
  // gatilho de funil já apontando para ela — sem isso, "criar automação desta
  // coluna" faria o operador reescolher à mão a etapa em que acabou de
  // clicar, e errar essa escolha é silencioso.
  const stage = params.get("stage")

  const initial: BuilderInitial = useMemo(() => {
    if (template && AUTOMATION_TEMPLATES[template]) {
      const t = AUTOMATION_TEMPLATES[template]
      const steps = expandFromSeeds(
        t.steps.map((seed, idx) => ({
          index: idx,
          step_type: seed.step_type,
          step_config: seed.step_config as Record<string, unknown>,
          branch: seed.branch ?? null,
          parent_index: seed.parent_index ?? null,
        })),
      )
      return {
        name: t.name,
        description: t.description,
        trigger_type: t.trigger_type,
        trigger_config: t.trigger_config as Record<string, unknown>,
        // Automação nova nasce sem escopo = vale para todos os números,
        // que é o comportamento de antes do multi-canal.
        channel_ids: [],
        stage_ids: [],
        assinatura_personalizada: null,
        is_active: false,
        steps,
      }
    }
    if (stage) {
      return {
        name: "",
        description: "",
        trigger_type: "deal_stage_changed" as AutomationTriggerType,
        // ⚠️ `parar_ao_sair` nasce LIGADO (decisão do operador, 18/09/2026):
        // quem cria "a automação desta coluna" espera que ela valha enquanto
        // o card está na coluna — a recuperação de No Show não pode seguir
        // cobrando quem reagendou. Desmarca-se nas que devem sobreviver à
        // etapa (boas-vindas de Contrato Fechado, cujo card vai para outro
        // funil). Só as NOVAS: automação já gravada não tem a chave e não
        // muda. Ver `automations/so-na-etapa.ts`.
        trigger_config: { stage_ids: [stage], parar_ao_sair: true },
        channel_ids: [],
        // ⚠️ Escopo VAZIO, e não `[stage]`. São perguntas diferentes: o
        // gatilho é "entrou nesta etapa", o escopo é "está nesta etapa". Com
        // os dois preenchidos a regra continua funcionando hoje e vira uma
        // armadilha amanhã — mudar o gatilho para outra etapa a deixaria
        // configurada, ligada e incapaz de disparar, que é exatamente a
        // categoria "nunca dispara aqui" do painel.
        stage_ids: [],
        assinatura_personalizada: null,
        is_active: false,
        steps: [],
      }
    }
    return {
      name: "",
      description: "",
      trigger_type: "new_message_received" as AutomationTriggerType,
      trigger_config: {},
      channel_ids: [],
      stage_ids: [],
      assinatura_personalizada: null,
      is_active: false,
      steps: [],
    }
  }, [template, stage])

  return <AutomationBuilder initial={initial} />
}

interface SeedRow {
  index: number
  step_type: AutomationStepType
  step_config: Record<string, unknown>
  branch: "yes" | "no" | null
  parent_index: number | null
}

function uid(): string {
  return (
    "c_" +
    (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36))
  )
}

/** Template seeds are flat with parent_index references. Expand into the
 *  builder's nested tree, preserving order within each scope. */
function expandFromSeeds(rows: SeedRow[]): BuilderStep[] {
  const nodes: BuilderStep[] = rows.map((r) => ({
    cid: uid(),
    step_type: r.step_type,
    step_config: r.step_config,
    branches:
      r.step_type === "condition" ? { yes: [], no: [] } : undefined,
  }))
  const roots: BuilderStep[] = []
  rows.forEach((r, i) => {
    if (r.parent_index == null) {
      roots.push(nodes[i])
      return
    }
    const parent = nodes[r.parent_index]
    if (!parent.branches) parent.branches = { yes: [], no: [] }
    parent.branches[r.branch ?? "yes"].push(nodes[i])
  })
  return roots
}
