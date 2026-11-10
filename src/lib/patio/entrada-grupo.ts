import type { SupabaseClient } from "@supabase/supabase-js";
import { ehCard, lerCard } from "./entrada-card";
import { novoCarro, separarParaFirestore, montarCarro, type DadosNovoCarro } from "./veiculo";
import { listarPublicos, gravarCarro, lerUm, gravarDocumento } from "./firestore";
import { situacaoChave } from "./google";
import { FIRESTORE_PROJETO_PADRAO } from "@/lib/trafego/estoqueSite";

// Entrada automática pelo grupo "IBOX PRIME | ENTRADA VEÍCULOS 🚗", agora pelo
// WhatsApp do próprio sistema (o webhook do site parou quando a instância
// grátis do uazapi foi apagada):
//   1. card do carro no grupo → carro novo no Pátio como "Aguardando
//      revisão" (não aparece no site);
//   2. fotos mandadas no grupo até 60 min depois do card → galeria desse carro;
//   3. alguém confere, põe o preço e aprova no Pátio → vai para o site.
// Placa que já está no pátio não entra de novo.

export const GRUPO_ENTRADAS = process.env.ENTRADA_GRUPO_JID || "120363408455610816@g.us";
const JANELA_FOTOS_MS = 60 * 60 * 1000;
const CLOUDINARY = "https://api.cloudinary.com/v1_1/dmxnnadfk/image/upload";
const PRESET = "ibox-prime-gg";
const normPlaca = (p: unknown) => String(p ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export function dadosDoCard(texto: string): DadosNovoCarro {
  const { veiculo: v, interno: i } = lerCard(texto);
  return {
    cat: v.cat, brand: v.brand, model: v.model, versao: v.versao, year: v.year, mileage: v.mileage, color: v.color, plate: v.plate,
    combustivel: v.combustivel, cambio: v.cambio, ipva: v.ipva, revisoes: v.revisoes, chave_manual: v.chave_manual, description: v.description,
    sale_price: v.sale_price, purchase_price: i.purchase_price, fipe_value: i.fipe_value, laudo: i.laudo, pneus: i.pneus, captacao: i.captacao, obs: i.obs,
  };
}

// Diário do grupo de entradas: a última mensagem que chegou e o que o
// sistema fez com ela. Fica num documento que o site não lê
// (sistema_privado/grupo_entradas) e aparece no Pátio — é como a gente sabe
// se o WhatsApp conectado está recebendo o grupo e por que um card não virou carro.
export const DOC_DIARIO_GRUPO = "sistema_privado/grupo_entradas";
async function anotar(projeto: string, m: Msg, resultado: string, carroId?: string) {
  await gravarDocumento(projeto, DOC_DIARIO_GRUPO, {
    recebido_em: new Date(m.timestampMs).toISOString(),
    anotado_em: new Date().toISOString(),
    tipo: m.contentType,
    resultado,
    ...(carroId ? { carro_id: carroId } : {}),
  }).catch((e) => console.error("[entrada-grupo] diário", e));
}

type Msg = { accountId: string; chatJid: string; contentType: string; text: string | null; mediaUrl: string | null; externalId: string; timestampMs: number };

export async function entradaDoGrupo(admin: SupabaseClient, m: Msg): Promise<void> {
  if (m.chatJid !== GRUPO_ENTRADAS || situacaoChave() !== "ok") return;
  let projeto = FIRESTORE_PROJETO_PADRAO;
  try {
    const { data: conta } = await admin.from("accounts").select("organization_id").eq("id", m.accountId).maybeSingle();
    const orgId = conta?.organization_id as string | undefined;
    if (!orgId) return anotar(projeto, m, "conta do WhatsApp sem loja ligada");
    const { data: cfg } = await admin.from("tr_config").select("estoque_firestore_projeto").eq("org_id", orgId).maybeSingle();
    projeto = (cfg?.estoque_firestore_projeto as string) || FIRESTORE_PROJETO_PADRAO;

    if (m.text && ehCard(m.text)) {
      const dados = dadosDoCard(m.text);
      if (!dados.brand || !dados.model) return anotar(projeto, m, "card sem marca/modelo — não virou carro");
      const placa = normPlaca(dados.plate);
      if (placa) {
        const existentes = await listarPublicos(projeto);
        const ja = existentes.find((e) => normPlaca(e.dados.plate) === placa);
        if (ja) return anotar(projeto, m, `placa ${placa} já está no pátio — não duplicou`, ja.id);
      }
      const id = `grp_${m.externalId.replace(/[^A-Za-z0-9_-]/g, "").slice(-40)}`;
      if (await lerUm(projeto, id)) return; // a mesma mensagem chegou duas vezes
      const carro = novoCarro(id, dados, m.text.slice(0, 5000));
      carro.origem = { canal: "whatsapp:grupo", msg_ids: [m.externalId], recebido_em: new Date(m.timestampMs).toISOString() };
      const { publico, privado } = separarParaFirestore(carro);
      await gravarCarro(projeto, id, publico, privado);
      await admin.from("patio_historico").insert({ org_id: orgId, veiculo_site_id: id, quem: "Grupo de entradas", acao: "entrou pelo grupo de entradas", campos: [] });
      return anotar(projeto, m, `card lido: ${dados.brand} ${dados.model} — entrou no Pátio aguardando aprovação`, id);
    }

    if (m.contentType === "image" && m.mediaUrl) {
      const desde = new Date(m.timestampMs - JANELA_FOTOS_MS).toISOString();
      const { data: ult } = await admin.from("patio_historico").select("veiculo_site_id, criado_em").eq("org_id", orgId).eq("acao", "entrou pelo grupo de entradas").gte("criado_em", desde).order("criado_em", { ascending: false }).limit(1).maybeSingle();
      const id = ult?.veiculo_site_id as string | undefined;
      if (!id) return anotar(projeto, m, "foto sem card nos 60 minutos antes — não juntou a nenhum carro");
      const lido = await lerUm(projeto, id);
      if (!lido) return anotar(projeto, m, "foto: o carro do último card não existe mais");
      const atual = montarCarro(id, lido.publico.dados, lido.privado, { criadoEm: lido.publico.criadoEm, atualizadoEm: lido.publico.atualizadoEm });
      if (atual.status !== "review") return anotar(projeto, m, "foto: o carro já foi aprovado — não mexe mais sozinho", id);
      if ((atual.images ?? []).some((i) => (i as Record<string, unknown>).mid === m.externalId)) return;
      const corpo = new URLSearchParams({ file: m.mediaUrl, upload_preset: PRESET, folder: `vehicles/${id}` });
      const r = await fetch(CLOUDINARY, { method: "POST", body: corpo });
      const j = (await r.json().catch(() => ({}))) as { secure_url?: string; width?: number; height?: number };
      if (!j.secure_url) throw new Error(`Cloudinary ${r.status}`);
      const images = [...(atual.images ?? []), { url: j.secure_url, ts: m.timestampMs, mid: m.externalId, ...(j.width && j.height ? { w: j.width, h: j.height } : {}) }];
      const novo = { ...atual, images, img: atual.img || j.secure_url };
      const { publico, privado } = separarParaFirestore(novo);
      await gravarCarro(projeto, id, publico, privado);
      return anotar(projeto, m, `foto juntada a ${atual.brand ?? ""} ${atual.model ?? ""}`.trim(), id);
    }

    if (m.contentType === "image") return anotar(projeto, m, "foto chegou sem arquivo (o WhatsApp não liberou a imagem)");
    return anotar(projeto, m, m.text ? "mensagem de texto que não é card de carro — ignorada" : `mensagem do tipo ${m.contentType} — ignorada`);
  } catch (e) {
    console.error("[entrada-grupo]", e);
    await anotar(projeto, m, `erro: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
  }
}
