"use client"

import { useTranslations } from "next-intl"

import { HORA_MAXIMA, HORA_MINIMA } from "@/lib/asaas/regua"

/**
 * Config dos dois gatilhos da régua do Asaas (998): o MARCO (só na cobrança
 * do atrasado), a hora a partir da qual a mensagem sai, "só em dia útil", o
 * aviso de que a conexão do passo é obrigatória (D19) e a lista das
 * variáveis que a mensagem pode usar (§3.6 do plano). Os defaults moram na
 * CONFIG (`semearRegua`, no builder), não só na tela — a lição do lembrete
 * por data: o que se vê é o que se salva.
 */

const VARIAVEIS_DA_COBRANCA = [
  "cliente_nome",
  "cliente_primeiro_nome",
  "escritorio_nome",
  "cobranca_detalhe",
  "cobranca_parcelas",
  "cobranca_valor",
  "cobranca_vencimento",
  "cobranca_quantidade",
  "dias_de_atraso",
  "dias_de_atraso_maior",
  "marco_detalhe",
  "vence_hoje_detalhe",
  "vencimento_texto",
]

const INPUT_CLASS =
  "w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"

export function AsaasTriggerConfig({
  type,
  config,
  onChange,
}: {
  type: "asaas_cobranca_vencida" | "asaas_cobranca_vence_hoje"
  config: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
}) {
  const t = useTranslations("Automations.builder.asaas")
  const dias = typeof config.dias_de_atraso === "number" ? config.dias_de_atraso : Number(config.dias_de_atraso ?? 1)
  const hora = typeof config.hora_envio === "string" ? config.hora_envio : ""
  const diasUteis = config.somente_dias_uteis !== false

  return (
    <div className="space-y-2">
      {type === "asaas_cobranca_vencida" && (
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">{t("diasLabel")}</label>
          <input
            type="number"
            min={1}
            max={365}
            value={Number.isFinite(dias) ? dias : 1}
            onChange={(e) => onChange({ ...config, dias_de_atraso: Math.max(1, Math.min(365, Math.trunc(Number(e.target.value) || 1))) })}
            className={INPUT_CLASS}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">{t("diasAjuda")}</p>
        </div>
      )}
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">{t("horaLabel")}</label>
        <input type="time" min={HORA_MINIMA} max={HORA_MAXIMA} step={300} value={hora} onChange={(e) => onChange({ ...config, hora_envio: e.target.value })} className={INPUT_CLASS} />
        <p className="mt-1 text-[11px] text-muted-foreground">{t("horaAjuda")}</p>
      </div>
      <label className="flex items-start gap-2 text-xs text-foreground">
        <input type="checkbox" checked={diasUteis} onChange={(e) => onChange({ ...config, somente_dias_uteis: e.target.checked })} className="mt-0.5" />
        <span>
          {t("diasUteisLabel")}
          <span className="block text-[11px] text-muted-foreground">{t("diasUteisAjuda")}</span>
        </span>
      </label>
      <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-300">{t("conexaoAviso")}</p>
      <div className="rounded-md border border-border bg-muted/40 p-2">
        <p className="text-[11px] font-medium text-muted-foreground">{t("variaveisTitulo")}</p>
        <p className="mt-1 font-mono text-[11px] leading-5 text-foreground">{VARIAVEIS_DA_COBRANCA.map((v) => `{{vars.${v}}}`).join("  ")}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {/* As chaves entram por VALOR: escritas no dicionário, as chaves
              duplas quebrariam o parser ICU (icu-safety.test.ts). */}
          {type === "asaas_cobranca_vencida"
            ? t("variaveisAjuda", { nome: "{{vars.cliente_primeiro_nome}}", detalhe: "{{vars.cobranca_detalhe}}", valor: "{{vars.cobranca_valor}}", venceHoje: "{{vars.vence_hoje_detalhe}}" })
            : t("variaveisLembreteAjuda", { detalhe: "{{vars.cobranca_detalhe}}", texto: "{{vars.vencimento_texto}}" })}
        </p>
      </div>
    </div>
  )
}
