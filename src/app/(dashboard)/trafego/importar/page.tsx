"use client";

import { HistoricoMeta } from "./historico-meta";
// Importação única do painel de tráfego antigo (Placa a Placa) para o
// sistema único. Roda inteira no navegador de quem é sócio/gestor:
//   1. entra no painel antigo com o login da própria pessoa (ou aproveita a
//      sessão que já existe em *.crmwga.com);
//   2. lê tudo da conta dela no painel (respeitando as permissões de lá);
//   3. grava nas tabelas do módulo Tráfego da loja, mantendo os mesmos IDs.
// Nenhuma senha ou chave passa pelo servidor do CRM. Pode rodar quantas vezes
// quiser: grava por ID (upsert), então repetir só atualiza, nunca duplica.

import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { orgIdAtual } from "@/lib/trafego/org";
import { fetchAll } from "@/lib/trafego/fetchAll";

// Projeto Supabase do painel antigo. A chave abaixo é a PÚBLICA (a mesma que
// o painel usa no navegador); o que cada um pode ler é decidido pelo RLS de lá.
const PAINEL_URL = "https://nqxhnlinnirhgquvlucn.supabase.co";
const PAINEL_CHAVE_PUBLICA = "sb_publishable_RWNnCLLeA2oQJlQgVQsROg_cZ1TbueT";

type Linha = Record<string, unknown>;

// Ordem importa: quem é referenciado vem antes de quem referencia.
const ETAPAS: { origem: string; destino: string; nome: string; ajustar?: (l: Linha) => Linha }[] = [
  { origem: "sellers", destino: "tr_sellers", nome: "Vendedores" },
  { origem: "link_destinos", destino: "tr_link_destinos", nome: "Destinos de link" },
  {
    origem: "cars",
    destino: "veiculos",
    nome: "Carros",
    // vendedor_user_id apontava para usuários do painel antigo (outro cadastro).
    ajustar: ({ vendedor_user_id: _v, ...resto }) => resto,
  },
  { origem: "campaigns", destino: "tr_campaigns", nome: "Campanhas" },
  { origem: "campaign_metrics_daily", destino: "tr_campaign_metrics_daily", nome: "Métricas por dia" },
  { origem: "campaign_metrics_hourly", destino: "tr_campaign_metrics_hourly", nome: "Métricas por hora" },
  { origem: "metrics_daily", destino: "tr_metrics_daily", nome: "Instagram e Google Analytics" },
  { origem: "utm_links", destino: "tr_utm_links", nome: "Links UTM" },
  { origem: "automations", destino: "tr_automations", nome: "Automações e alertas" },
  { origem: "automations_history", destino: "tr_automations_history", nome: "Histórico das automações" },
  { origem: "integration_credentials", destino: "tr_integration_credentials", nome: "Conexões" },
];

type Status = { nome: string; lidos: number; gravados: number; erro?: string; feito: boolean };

function dominioCookie(): string | undefined {
  const h = window.location.hostname;
  return h === "crmwga.com" || h.endsWith(".crmwga.com") ? ".crmwga.com" : undefined;
}

export default function ImportarPainelAntigo() {
  const crm = createClient();
  const painel = useMemo<SupabaseClient>(
    () =>
      createBrowserClient(PAINEL_URL, PAINEL_CHAVE_PUBLICA, {
        // Cliente separado do CRM (sem isso o @supabase/ssr devolveria o mesmo cliente).
        isSingleton: false,
        cookieOptions: typeof window !== "undefined" && dominioCookie() ? { domain: dominioCookie() } : undefined,
      }),
    [],
  );

  const [orgId, setOrgId] = useState<string | null>(null);
  const [emailPainel, setEmailPainel] = useState<string | null>(null);
  const [verificando, setVerificando] = useState(true);
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erroLogin, setErroLogin] = useState<string | null>(null);
  const [rodando, setRodando] = useState(false);
  const [status, setStatus] = useState<Status[]>([]);
  const [fim, setFim] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setOrgId(await orgIdAtual(crm));
      const { data } = await painel.auth.getUser();
      setEmailPainel(data.user?.email ?? null);
      setVerificando(false);
    })();
  }, [crm, painel]);

  async function entrarNoPainel(e: React.FormEvent) {
    e.preventDefault();
    setErroLogin(null);
    const { data, error } = await painel.auth.signInWithPassword({ email, password: senha });
    setSenha("");
    if (error || !data.user) {
      setErroLogin("E-mail ou senha do painel antigo não conferem.");
      return;
    }
    setEmailPainel(data.user.email ?? email);
  }

  async function importar() {
    if (!orgId) return;
    setRodando(true);
    setFim(null);
    const inicial: Status[] = ETAPAS.map((e) => ({ nome: e.nome, lidos: 0, gravados: 0, feito: false }));
    setStatus(inicial);
    const atualizar = (i: number, p: Partial<Status>) =>
      setStatus((s) => s.map((x, k) => (k === i ? { ...x, ...p } : x)));

    // Conta do painel antigo de quem está logado lá.
    const { data: membros, error: erroConta } = await painel.from("account_users").select("account_id").limit(1);
    const contaPainel = (membros?.[0] as { account_id?: string } | undefined)?.account_id;
    if (erroConta || !contaPainel) {
      setFim("Não achei a sua conta no painel antigo. Confira se entrou com o e-mail certo.");
      setRodando(false);
      return;
    }

    let falhas = 0;
    for (let i = 0; i < ETAPAS.length; i++) {
      const etapa = ETAPAS[i];
      const { data, error } = await fetchAll<Linha>((de, ate) =>
        painel.from(etapa.origem).select("*").eq("account_id", contaPainel).order("id").range(de, ate),
      );
      if (error) {
        falhas++;
        atualizar(i, { erro: `leitura: ${(error as { message?: string }).message ?? String(error)}`, feito: true });
        continue;
      }
      atualizar(i, { lidos: data.length });
      const linhas = data.map((l) => {
        const { account_id: _conta, ...resto } = l;
        const ajustada = etapa.ajustar ? etapa.ajustar(resto) : resto;
        return { ...ajustada, org_id: orgId };
      });
      let gravados = 0;
      for (let k = 0; k < linhas.length; k += 500) {
        const lote = linhas.slice(k, k + 500);
        const { error: erroGravar } = await crm.from(etapa.destino).upsert(lote, { onConflict: "id" });
        if (erroGravar) {
          falhas++;
          atualizar(i, { erro: `gravação: ${erroGravar.message}` });
          break;
        }
        gravados += lote.length;
        atualizar(i, { gravados });
      }
      atualizar(i, { feito: true });
    }

    // Projeto do estoque do site (fica guardado no servidor).
    const { data: contaInfo } = await painel.from("accounts").select("estoque_firestore_projeto").eq("id", contaPainel).maybeSingle();
    const projeto = (contaInfo as { estoque_firestore_projeto?: string } | null)?.estoque_firestore_projeto;
    if (projeto) {
      await fetch("/api/trafego/conexao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estoqueProjeto: projeto }),
      });
    }

    setFim(
      falhas
        ? `Terminou com ${falhas} problema(s). Os itens com erro estão marcados abaixo; pode rodar de novo depois de corrigir.`
        : "Importação concluída. Tudo o que estava no painel antigo agora está no sistema único.",
    );
    setRodando(false);
  }

  return (
    <main className="px-6 py-8 max-w-3xl mx-auto" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <div className="section-ttl" style={{ marginTop: 0, paddingTop: 0, borderTop: "none" }}>
          Trazer os dados do painel de tráfego antigo
        </div>
        <p style={{ fontSize: 13, color: "var(--tr-text-dim)", marginTop: 4 }}>
          Copia carros, campanhas com todo o histórico de métricas, vendedores, links UTM, automações e conexões para
          dentro do sistema. O painel antigo não é alterado. Pode repetir sem medo: nada é duplicado.
        </p>
      </div>

      {verificando ? (
        <div className="empty-state">Verificando…</div>
      ) : !orgId ? (
        <div className="empty-state">Sua conta não está ligada a uma loja.</div>
      ) : !emailPainel ? (
        <form
          onSubmit={entrarNoPainel}
          style={{ display: "flex", flexDirection: "column", gap: 10, background: "var(--tr-surface)", border: "1px solid var(--tr-border)", borderRadius: 10, padding: 16 }}
        >
          <b style={{ fontSize: 14 }}>Entre com o login do painel antigo</b>
          <p style={{ fontSize: 12.5, color: "var(--tr-text-dim)", margin: 0 }}>
            O mesmo e-mail e senha que você usava no painel de tráfego. A senha vai direto para o painel antigo, não fica guardada aqui.
          </p>
          <input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mail"
            style={{ background: "var(--tr-surface-2)", border: "1px solid var(--tr-border)", borderRadius: 8, padding: "8px 10px", color: "var(--tr-text)" }} />
          <input type="password" required autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="Senha"
            style={{ background: "var(--tr-surface-2)", border: "1px solid var(--tr-border)", borderRadius: 8, padding: "8px 10px", color: "var(--tr-text)" }} />
          {erroLogin && <p style={{ color: "var(--tr-bad)", fontSize: 12.5, margin: 0 }}>{erroLogin}</p>}
          <button className="btn btn-accent" type="submit">Entrar no painel antigo</button>
        </form>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={{ fontSize: 13, margin: 0 }}>
            Painel antigo: <b>{emailPainel}</b>
          </p>
          <button className="btn btn-accent" onClick={importar} disabled={rodando} style={{ alignSelf: "flex-start" }}>
            {rodando ? "Importando…" : status.length ? "Importar de novo" : "Importar agora"}
          </button>
          {status.length > 0 && (
            <table className="vendtable" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Item</th>
                  <th className="num">No painel</th>
                  <th className="num">Gravados</th>
                  <th style={{ textAlign: "left" }}>Situação</th>
                </tr>
              </thead>
              <tbody>
                {status.map((s) => (
                  <tr key={s.nome}>
                    <td>{s.nome}</td>
                    <td className="num">{s.lidos}</td>
                    <td className="num">{s.gravados}</td>
                    <td style={{ color: s.erro ? "var(--tr-bad)" : s.feito ? "var(--tr-good)" : "var(--tr-text-dim)" }}>
                      {s.erro ? s.erro : s.feito ? (s.gravados === s.lidos ? "OK" : "Incompleto") : "…"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {fim && <p style={{ fontSize: 13, margin: 0 }}>{fim}</p>}
        </div>
      )}
      <HistoricoMeta />
    </main>
  );
}
