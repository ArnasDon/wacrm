"use client";

// Reescrita (Fase 3.9, retrabalhada na Fase 6 pra usar os tokens/classes
// exatos do artefato original — .panel, .kpi-group-lbl, .btn.btn-accent,
// var(--tr-good)/var(--tr-bad)/var(--tr-gold-2)) — não existe uma classe CSS dedicada
// pra "card de conexão" no artefato original (essa tela usava os mesmos
// tokens de cor direto, sem nomear um componente próprio), então o porte
// aqui é: trocar o Tailwind ad-hoc por esses tokens e classes compartilhadas
// já existentes em app/globals.css, mantendo o mesmo resultado visual.

import { useEffect, useState } from "react";
import { ConexaoMeta } from "./conexao-meta";
import { ConexoesOpcionais } from "./conexoes-opcionais";
import { createClient } from "@/lib/supabase/client";
import { orgIdAtual } from "@/lib/trafego/org";


type Credential = { id: string; provedor: string; referencia_externa: string | null; ativo: boolean; conectado_em: string };
type SyncRun = { provedor: string; status: string; concluido_em: string | null; erro: string | null };
type HistoryRow = { sent_at: string; status: string | null; summary: string | null };

const NOMES: Record<string, string> = {
  facebook: "Meta Ads (campanhas)",
  instagram: "Instagram (orgânico)",
  ga4: "Google Analytics 4 — site",
  ga4_quiz: "Google Analytics 4 — quiz",
};

const DESCRICOES: Record<string, string> = {
  facebook: "Meta Ads direto (ou Windsor.ai, se o Meta falhar)",
  instagram: "Windsor.ai · conector instagram",
  ga4: "Windsor.ai · conector googleanalytics4 (iboxprime.com.br)",
  ga4_quiz: "Windsor.ai · conector googleanalytics4 (consultoria.iboxprime.com.br)",
};

const ICONES: Record<string, string> = {
  facebook: "📈",
  instagram: "📷",
  ga4: "🌐",
  ga4_quiz: "🌐",
};

function Pill({ label, tone }: { label: string; tone: "ok" | "erro" | "espera" | "embreve" }) {
  const colors: Record<string, { bg: string; fg: string }> = {
    ok: { bg: "var(--tr-good-bg, rgba(95,201,140,.15))", fg: "var(--tr-good)" },
    erro: { bg: "var(--tr-bad-bg, rgba(224,110,110,.14))", fg: "var(--tr-bad)" },
    espera: { bg: "var(--tr-warn-bg)", fg: "var(--tr-warn)" },
    embreve: { bg: "var(--tr-surface-2)", fg: "var(--tr-text-dim)" },
  };
  const c = colors[tone];
  return (
    <span className="badge" style={{ background: c.bg, color: c.fg, flexShrink: 0 }}>
      {label}
    </span>
  );
}

function ConnCard({
  icon,
  nome,
  desc,
  pill,
  rows,
  note,
}: {
  icon?: string;
  nome: string;
  desc: string;
  pill: React.ReactNode;
  rows?: [string, string][];
  note?: string | null;
}) {
  return (
    <div className="panel" style={{ display: "flex", flexDirection: "column", gap: 12, padding: 16 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          {icon && (
            <span
              style={{
                width: 30,
                height: 30,
                borderRadius: 8,
                background: "var(--tr-surface-2)",
                border: "1px solid var(--tr-border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 15,
                flexShrink: 0,
              }}
            >
              {icon}
            </span>
          )}
          <div>
            <p style={{ fontWeight: 600, fontSize: 13.5 }}>{nome}</p>
            <p style={{ fontSize: 12, marginTop: 2, color: "var(--tr-text-dim)" }}>{desc}</p>
          </div>
        </div>
        {pill}
      </div>
      {rows && rows.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
          {rows.map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--tr-text-dim)" }}>{k}</span>
              <b>{v}</b>
            </div>
          ))}
        </div>
      )}
      {note && (
        <p style={{ fontSize: 12, padding: "6px 8px", borderRadius: 6, background: "var(--tr-surface-2)", color: "var(--tr-text-dim)" }}>{note}</p>
      )}
    </div>
  );
}

function fmtDateTimeBR(iso: string | null): string {
  if (!iso) return "nunca";
  return new Date(iso).toLocaleString("pt-BR");
}

// Status das conexões Windsor.ai + histórico de sincronização (sync_runs) —
// populadas pela Fase 2 (app/api/sync/windsor/route.ts, cron diário via
// vercel.json). Fase 3.9 adiciona os 2 cards fixos que o Artifact sempre
// mostrou (Banco de dados, WhatsApp) e que aqui não vinham de
// integration_credentials por serem infraestrutura própria do painel, não
// conectores Windsor.
export default function ConexoesPage() {
  const supabase = createClient();
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [runsByProvider, setRunsByProvider] = useState<Record<string, SyncRun>>({});
  const [automationsHistory, setAutomationsHistory] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [dbCheck, setDbCheck] = useState<"checando" | "ok" | "erro">("checando");

  async function carregarTudo() {
    const accId = await orgIdAtual(supabase);
    if (!accId) {
      setLoading(false);
      setDbCheck("erro");
      return;
    }
    // "Banco de dados" está conectado por definição se a query acima
    // funcionou — não é um serviço externo, é a própria infra do painel.
    setDbCheck("ok");

    const [{ data: credsData }, { data: runsData }, { data: histData }] = await Promise.all([
      supabase.from("tr_integration_credentials").select("id, provedor, referencia_externa, ativo, conectado_em").eq("org_id", accId),
      supabase.from("tr_sync_runs").select("provedor, status, concluido_em, erro").eq("org_id", accId).order("concluido_em", { ascending: false, nullsFirst: false }).limit(50),
      supabase.from("tr_automations_history").select("sent_at, status, summary").eq("org_id", accId).order("sent_at", { ascending: false }).limit(1),
    ]);

    setCredentials((credsData ?? []) as Credential[]);
    setAutomationsHistory((histData ?? []) as HistoryRow[]);

    const latest: Record<string, SyncRun> = {};
    for (const run of (runsData ?? []) as SyncRun[]) {
      if (!latest[run.provedor]) latest[run.provedor] = run;
    }
    setRunsByProvider(latest);
    setLoading(false);
  }

  useEffect(() => {
    carregarTudo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lastSyncAt = Object.values(runsByProvider).reduce<string | null>((max, run) => {
    if (!run.concluido_em) return max;
    if (!max || run.concluido_em > max) return run.concluido_em;
    return max;
  }, null);

  async function sincronizarAgora() {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const res = await fetch("/api/trafego/sync/manual", { method: "POST" });
      if (!res.ok) throw new Error("falhou");
      setSyncMessage("Sincronização disparada — os números abaixo atualizam em instantes.");
    } catch {
      setSyncMessage("Não foi possível disparar a sincronização agora. Ela ainda roda automaticamente todo dia.");
    }
    setSyncing(false);
    setTimeout(carregarTudo, 3000);
  }

  const lastAuto = automationsHistory[0];
  const whatsappPill: { tone: "ok" | "erro" | "embreve"; label: string } = !lastAuto
    ? { tone: "embreve", label: "Sem histórico" }
    : lastAuto.status === "erro" || lastAuto.status === "error"
      ? { tone: "erro", label: "Com problema" }
      : { tone: "ok", label: "Conectado" };

  return (
    <main className="px-6 py-8 max-w-7xl mx-auto" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div className="section-ttl" style={{ marginTop: 0, paddingTop: 0, borderTop: "none" }}>
            Conexões
          </div>
          <p style={{ fontSize: 12.5, marginTop: 2, color: "var(--tr-text-dim)" }}>Onde o painel busca dado sozinho, e o status de cada uma agora.</p>
          <p className="text-[11px] mt-1" style={{ color: "var(--tr-text-dim)" }}>
            {lastSyncAt ? `Última sincronização: ${new Date(lastSyncAt).toLocaleString("pt-BR")}` : "Ainda sem sincronização registrada"}
          </p>
        </div>
        <button className="btn btn-accent" onClick={sincronizarAgora} disabled={syncing}>
          {syncing ? "Sincronizando…" : "Sincronizar agora"}
        </button>
      </div>

      {syncMessage && <p style={{ fontSize: 13, marginTop: -12, color: "var(--tr-text-dim)" }}>{syncMessage}</p>}

      <ConexaoMeta aoSalvar={carregarTudo} />
      <ConexoesOpcionais />

      <a
        href="/trafego/importar"
        style={{ display: "block", background: "var(--tr-surface)", border: "1px solid var(--tr-border)", borderRadius: 10, padding: 16, textDecoration: "none", color: "var(--tr-text)" }}
      >
        <b style={{ fontSize: 14 }}>Trazer os dados do painel de tráfego antigo →</b>
        <p style={{ fontSize: 12.5, color: "var(--tr-text-dim)", margin: "4px 0 0" }}>
          Carros, campanhas com o histórico, vendedores, links UTM e automações. Pode repetir sem duplicar.
        </p>
      </a>

      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="kpi-group-lbl" style={{ margin: 0 }}>
          Fontes de dados ligadas
        </div>
        {loading ? (
          <div className="empty-state">Carregando…</div>
        ) : credentials.length === 0 ? (
          <div className="empty-state">Nenhuma conexão configurada ainda.</div>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
            {credentials.map((cred) => {
              const run = runsByProvider[cred.provedor];
              const pillTone: "ok" | "erro" | "embreve" = !cred.ativo ? "embreve" : run?.status === "erro" ? "erro" : run ? "ok" : "embreve";
              const pillLabel = !cred.ativo ? "Desativado" : run?.status === "erro" ? "Falhou" : run ? "Conectado" : "Aguardando 1ª sync";
              return (
                <ConnCard
                  key={cred.id}
                  icon={ICONES[cred.provedor] ?? "🔌"}
                  nome={NOMES[cred.provedor] ?? cred.provedor}
                  desc={`${DESCRICOES[cred.provedor] ?? "Windsor.ai"} · conta ${cred.referencia_externa ?? "—"}`}
                  pill={<Pill label={pillLabel} tone={pillTone} />}
                  rows={[["Última sincronização", run?.concluido_em ? fmtDateTimeBR(run.concluido_em) : "—"]]}
                  note={run?.status === "erro" ? run.erro || "Última sincronização falhou." : null}
                />
              );
            })}
          </div>
        )}
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="kpi-group-lbl" style={{ margin: 0 }}>
          Infraestrutura do painel
        </div>
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
          <ConnCard
            icon="🗄"
            nome="Banco de dados"
            desc="Mesmo banco do CRM — carros, campanhas, vendedores, automações e links UTM ficam junto com conversas e contatos"
            pill={<Pill label={dbCheck === "ok" ? "Conectado" : dbCheck === "erro" ? "Sem acesso" : "Checando…"} tone={dbCheck === "ok" ? "ok" : dbCheck === "erro" ? "erro" : "embreve"} />}
          />
          <ConnCard
            icon="💬"
            nome="WhatsApp (uazapi)"
            desc="Número 55 75 8845-2495 · usado pelas automações de tráfego, demandas e personalizadas"
            pill={<Pill label={whatsappPill.label} tone={whatsappPill.tone} />}
            note={
              lastAuto
                ? `Status deduzido do último envio registrado neste painel, ${fmtDateTimeBR(lastAuto.sent_at)}${lastAuto.summary ? " — " + lastAuto.summary : ""}.`
                : 'O painel não consegue checar a API do uazapi direto. As automações em produção hoje gravam o histórico no Artifact original — esse status aqui fica "sem histórico" até a Fase 4 migrar isso pra cá.'
            }
          />
        </div>
      </section>
    </main>
  );
}
