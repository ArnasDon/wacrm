"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Car, CalendarClock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Contact } from "@/types";

// Bloco da ficha do cliente (Caixa de entrada): carro de interesse, origem e
// visitas. O carro vem do Pátio (estoque do site); a ligação fica no contato.

type CarroLista = { id: string; brand?: string; model?: string; versao?: string; year?: string | number; img?: string; status?: string; finance?: { sale_price?: number } };
type Visita = { id: string; quando: string; status: string; veiculo_site_id: string | null; obs: string | null };

let estoqueEmCache: Promise<CarroLista[]> | null = null;
function estoque(): Promise<CarroLista[]> {
  estoqueEmCache ??= fetch("/api/patio", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : { carros: [] }))
    .then((d) => (d.carros ?? []) as CarroLista[])
    .catch(() => []);
  return estoqueEmCache;
}

const nome = (c: CarroLista) => [c.brand, c.model, c.versao].filter(Boolean).join(" ");
const brl = (v?: number) => (v ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }) : "");
const ORIGENS = ["Anúncio (Meta)", "Site", "Instagram", "Indicação", "Passou na loja", "OLX / Webmotors", "iBox Club", "Outro"];
const STATUS: Record<string, string> = { agendada: "Agendada", realizada: "Veio", faltou: "Não veio", cancelada: "Cancelada" };

export function CarroDoCliente({ contact }: { contact: Contact }) {
  const [carros, setCarros] = useState<CarroLista[]>([]);
  const [carroId, setCarroId] = useState<string | null>(contact.veiculo_site_id ?? null);
  const [origem, setOrigem] = useState<string>(contact.origem ?? "");
  const [escolhendo, setEscolhendo] = useState(false);
  const [busca, setBusca] = useState("");
  const [visitas, setVisitas] = useState<Visita[]>([]);
  const [quando, setQuando] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    estoque().then(setCarros);
  }, []);

  useEffect(() => {
    createClient()
      .from("visitas")
      .select("id, quando, status, veiculo_site_id, obs")
      .eq("contact_id", contact.id)
      .order("quando", { ascending: false })
      .limit(10)
      .then(({ data }) => setVisitas((data ?? []) as Visita[]));
  }, [contact.id]);

  const carro = carros.find((c) => c.id === carroId) ?? null;
  const opcoes = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return carros
      .filter((c) => c.status !== "sold" && c.status !== "review")
      .filter((c) => !q || [c.brand, c.model, c.versao, c.year].join(" ").toLowerCase().includes(q))
      .slice(0, 8);
  }, [carros, busca]);

  async function salvarContato(campos: Partial<Pick<Contact, "veiculo_site_id" | "origem">>) {
    const { error } = await createClient().from("contacts").update(campos).eq("id", contact.id);
    setAviso(error ? "Não foi possível salvar. A migration 053 foi aplicada?" : null);
    return !error;
  }

  async function escolher(id: string | null) {
    if (await salvarContato({ veiculo_site_id: id })) {
      setCarroId(id);
      setEscolhendo(false);
      setBusca("");
    }
  }

  async function agendar() {
    if (!quando) return;
    const { data, error } = await createClient()
      .from("visitas")
      .insert({ account_id: contact.account_id, contact_id: contact.id, veiculo_site_id: carroId, quando: new Date(quando).toISOString() })
      .select("id, quando, status, veiculo_site_id, obs")
      .single();
    if (error) setAviso("Não foi possível agendar.");
    else {
      setVisitas([data as Visita, ...visitas]);
      setQuando("");
    }
  }

  async function mudarStatus(v: Visita, status: string) {
    const { error } = await createClient().from("visitas").update({ status }).eq("id", v.id);
    if (!error) setVisitas(visitas.map((x) => (x.id === v.id ? { ...x, status } : x)));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <Car className="h-3 w-3" /> Carro de interesse
      </div>

      {carro && !escolhendo ? (
        <div className="rounded-lg border border-border p-2">
          <Link href={`/patio/${carro.id}`} className="flex gap-3">
            {carro.img ? (
              // eslint-disable-next-line @next/next/no-img-element -- foto do estoque do site
              <img src={carro.img} alt="" className="h-12 w-16 shrink-0 rounded object-cover" />
            ) : (
              <span className="h-12 w-16 shrink-0 rounded bg-muted" />
            )}
            <span className="min-w-0 text-sm">
              <span className="block truncate font-medium text-foreground">{nome(carro)}</span>
              <span className="block text-xs text-muted-foreground">{String(carro.year ?? "")} · {brl(carro.finance?.sale_price)}</span>
            </span>
          </Link>
          <button type="button" onClick={() => setEscolhendo(true)} className="mt-2 text-xs text-primary hover:underline">Trocar carro</button>
        </div>
      ) : (
        <div className="space-y-2">
          {carroId && !carro && carros.length > 0 && <p className="px-1 text-xs text-muted-foreground">O carro ligado não está mais no pátio.</p>}
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            onFocus={() => setEscolhendo(true)}
            placeholder="Buscar carro do pátio…"
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            aria-label="Buscar carro do pátio"
          />
          {escolhendo && (
            <ul className="max-h-56 overflow-auto rounded-md border border-border">
              {opcoes.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => escolher(c.id)} className="flex w-full justify-between gap-2 px-2 py-1.5 text-left text-sm hover:bg-muted">
                    <span className="truncate">{nome(c)} {String(c.year ?? "")}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{brl(c.finance?.sale_price)}</span>
                  </button>
                </li>
              ))}
              {opcoes.length === 0 && <li className="px-2 py-1.5 text-xs text-muted-foreground">{carros.length ? "Nenhum carro com esse nome." : "Carregando o pátio…"}</li>}
              {carroId && (
                <li><button type="button" onClick={() => escolher(null)} className="w-full px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted">Tirar o carro deste cliente</button></li>
              )}
            </ul>
          )}
        </div>
      )}

      <label className="block px-1 text-xs text-muted-foreground">
        De onde veio
        <select
          value={origem}
          onChange={async (e) => { const v = e.target.value; if (await salvarContato({ origem: v || null })) setOrigem(v); }}
          className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
        >
          <option value="">Não informado</option>
          {ORIGENS.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </label>

      <div className="flex items-center gap-2 px-1 pt-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <CalendarClock className="h-3 w-3" /> Visitas
      </div>
      <div className="flex gap-2">
        <input type="datetime-local" value={quando} onChange={(e) => setQuando(e.target.value)} aria-label="Dia e hora da visita" className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm" />
        <button type="button" onClick={agendar} disabled={!quando} className="rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50">Agendar</button>
      </div>
      {visitas.map((v) => (
        <div key={v.id} className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 text-xs">
          <span>{new Date(v.quando).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</span>
          <select value={v.status} onChange={(e) => mudarStatus(v, e.target.value)} aria-label="Situação da visita" className="rounded border border-border bg-background px-1 py-0.5">
            {Object.entries(STATUS).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
          </select>
        </div>
      ))}
      {aviso && <p role="alert" className="px-1 text-xs text-destructive">{aviso}</p>}
    </div>
  );
}
