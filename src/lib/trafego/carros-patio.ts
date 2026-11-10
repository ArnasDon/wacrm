import type { SupabaseClient } from "@supabase/supabase-js";
import { listarPublicos } from "@/lib/patio/firestore";
import { normPlaca } from "./estoqueSite";
import type { CarroDoPatio } from "./ligacoes";

// Carros do Pátio (site) no formato das telas de Marketing, e o "par" de cada
// um na tabela veiculos (é a ele que campanhas e anúncios ficam ligados).

const s = (v: unknown) => (v == null ? "" : String(v)).trim();

export async function carrosDoPatio(projeto: string): Promise<CarroDoPatio[]> {
  const pub = await listarPublicos(projeto);
  return pub
    .filter((p) => p.dados.status !== "review")
    .map((p) => {
      const d = p.dados;
      return {
        id: p.id,
        nome: [s(d.brand), s(d.model), s(d.versao), s(d.year)].filter(Boolean).join(" ") || "Carro sem nome",
        placa: s(d.plate) || null,
        ano: Number(String(d.year ?? "").slice(0, 4)) || null,
        status: s(d.status),
        img: s(d.img) || null,
        modelo: s(d.model) || null,
        preco: Number((d.finance as Record<string, unknown> | undefined)?.sale_price) || null,
      };
    });
}

/** id em veiculos do carro do Pátio; cria o par se ainda não existir. */
export async function parDoCarro(admin: SupabaseClient, orgId: string, projeto: string, patioId: string, cache?: CarroDoPatio[]): Promise<string> {
  const { data: par } = await admin.from("veiculos").select("id").eq("org_id", orgId).eq("site_vehicle_id", patioId).maybeSingle();
  if (par?.id) return par.id as string;
  const carro = (cache ?? (await carrosDoPatio(projeto))).find((c) => c.id === patioId);
  if (!carro) throw new Error("Carro não encontrado no Pátio.");
  const { data: usadas } = await admin.from("veiculos").select("placa").eq("org_id", orgId);
  const placasUsadas = new Set((usadas ?? []).map((u) => String(u.placa ?? "").toUpperCase()));
  let placa = normPlaca(carro.placa) || `SITE-${patioId.slice(0, 8).toUpperCase()}`;
  if (placasUsadas.has(placa)) placa = `${placa}-${patioId.slice(0, 4).toUpperCase()}`;
  const { data: novo, error } = await admin
    .from("veiculos")
    .insert({ org_id: orgId, placa, modelo: carro.nome, ano: carro.ano, status: carro.status === "sold" ? "vendido" : "estoque", origem: "site", site_vehicle_id: patioId, nome_site: carro.nome, modelo_site: carro.modelo, foto_url: carro.img })
    .select("id")
    .single();
  if (error || !novo) throw new Error(`Não consegui preparar o carro: ${error?.message ?? ""}`);
  return novo.id as string;
}
