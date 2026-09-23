"use client";

// ============================================================
// Barra de sub-abas de uma seção de Configurações — os botões de sublinhado.
//
// É a MESMA forma da barra de Webhooks (Recebidos | Enviados), trazida para
// um componente porque a seção API ganhou a segunda. O primitivo
// `ui/tabs.tsx` ficou de fora de propósito: ele carrega
// `group-data-horizontal/tabs:h-8`, e override de altura sem o mesmo
// prefixo de variante não vence no tailwind-merge (a armadilha que já
// sobrepôs as abas da ficha do contato aos campos — ver o CLAUDE.md).
//
// Quem é dono da aba ativa é o chamador (estado local ou `?aba=` na URL);
// aqui só se desenha e se avisa o clique.
// ============================================================

import { cn } from "@/lib/utils";

export function SubAbas<T extends string>({
  abas,
  ativa,
  aoTrocar,
  rotulo,
  className,
}: {
  abas: readonly { id: T; rotulo: string }[];
  ativa: T;
  aoTrocar: (id: T) => void;
  /** Nome da barra para leitor de tela ("Abas da seção API"). */
  rotulo: string;
  className?: string;
}) {
  return (
    <nav aria-label={rotulo} className={cn("flex gap-4 border-b border-border", className)}>
      {abas.map(({ id, rotulo: texto }) => (
        <button
          key={id}
          type="button"
          onClick={() => aoTrocar(id)}
          aria-current={ativa === id ? "page" : undefined}
          className={cn(
            "-mb-px border-b-2 px-1 pb-2 text-sm whitespace-nowrap",
            ativa === id
              ? "border-primary font-medium text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {texto}
        </button>
      ))}
    </nav>
  );
}
