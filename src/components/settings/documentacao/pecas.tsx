"use client";

// ============================================================
// As peças de layout da aba "Documentação" (Configurações → API): seção
// com âncora, subtítulo, parágrafo, lista, código em linha e o bloco
// recolhível. Só visual — o texto vem do dicionário, os trechos de código
// de `src/lib/integracoes/exemplos-de-requisicao.ts`.
//
// ⚠️ `min-w-0` na seção e `[overflow-wrap:anywhere]` no código em linha: a
// aba precisa ler a 375 px, e um `X-Wacrm-Signature` ou um id sem espaço
// empurraria o cartão para fora da tela (a armadilha do `min-width: auto`
// do CLAUDE.md). O bloco de código ROLA na horizontal em vez de quebrar —
// curl quebrado no meio deixa de ser colável (`BlocoDeCodigo`).
// ============================================================

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { FONTE_MONO } from "../copiar";

export function Secao({
  id,
  titulo,
  children,
}: {
  id: string;
  titulo: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-titulo`}
      className="min-w-0 scroll-mt-4 space-y-3 rounded-lg border border-border bg-card p-4 sm:p-5"
    >
      <h3
        id={`${id}-titulo`}
        className="text-base font-semibold tracking-tight text-foreground"
      >
        {titulo}
      </h3>
      {children}
    </section>
  );
}

export function Subtitulo({ children }: { children: ReactNode }) {
  return (
    <h4 className="pt-1 text-sm font-semibold text-foreground">{children}</h4>
  );
}

export function Paragrafo({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]",
        className,
      )}
    >
      {children}
    </p>
  );
}

/** Lista numerada (passo a passo) ou com marcador (regras). */
export function Lista({
  numerada = false,
  children,
}: {
  numerada?: boolean;
  children: ReactNode;
}) {
  const Tag = numerada ? "ol" : "ul";
  return (
    <Tag
      className={cn(
        "space-y-1.5 pl-5 text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]",
        numerada ? "list-decimal" : "list-disc",
      )}
    >
      {children}
    </Tag>
  );
}

export function CodigoEmLinha({ children }: { children: ReactNode }) {
  return (
    <code
      className="rounded bg-muted px-1 py-0.5 text-[12px] text-foreground [overflow-wrap:anywhere]"
      style={{ fontFamily: FONTE_MONO }}
    >
      {children}
    </code>
  );
}

/** Conteúdo recolhido por padrão — o JSON de exemplo, a parte avançada. */
export function Recolhivel({
  titulo,
  children,
  className,
}: {
  titulo: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details className={cn("min-w-0 rounded-md border border-border", className)}>
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-foreground hover:bg-muted/40">
        {titulo}
      </summary>
      <div className="min-w-0 space-y-3 border-t border-border p-3">
        {children}
      </div>
    </details>
  );
}
