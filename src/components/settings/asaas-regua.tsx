"use client";

import { useState } from "react";
import { Link as LinkIcon, Loader2, Zap } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { avisarAsaasMudou } from "@/lib/asaas/aviso";
import type { ReguaDoCartao } from "@/lib/asaas/cartao";

/**
 * O bloco "Cobrança automática" do cartão do Asaas (998): o interruptor de
 * cima (D20), o intervalo mínimo entre cobranças (D11, 13/09), quantas
 * automações da régua existem e estão ligadas, o aviso de marco repetido,
 * quantos clientes estão na lista de exceção (D21), "Criar régua padrão" e
 * o link para as automações. O que cada varredura fez fica na aba Cobranças
 * de cada cliente (o histórico da trava) e no log do agendador.
 *
 * ⚠️ O interruptor NÃO é retroativo (D13): o bloco diz isso ao ligar. E
 * desligado com automação ligada é um estado que a aba Cobranças também
 * denuncia — aqui é onde se resolve. `semCobranca` vem NULO enquanto o
 * resumo não está na tela (carga ou falha): o número some, não vira 0.
 */
export function AsaasRegua({ regua, semCobranca, aoMudar }: { regua: ReguaDoCartao; semCobranca: number | null; aoMudar: () => void }) {
  const t = useTranslations("Settings.integracoes.asaas.regua");
  const [salvando, setSalvando] = useState<"interruptor" | "intervalo" | "padrao" | null>(null);
  const [intervalo, setIntervalo] = useState(String(regua.intervaloDias));
  // A recarga do cartão traz o valor gravado: o campo segue a prop enquanto
  // ninguém o edita (o React reusa a instância entre recargas).
  const [intervaloGravado, setIntervaloGravado] = useState(regua.intervaloDias);
  if (intervaloGravado !== regua.intervaloDias) {
    setIntervaloGravado(regua.intervaloDias);
    setIntervalo(String(regua.intervaloDias));
  }

  const gravar = async (corpo: Record<string, unknown>, o: "interruptor" | "intervalo") => {
    setSalvando(o);
    try {
      const res = await fetch("/api/cb/asaas/regua/interruptor", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      if (!res.ok) {
        toast.error(t("erroGravar"));
        return;
      }
      if (o === "interruptor") toast.success(t(corpo.regua_ativa ? "ligada" : "desligada"));
      else toast.success(t("intervaloGravado"));
      avisarAsaasMudou();
      aoMudar();
    } finally {
      setSalvando(null);
    }
  };

  const criarPadrao = async () => {
    setSalvando("padrao");
    try {
      const res = await fetch("/api/cb/asaas/regua", { method: "POST" });
      const corpo = (await res.json().catch(() => ({}))) as { criadas?: string[]; semConexao?: boolean };
      if (!res.ok) {
        toast.error(t("erroPadrao"));
        return;
      }
      const criadas = corpo.criadas ?? [];
      toast.success(criadas.length > 0 ? t("padraoCriada", { n: criadas.length }) : t("padraoJaExistia"));
      if (corpo.semConexao) toast.warning(t("padraoSemConexao"), { duration: 10_000 });
      aoMudar();
    } finally {
      setSalvando(null);
    }
  };

  return (
    <div className="min-w-0 space-y-2 rounded-md border border-border bg-muted/30 p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 font-medium text-foreground">
          <Zap className="size-3.5" aria-hidden="true" />
          {t("titulo")}
        </p>
        <label className="flex items-center gap-2 text-foreground">
          <span>{regua.ativa ? t("estadoLigada") : t("estadoDesligada")}</span>
          <Switch checked={regua.ativa} disabled={salvando !== null} onCheckedChange={(v) => void gravar({ regua_ativa: !!v }, "interruptor")} aria-label={t("titulo")} />
        </label>
      </div>
      <p className="max-w-[62ch] text-muted-foreground">{t("desc")}</p>
      <p className={regua.ativa && regua.automacoesLigadas === 0 ? "text-amber-600 dark:text-amber-400" : !regua.ativa && regua.automacoesLigadas > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}>
        {t("automacoes", { ligadas: regua.automacoesLigadas, total: regua.automacoesTotal })}
        {regua.ativadaEm && regua.ativa ? ` · ${t("ativadaEm", { quando: new Date(regua.ativadaEm).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) })}` : ""}
        {!regua.ativa && regua.automacoesLigadas > 0 ? ` · ${t("ligadasMasDesligada")}` : ""}
        {regua.ativa && regua.automacoesLigadas === 0 ? ` · ${t("ligadaSemAutomacao")}` : ""}
      </p>
      {regua.marcosRepetidos.length > 0 && <p className="text-amber-600 dark:text-amber-400">{t("marcoRepetido", { marcos: regua.marcosRepetidos.join(", ") })}</p>}
      {regua.lembreteRepetido && <p className="text-amber-600 dark:text-amber-400">{t("lembreteRepetido")}</p>}
      {semCobranca !== null && semCobranca > 0 && <p className="text-muted-foreground">{t("excecoes", { n: semCobranca })}</p>}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="asaas-regua-intervalo">{t("intervaloLabel")}</Label>
          <div className="flex items-center gap-2">
            <Input id="asaas-regua-intervalo" type="number" min={0} max={60} value={intervalo} onChange={(e) => setIntervalo(e.target.value)} className="w-20" />
            <Button type="button" size="sm" variant="outline" disabled={salvando !== null || Number(intervalo) === regua.intervaloDias} onClick={() => void gravar({ regua_intervalo_dias: Number(intervalo) }, "intervalo")}>
              {salvando === "intervalo" ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {t("intervaloGravar")}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">{t("intervaloAjuda")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" disabled={salvando !== null} onClick={() => void criarPadrao()}>
            {salvando === "padrao" ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {t("criarPadrao")}
          </Button>
          <Link href="/automations" className="inline-flex items-center gap-1 underline">
            <LinkIcon className="size-3" aria-hidden="true" />
            {t("verAutomacoes")}
          </Link>
        </div>
      </div>
    </div>
  );
}
