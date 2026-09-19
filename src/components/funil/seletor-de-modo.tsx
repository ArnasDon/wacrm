"use client";

import { useTranslations } from "next-intl";

import type { ModoDeContagem } from "@/lib/funil/por-periodo";

/**
 * Como contar: "Por período" (o que ACONTECEU no período — o padrão) ou "Por
 * mês de entrada" (a coorte: quem ENTROU no período, e o que fez até hoje).
 * Mesma forma do seletor de período ao lado, para ler como um par.
 *
 * As duas chaves são LITERAIS, e não `t(modo)`: chave montada escapa do
 * portão de i18n do CI (é a lição de `Settings.sections.webhooks`).
 */
export function SeletorDeModo({
  modo,
  onChange,
}: {
  modo: ModoDeContagem;
  onChange: (modo: ModoDeContagem) => void;
}) {
  const t = useTranslations("Pipelines.funil.modo");
  const opcoes: { valor: ModoDeContagem; rotulo: string; dica: string }[] = [
    { valor: "periodo", rotulo: t("periodo"), dica: t("dicaPeriodo") },
    { valor: "entrada", rotulo: t("entrada"), dica: t("dicaEntrada") },
  ];

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">{t("rotulo")}</span>
      <div className="flex rounded-lg border border-border bg-card p-0.5">
        {opcoes.map((o) => (
          <button
            key={o.valor}
            type="button"
            onClick={() => onChange(o.valor)}
            aria-pressed={o.valor === modo}
            title={o.dica}
            className={
              o.valor === modo
                ? "inline-flex items-center rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground"
                : "inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            }
          >
            {o.rotulo}
          </button>
        ))}
      </div>
    </div>
  );
}
