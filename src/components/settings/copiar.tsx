"use client";

// ============================================================
// Peças de COPIAR das telas de integração (abas IDs e Documentação da seção
// API, e a aba Webhooks → Enviados).
//
// `BotaoCopiar`: o ícone que vira ✓ por 2 s. `BlocoDeCodigo`: um trecho de
// código (curl, JSON) com o botão no canto.
//
// ⚠️ A FONTE MONO é explícita (`FONTE_MONO`), e não a classe `font-mono`: a
// variável `--font-mono` do `globals.css` aponta para `--font-geist-mono`,
// que nenhum arquivo define — então `font-mono` sai na Inter (medido na
// tela). Num JSON de exemplo isso desalinha a indentação que o leitor usa
// para enxergar o aninhamento. Consertar a variável muda as ~50 telas que
// usam `font-mono`, e é decisão própria (com revisão de tela), não carona.
// ============================================================

import { useCallback, useState } from "react";
import { Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

export const FONTE_MONO =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

/**
 * Ícone de copiar. `rotulo` diz O QUE se copia ("ID da etapa Lead") — é o
 * `aria-label` e o `title`, então precisa ser específico: numa tabela de
 * ids, "Copiar" repetido cem vezes não diz nada a quem usa leitor de tela.
 */
export function BotaoCopiar({
  valor,
  rotulo,
  className,
}: {
  valor: string;
  rotulo: string;
  className?: string;
}) {
  const t = useTranslations("Settings.copiar");
  const [copiado, setCopiado] = useState(false);

  const copiar = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(valor);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      toast.error(t("falhou"));
    }
  }, [valor, t]);

  return (
    <button
      type="button"
      onClick={copiar}
      aria-label={rotulo}
      title={copiado ? t("copiado") : rotulo}
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-md transition-colors",
        copiado
          ? "text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      {copiado ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}

/**
 * Um id (ou chave) em fonte mono, com o botão de copiar ao lado.
 *
 * `min-w-0` + `truncate`: dentro de linha flex o id longo não pode empurrar
 * a coluna (a armadilha do `min-width: auto` do CLAUDE.md). O valor inteiro
 * continua no `title` e no que é copiado.
 */
export function ValorCopiavel({
  valor,
  rotulo,
  className,
}: {
  valor: string;
  rotulo: string;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1", className)}>
      <code
        className="min-w-0 truncate rounded bg-muted px-1.5 py-0.5 text-[11px] text-foreground"
        style={{ fontFamily: FONTE_MONO }}
        title={valor}
      >
        {valor}
      </code>
      <BotaoCopiar valor={valor} rotulo={rotulo} />
    </span>
  );
}

/**
 * Bloco de código com botão de copiar no canto. Rola na horizontal em vez
 * de quebrar linha: curl e JSON quebrados no meio deixam de ser coláveis.
 */
export function BlocoDeCodigo({
  codigo,
  rotulo,
  className,
}: {
  codigo: string;
  /** O que o bloco é ("Exemplo de requisição") — vai no botão. */
  rotulo: string;
  className?: string;
}) {
  return (
    <div className={cn("relative min-w-0 rounded-md border border-border bg-muted/40", className)}>
      <pre
        className="min-w-0 overflow-x-auto whitespace-pre p-3 pr-10 text-[11.5px] leading-relaxed text-foreground"
        style={{ fontFamily: FONTE_MONO }}
      >
        {codigo}
      </pre>
      <BotaoCopiar valor={codigo} rotulo={rotulo} className="absolute right-1.5 top-1.5 bg-background/80" />
    </div>
  );
}
