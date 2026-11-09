"use client";

// Reescrita (Fase 6, última página da paridade visual) — troca o Tailwind
// ad-hoc pelas classes exatas do artefato original: .automacoes-wrap/
// .auto-page-head/.channel-card/.section-lbl/.auto-grid/.acard*/.status-pill*/
// .badge-mini*/.soon-note/.auto-pending/.empty-acard/.hist-*/.naf-*, todas já
// portadas em app/globals.css. Toda a lógica de negócio (channelHealth,
// isTrafegoAutomacao/isDemandasAutomacao/normalize, handleCreate,
// alternarEnabled, pedirExecucaoAgora, excluir, baixarBackup, histTag) segue
// exatamente igual — só a seleção de dias no formulário de criação trocou de
// checkboxes nativos (form.get) pra um estado controlado (diasSel), porque o
// artefato usa botões-pílula (.naf-dia-btn) em vez de checkbox, mas o
// resultado gravado no banco é idêntico.

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { orgIdAtual } from "@/lib/trafego/org";
import { AtualizarAgoraButton } from "@/lib/trafego/syncBar";


type Automation = {
  id: string;
  tipo: "mensagem" | "relatorio" | "lembrete" | "alerta" | "sistema";
  nome: string;
  canal: string;
  group_jid: string | null;
  conteudo: string | null;
  horario: number | null;
  dias: number[] | null;
  cond_operador: string | null;
  cond_valor: number | null;
  enabled: boolean;
  last_run_at: string | null;
  last_run_status: string | null;
  last_run_summary: string | null;
  run_requested: boolean;
  criado_em: string;
};

type HistoryRow = { id: string; automation_id: string | null; sent_at: string; status: string | null; summary: string | null };

const DIAS_LABEL = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const TIPO_ICON: Record<string, string> = {
  mensagem: "💬",
  relatorio: "📊",
  lembrete: "⏰",
  alerta: "🚨",
  sistema: "⚙️",
};

const TIPO_OPCOES: { tipo: Automation["tipo"]; label: string; desc: string }[] = [
  { tipo: "mensagem", label: "Mensagem", desc: "Texto livre, direto pro grupo" },
  { tipo: "relatorio", label: "Relatório", desc: "Envio periódico de números" },
  { tipo: "lembrete", label: "Lembrete", desc: "Aviso recorrente pro time" },
  { tipo: "alerta", label: "Alerta", desc: "Dispara quando bate uma condição" },
];

const GRUPO_LABEL: Record<string, string> = {
  "120363428455502509@g.us": "Relatórios Marketing",
  "120363429202081229@g.us": "IBOX PRIME | MARKETING",
  "120363407822014687@g.us": "IBOX PRIME | OPERACIONAL",
};

function grupoLabel(jid: string | null): string {
  if (!jid) return "—";
  return GRUPO_LABEL[jid] || jid;
}

// Compara nomes ignorando acentos/caixa — a migration 0006 pode ter sido
// rodada colando o SQL sem acentuação (ex.: "Relatorio" em vez de
// "Relatório") dependendo de como o usuário copiou o comando; casar por
// substring sem diacríticos evita que isso quebre silenciosamente os cards.
function normalize(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
function isTrafegoAutomacao(nome: string): boolean {
  return normalize(nome).includes("trafego");
}
function isDemandasAutomacao(nome: string): boolean {
  return normalize(nome).includes("demandas");
}

function fmtDateTimeBR(iso: string | null): string {
  if (!iso) return "nunca";
  return new Date(iso).toLocaleString("pt-BR");
}

function StatusPill({ enabled }: { enabled: boolean }) {
  return <span className={`status-pill ${enabled ? "ativa" : "pausada"}`}>{enabled ? "Ativa" : "Pausada"}</span>;
}

function SoonPill() {
  return <span className="status-pill embreve">Em breve</span>;
}

function BadgeMini({ status }: { status: string | null }) {
  if (!status) return <span className="badge-mini na">n/d</span>;
  const erro = status === "erro" || status === "error";
  return <span className={`badge-mini ${erro ? "err" : "ok"}`}>{erro ? "erro" : "ok"}</span>;
}

// Cards "Em produção": informativos, com os dados reais de nome/canal/destino
// vindos das 2 linhas tipo='sistema' semeadas na migration 0006 — mas SEM
// controles de pausar/horário/rodar-agora aqui, porque quem manda de verdade
// hoje ainda são os 4 scheduled tasks lendo o banco do Artifact original
// (Placa a Placa / Demandas do Dia). Dar controles que não fazem nada seria
// enganoso; a migração de verdade é a Fase 4 do plano.
function ProductionCard({ a, linkOut }: { a: Automation; linkOut: string }) {
  return (
    <div className="acard">
      <div className="acard-head">
        <span className="acard-icon">{TIPO_ICON.sistema}</span>
        <div className="ti">
          <div className="name">{a.nome}</div>
          <div className="desc">{isTrafegoAutomacao(a.nome) ? 'PDF + resumo no grupo "Relatórios Marketing"' : "Cota do dia de manhã + cobrança à noite"}</div>
        </div>
        <StatusPill enabled={a.enabled} />
      </div>
      <div className="acard-rows">
        <div className="acard-row">
          <span>Mecanismo</span>
          <b>Verificador horário (confere a cada hora)</b>
        </div>
        <div className="acard-row">
          <span>Destino</span>
          <b>{grupoLabel(a.group_jid)}</b>
        </div>
        <div className="acard-row">
          <span>Quadro / controle</span>
          <a className="link-out" href={linkOut} target="_blank" rel="noopener noreferrer">
            Abrir ↗
          </a>
        </div>
      </div>
      <p className="soon-note">Controlada hoje pelo Artifact original (scheduled task). O histórico e os controles migram pra cá na Fase 4 do plano.</p>
    </div>
  );
}

function SoonCard({ nome, desc, nota }: { nome: string; desc: string; nota: string }) {
  return (
    <div className="acard soon">
      <div className="acard-head">
        <div className="ti">
          <div className="name">{nome}</div>
          <div className="desc">{desc}</div>
        </div>
        <SoonPill />
      </div>
      <p className="soon-note">{nota}</p>
    </div>
  );
}

// Deriva o status do canal WhatsApp a partir do histórico real de execuções
// já gravado NESTE painel (automations_history). Enquanto a Fase 4 não migra
// os 4 scheduled tasks pra escrever aqui, esse histórico fica vazio de
// propósito — mostramos isso com clareza em vez de fingir um status.
function channelHealth(history: HistoryRow[]): { cls: "ok" | "down" | "unknown"; title: string; sub: string } {
  if (!history.length) {
    return {
      cls: "unknown",
      title: "Canal WhatsApp — sem histórico neste painel ainda",
      sub: "Instância uazapi · número 55 75 8845-2495. As automações em produção ainda gravam o histórico no Artifact original — chega aqui na Fase 4.",
    };
  }
  const last = history[0];
  if (last.status === "erro" || last.status === "error") {
    return { cls: "down", title: "Canal WhatsApp com problema", sub: `Última tentativa (${fmtDateTimeBR(last.sent_at)}): ${last.summary || "falha no envio"}.` };
  }
  return { cls: "ok", title: "Canal WhatsApp conectado", sub: `Instância uazapi · número 55 75 8845-2495 · confirmado no último envio, ${fmtDateTimeBR(last.sent_at)}.` };
}

export default function AutomacoesPage() {
  const supabase = createClient();
  const [accountId, setAccountId] = useState<string | null>(null);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [tipoForm, setTipoForm] = useState<Automation["tipo"]>("mensagem");
  const [diasSel, setDiasSel] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [histFilter, setHistFilter] = useState<"todas" | "trafego" | "demandas" | "custom">("todas");
  const [backupStatus, setBackupStatus] = useState<string>("");
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);

  async function carregarTudo() {
    const accId = await orgIdAtual(supabase);
    if (!accId) {
      setLoading(false);
      return;
    }
    setAccountId(accId);

    const [{ data: autoData }, { data: histData }] = await Promise.all([
      supabase.from("tr_automations").select("*").eq("org_id", accId).order("criado_em", { ascending: false }),
      supabase.from("tr_automations_history").select("id, automation_id, sent_at, status, summary").eq("org_id", accId).order("sent_at", { ascending: false }).limit(50),
    ]);

    setAutomations((autoData ?? []) as Automation[]);
    setHistory((histData ?? []) as HistoryRow[]);
    setLoading(false);
    setLastLoadedAt(new Date());
  }

  useEffect(() => {
    carregarTudo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sistemaAutomations = automations.filter((a) => a.tipo === "sistema");
  const customAutomations = automations.filter((a) => a.tipo !== "sistema");
  const trafego = sistemaAutomations.find((a) => isTrafegoAutomacao(a.nome));
  const demandas = sistemaAutomations.find((a) => isDemandasAutomacao(a.nome));
  const ch = channelHealth(history);

  const automacoesPorId = useMemo(() => Object.fromEntries(automations.map((a) => [a.id, a])), [automations]);

  function histTag(h: HistoryRow): "trafego" | "demandas" | "custom" {
    const a = h.automation_id ? automacoesPorId[h.automation_id] : null;
    if (a && isTrafegoAutomacao(a.nome)) return "trafego";
    if (a && isDemandasAutomacao(a.nome)) return "demandas";
    return "custom";
  }

  const historyFiltered = history.filter((h) => histFilter === "todas" || histTag(h) === histFilter);

  function toggleDia(i: number) {
    setDiasSel((s) => (s.includes(i) ? s.filter((x) => x !== i) : [...s, i]));
  }

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!accountId) return;
    const form = new FormData(e.currentTarget);

    await supabase.from("tr_automations").insert({
      org_id: accountId,
      tipo: tipoForm,
      nome: String(form.get("nome") || ""),
      canal: "whatsapp",
      group_jid: String(form.get("group_jid") || "") || null,
      conteudo: String(form.get("conteudo") || "") || null,
      horario: tipoForm === "alerta" ? null : form.get("horario") ? Number(form.get("horario")) : null,
      dias: tipoForm === "alerta" ? null : diasSel,
      cond_operador: tipoForm === "alerta" ? String(form.get("cond_operador") || "") || null : null,
      cond_valor: tipoForm === "alerta" && form.get("cond_valor") ? Number(form.get("cond_valor")) : null,
      enabled: true,
    });

    setShowForm(false);
    setDiasSel([]);
    carregarTudo();
  }

  async function alternarEnabled(a: Automation) {
    await supabase.from("tr_automations").update({ enabled: !a.enabled }).eq("id", a.id);
    carregarTudo();
  }

  async function pedirExecucaoAgora(a: Automation) {
    // Envia na hora pelo servidor (antes só marcava o pedido e esperava o agendador).
    if (a.tipo === "sistema") {
      await supabase.from("tr_automations").update({ run_requested: true, run_requested_at: new Date().toISOString() }).eq("id", a.id);
    } else {
      const r = await fetch("/api/automacoes/rodar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: a.id }) });
      const d = await r.json().catch(() => ({}));
      window.alert(r.ok && d.ok ? `"${a.nome}" enviada para o grupo.` : `Não foi enviada: ${d.resultado?.resumo || d.erro || "erro desconhecido"}`);
    }
    carregarTudo();
  }

  async function excluir(a: Automation) {
    if (!window.confirm(`Excluir a automação "${a.nome}"?`)) return;
    await supabase.from("tr_automations").delete().eq("id", a.id);
    carregarTudo();
  }

  async function baixarBackup() {
    if (!accountId) return;
    setBackupStatus("preparando backup…");
    try {
      const [cars, campaigns, sellers, utmLinks, autos] = await Promise.all([
        supabase.from("veiculos").select("*").eq("org_id", accountId),
        supabase.from("tr_campaigns").select("*").eq("org_id", accountId),
        supabase.from("tr_sellers").select("*").eq("org_id", accountId),
        supabase.from("tr_utm_links").select("*").eq("org_id", accountId),
        supabase.from("tr_automations").select("*").eq("org_id", accountId),
      ]);
      const payload = {
        exportadoEm: new Date().toISOString(),
        origem: "dashboard-carros",
        accountId,
        cars: cars.data ?? [],
        campaigns: campaigns.data ?? [],
        sellers: sellers.data ?? [],
        utmLinks: utmLinks.data ?? [],
        automations: autos.data ?? [],
      };
      const json = JSON.stringify(payload, null, 2);
      const filename = `ibox-dashboard-carros-backup-${new Date().toISOString().slice(0, 10)}.json`;
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setBackupStatus(`Backup baixado ✓ (${filename})`);
    } catch {
      setBackupStatus("Não foi possível gerar o backup agora — tenta de novo.");
    }
  }

  return (
    <main className="automacoes-wrap">
      <div className="auto-page-head">
        <div>
          <h2>Automações</h2>
          <p>Tudo que roda sozinho pela iBox Prime — relatórios, cobranças de equipe e as que você mesmo criar.</p>
          <p className="text-[11px] mt-1" style={{ color: "var(--tr-text-dim)" }}>
            {lastLoadedAt ? `Última atualização: ${lastLoadedAt.toLocaleString("pt-BR")}` : "Carregando…"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AtualizarAgoraButton syncing={loading} onClick={carregarTudo} idleLabel="↻ Atualizar" busyLabel="Atualizando…" />
          <button className="btn btn-accent" onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Cancelar" : "+ Nova automação"}
          </button>
        </div>
      </div>

      <div className={`channel-card${ch.cls === "down" ? " down" : ch.cls === "unknown" ? " unknown" : ""}`}>
        <span className="channel-dot" />
        <div className="channel-info">
          <div className="ttl">{ch.title}</div>
          <div className="sub">{ch.sub}</div>
        </div>
      </div>

      {showForm && (
        <div className="panel" style={{ padding: 18, marginBottom: 26 }}>
          <form onSubmit={handleCreate}>
            <div className="naf-grid">
              <div className="naf-row">
                <label>Nome da automação</label>
                <input name="nome" type="text" required placeholder="Nome da automação" />
              </div>
              <div className="naf-row">
                <label>Grupo do WhatsApp</label>
                <select name="group_jid" defaultValue="120363429202081229@g.us">
                  <option value="120363429202081229@g.us">IBOX PRIME | MARKETING</option>
                  <option value="120363428455502509@g.us">Relatórios Marketing</option>
                  <option value="120363407822014687@g.us">IBOX PRIME | OPERACIONAL</option>
                </select>
              </div>
            </div>

            <div className="naf-row">
              <label>Tipo</label>
              <div className="naf-tipos">
                {TIPO_OPCOES.map((opt) => (
                  <button key={opt.tipo} type="button" className={`naf-tipo-btn${tipoForm === opt.tipo ? " on" : ""}`} onClick={() => setTipoForm(opt.tipo)}>
                    <span className="t">
                      {TIPO_ICON[opt.tipo]} {opt.label}
                    </span>
                    <span className="d">{opt.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="naf-row">
              <label>Conteúdo</label>
              <textarea name="conteudo" placeholder="Texto da mensagem (use {{valor}} em alertas para incluir o gasto atual)" rows={3} />
            </div>

            {tipoForm === "alerta" ? (
              <div className="naf-row">
                <label>Condição</label>
                <div className="naf-cond-row">
                  <span className="naf-hint" style={{ alignSelf: "center" }}>
                    Disparar quando o gasto de hoje for
                  </span>
                  <select name="cond_operador">
                    <option value=">">maior que</option>
                    <option value=">=">maior ou igual</option>
                    <option value="<">menor que</option>
                    <option value="<=">menor ou igual</option>
                  </select>
                  <input name="cond_valor" type="number" step="0.01" placeholder="Valor (R$)" />
                </div>
              </div>
            ) : (
              <>
                <div className="naf-row">
                  <label>Horário</label>
                  <input name="horario" type="number" min={0} max={23} placeholder="0-23" style={{ maxWidth: 120 }} />
                </div>
                <div className="naf-row">
                  <label>Dias da semana</label>
                  <div className="naf-dias">
                    {DIAS_LABEL.map((label, i) => (
                      <button key={i} type="button" className={`naf-dia-btn${diasSel.includes(i) ? " on" : ""}`} onClick={() => toggleDia(i)}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            <button type="submit" className="btn btn-accent" style={{ marginTop: 4 }}>
              Salvar automação
            </button>
          </form>
        </div>
      )}

      {/* Em produção */}
      <div className="section-lbl">Em produção</div>
      <div className="auto-grid">
        {trafego && <ProductionCard a={trafego} linkOut="https://claude.ai/code/artifact/87e034d3-ce89-431d-88f4-ceaee35d28aa" />}
        {demandas && <ProductionCard a={demandas} linkOut="https://claude.ai/code/artifact/0f7d2d26-52a0-46ce-9559-dcc62881301a" />}
        {!trafego && !demandas && !loading && <div className="empty-acard">Seed das automações de sistema ainda não rodou nesta conta (migration 0006).</div>}
      </div>

      {/* Suas automações (custom) */}
      <div className="section-lbl">Suas automações</div>
      {customAutomations.length > 0 && (
        <p className="auto-pending" style={{ marginBottom: 14 }}>
          “Disparar agora” envia para o grupo na hora. Na hora marcada, elas saem sozinhas pelo agendador de hora em hora do sistema (alertas de gasto conferem o gasto de hoje direto no Meta).
        </p>
      )}
      {loading ? (
        <p style={{ color: "var(--tr-text-dim)", fontSize: 13 }}>Carregando…</p>
      ) : customAutomations.length === 0 ? (
        <div className="empty-acard">Nenhuma automação personalizada cadastrada ainda.</div>
      ) : (
        <div className="auto-grid">
          {customAutomations.map((a) => (
            <div key={a.id} className="acard">
              <div className="acard-head">
                <span className="acard-icon">{TIPO_ICON[a.tipo] ?? "•"}</span>
                <div className="ti">
                  <div className="name">{a.nome}</div>
                  <div className="desc">
                    {a.tipo} · {grupoLabel(a.group_jid)}
                  </div>
                </div>
                <StatusPill enabled={a.enabled} />
              </div>
              <div className="acard-rows">
                <div className="acard-row">
                  <span>{a.tipo === "alerta" ? "Condição" : "Agenda"}</span>
                  <b>
                    {a.tipo === "alerta"
                      ? `gasto do dia ${a.cond_operador ?? ""} R$ ${(a.cond_valor ?? 0).toFixed(2)}`
                      : `${a.horario !== null ? `${a.horario}h` : "sem horário"} · ${(a.dias ?? []).map((d) => DIAS_LABEL[d]).join(", ") || "sem dias"}`}
                  </b>
                </div>
              </div>
              <div className="acard-lastrun">
                <BadgeMini status={a.last_run_status} /> Último disparo: <b>{fmtDateTimeBR(a.last_run_at)}</b>
              </div>
              <div className="acard-controls">
                <button className="btn btn-ghost btn-sm" onClick={() => alternarEnabled(a)}>
                  {a.enabled ? "⏸ Pausar" : "▶ Retomar"}
                </button>
                {a.run_requested ? (
                  <span className="badge-mini na">⏳ pedido</span>
                ) : (
                  <button className="btn btn-accent btn-sm" onClick={() => pedirExecucaoAgora(a)}>
                    📤 Rodar agora
                  </button>
                )}
                <button className="btn btn-danger btn-sm" onClick={() => excluir(a)}>
                  🗑 Excluir
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Em breve */}
      <div className="section-lbl">Em breve</div>
      <div className="auto-grid">
        <SoonCard
          nome="Alerta de novas oportunidades"
          desc="Avisa na hora quando chega lead, mensagem ou contato novo"
          nota="Planejada — falta decidir a fonte de dados (uazapi) antes de construir."
        />
        <SoonCard nome="Adicionar carros no site" desc="Publica automaticamente quando um carro novo entra no estoque" nota="Planejada — deixada por último, a pedido do usuário." />
      </div>

      {/* Histórico */}
      <div className="section-lbl">Histórico</div>
      <div className="hist-toolbar">
        {(
          [
            ["todas", "Todas"],
            ["trafego", "Tráfego"],
            ["demandas", "Demandas do time"],
            ["custom", "Suas automações"],
          ] as const
        ).map(([v, label]) => (
          <button key={v} onClick={() => setHistFilter(v)} className={`chip-toggle${histFilter === v ? " on" : ""}`}>
            {label}
          </button>
        ))}
      </div>
      {historyFiltered.length === 0 ? (
        <div className="empty-acard">Nenhum envio registrado ainda{histFilter !== "todas" ? " para esse filtro" : ""}.</div>
      ) : (
        <div className="hist-list">
          {historyFiltered.map((h) => {
            const a = h.automation_id ? automacoesPorId[h.automation_id] : null;
            return (
              <div key={h.id} className="hist-item">
                <span className="hist-date">{fmtDateTimeBR(h.sent_at)}</span>
                <span className="hist-icon">{a ? TIPO_ICON[a.tipo] ?? "•" : "•"}</span>
                <span className="hist-summary">
                  <b>{a ? a.nome : "Automação removida"}</b>
                  {h.summary && <span className="sub"> {h.summary}</span>}
                </span>
                <BadgeMini status={h.status} />
              </div>
            );
          })}
        </div>
      )}

      {/* Backup / migração */}
      <div className="section-lbl">Backup / migração</div>
      <p style={{ color: "var(--tr-text-dim)", fontSize: 12.5, marginBottom: 10 }}>
        Carros, campanhas, vendedores, links UTM e automações salvos aqui no Postgres — baixe uma cópia como salvaguarda manual.
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <button onClick={baixarBackup} className="btn btn-accent">
          ⬇ Baixar backup (.json)
        </button>
        {backupStatus && <span style={{ color: "var(--tr-text-dim)", fontSize: 12 }}>{backupStatus}</span>}
      </div>
    </main>
  );
}
