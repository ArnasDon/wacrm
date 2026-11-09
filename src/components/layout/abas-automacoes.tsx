"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";

// Automações num lugar só: as quatro telas (regras, mensagens para os grupos,
// respostas ao cliente e fluxos) com as mesmas abas no topo.
const ABAS: { href: string; nome: string; sub: string; gestor?: boolean; modulo?: "trafego" }[] = [
  { href: "/regras", nome: "Regras e alertas", sub: "Avisos em Hoje e no grupo quando algo acontece", gestor: true },
  { href: "/trafego/alertas", nome: "Mensagens para os grupos", sub: "Mensagem, relatório, lembrete e alerta de gasto", gestor: true, modulo: "trafego" },
  { href: "/automations", nome: "Respostas ao cliente", sub: "O que o WhatsApp responde sozinho" },
  { href: "/flows", nome: "Fluxos", sub: "Conversas em etapas com o cliente" },
];

export function AbasAutomacoes() {
  const pathname = usePathname();
  const { canManageMembers, branding } = useAuth();
  const abas = ABAS.filter((a) => (!a.gestor || canManageMembers) && (!a.modulo || branding?.modules?.[a.modulo] !== false));
  if (abas.length < 2) return null;
  return (
    <nav aria-label="Automações" className="mb-5 flex gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1">
      {abas.map((a) => {
        const ativo = pathname === a.href || pathname.startsWith(a.href + "/");
        return (
          <Link
            key={a.href}
            href={a.href}
            aria-current={ativo ? "page" : undefined}
            title={a.sub}
            className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${ativo ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
          >
            {a.nome}
          </Link>
        );
      })}
    </nav>
  );
}
