import { NextResponse } from "next/server";
import { quemNoPatio } from "@/lib/patio/servidor";
import { createAdminClient } from "@/lib/trafego/admin";
import { situacaoChave } from "@/lib/patio/google";
import { lerDocumento } from "@/lib/patio/firestore";

export const dynamic = "force-dynamic";

// Ajustes → Conexões: o estado de tudo que o sistema usa, num lugar só.
// Só lê. Nenhuma chave ou token sai daqui: só se está ligado, desde quando
// e, quando ajuda a reconhecer, os últimos caracteres.
type Estado = "ok" | "erro" | "desligado" | "info";
type Conexao = { id: string; nome: string; para: string; estado: Estado; detalhe: string; ultima?: string | null; configurar: string; grupo: string };

const final = (s: unknown, n = 4) => (typeof s === "string" && s.length > n ? `…${s.slice(-n)}` : "");

export async function GET() {
  const quem = await quemNoPatio();
  if ("erro" in quem) return NextResponse.json({ erro: quem.erro }, { status: quem.status });
  if (quem.papel === "vendedor") return NextResponse.json({ erro: "Só sócios e marketing veem as conexões." }, { status: 403 });
  const admin = createAdminClient();
  const { data: contas } = await admin.from("accounts").select("id").eq("organization_id", quem.orgId);
  const ids = (contas ?? []).map((c) => c.id as string);

  const [{ data: cfg }, { data: creds }, { data: runs }, { data: wa }, { data: ultimaConversa }] = await Promise.all([
    admin.from("tr_config").select("meta_access_token, windsor_api_key, ga4_property_id, estoque_firestore_projeto, atualizado_em").eq("org_id", quem.orgId).maybeSingle(),
    admin.from("tr_integration_credentials").select("provedor, referencia_externa, ativo").eq("org_id", quem.orgId),
    admin.from("tr_sync_runs").select("provedor, status, concluido_em, iniciado_em, erro").eq("org_id", quem.orgId).order("iniciado_em", { ascending: false }).limit(60),
    ids.length ? admin.from("whatsapp_config").select("account_id, provider, uazapi_status, uazapi_paired_phone, uazapi_connected_at, updated_at").in("account_id", ids) : Promise.resolve({ data: [] }),
    ids.length ? admin.from("conversations").select("last_message_at").in("account_id", ids).order("last_message_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const ultimoRun = (prov: string[]) => ((runs ?? []) as { provedor: string; status: string; concluido_em: string | null; iniciado_em: string; erro: string | null }[]).find((r) => prov.includes(r.provedor));
  const credDe = (prov: string) => ((creds ?? []) as { provedor: string; referencia_externa: string | null; ativo: boolean }[]).find((c) => c.provedor === prov && c.ativo);
  const lista: Conexao[] = [];

  // WhatsApp
  const zap = ((wa ?? []) as { provider: string; uazapi_status: string | null; uazapi_paired_phone: string | null; uazapi_connected_at: string | null }[])[0];
  lista.push({
    id: "whatsapp", grupo: "Clientes", nome: "WhatsApp", para: "Conversas com clientes e mensagens nos grupos da equipe",
    estado: !zap ? "desligado" : zap.provider !== "uazapi" || zap.uazapi_status === "connected" ? "ok" : "erro",
    detalhe: !zap ? "Nenhum número ligado" : zap.provider === "uazapi" ? `${zap.uazapi_status === "connected" ? "Conectado" : `Status: ${zap.uazapi_status ?? "desconhecido"}`}${zap.uazapi_paired_phone ? ` · número ${final(zap.uazapi_paired_phone)}` : ""}` : `Ligado pela API ${zap.provider === "meta" ? "oficial do Meta" : zap.provider}`,
    ultima: (ultimaConversa as { last_message_at?: string } | null)?.last_message_at ?? null,
    configurar: "/settings?tab=whatsapp",
  });

  // Meta Ads
  const meta = ultimoRun(["facebook", "meta"]);
  const conta = credDe("facebook")?.referencia_externa;
  lista.push({
    id: "meta", grupo: "Marketing", nome: "Meta Ads (Facebook e Instagram)", para: "Gasto, conversas e campanhas",
    estado: !cfg?.meta_access_token && !conta ? "desligado" : meta?.status === "erro" ? "erro" : "ok",
    detalhe: [cfg?.meta_access_token ? "Token salvo" : "Sem token próprio (usa o Windsor)", conta ? `conta de anúncios ${final(String(conta))}` : "sem conta de anúncios", meta?.status === "erro" && meta.erro ? `último erro: ${meta.erro}` : ""].filter(Boolean).join(" · "),
    ultima: meta?.concluido_em ?? null,
    configurar: "/trafego/conexoes",
  });

  // Windsor (Instagram orgânico)
  const ig = ultimoRun(["instagram", "instagram_public", "windsor"]);
  lista.push({
    id: "windsor", grupo: "Marketing", nome: "Windsor.ai (Instagram)", para: "Seguidores, alcance e métricas do Instagram (opcional)",
    estado: cfg?.windsor_api_key || process.env.WINDSOR_API_KEY ? (ig?.status === "erro" ? "erro" : "ok") : "desligado",
    detalhe: cfg?.windsor_api_key ? "Chave da loja salva" : process.env.WINDSOR_API_KEY ? "Usando a chave geral do sistema" : "Sem chave",
    ultima: ig?.concluido_em ?? null,
    configurar: "/trafego/conexoes",
  });

  // GA4
  const chave = situacaoChave();
  lista.push({
    id: "ga4", grupo: "Site", nome: "Google Analytics 4", para: "Visitas do site, carros mais vistos, cliques no WhatsApp por origem",
    estado: !cfg?.ga4_property_id ? "desligado" : chave === "ok" ? "ok" : "erro",
    detalhe: !cfg?.ga4_property_id ? "Falta o número da propriedade" : chave === "ok" ? `Propriedade ${cfg.ga4_property_id}` : "Falta a chave do Google na Vercel",
    configurar: "/trafego/conexoes",
  });

  // Estoque do site (Firebase)
  lista.push({
    id: "firebase", grupo: "Site", nome: "Estoque do site (Firebase)", para: "Ler e gravar os carros, o conteúdo e os links do site",
    estado: chave === "ok" ? "ok" : chave === "ausente" ? "desligado" : "erro",
    detalhe: chave === "ok" ? `Projeto ${quem.projeto}` : chave === "ausente" ? "Falta a chave de serviço do Firebase na Vercel" : "A chave salva na Vercel não está legível",
    configurar: "https://vercel.com/gabrielguimaraesmelo6-langs-projects/wacrm/settings/environment-variables",
  });

  // Reconstrução do site
  let hook = "";
  if (chave === "ok") hook = String((await lerDocumento(quem.projeto, "site/config").catch(() => null))?.deployHookUrl ?? "");
  lista.push({
    id: "reconstrucao", grupo: "Site", nome: "Publicação do site", para: "Atualizar as páginas do site depois de uma mudança",
    estado: hook ? "ok" : chave === "ok" ? "desligado" : "erro",
    detalhe: hook ? `Link de reconstrução ${final(hook)}` : chave === "ok" ? "Sem link: o site só atualiza na reconstrução diária" : "Depende da chave do Firebase",
    configurar: "/ajustes/site",
  });

  // Fixos
  lista.push({ id: "cloudinary", grupo: "Site", nome: "Fotos e vídeos (Cloudinary)", para: "Guardar a mídia dos carros e do site", estado: "ok", detalhe: "Conta dmxnnadfk, envio pelo navegador", configurar: "" });
  lista.push({ id: "pixel", grupo: "Site", nome: "Pixel do Meta no site", para: "O Meta aprende quais anúncios geram conversa", estado: "info", detalhe: "Instalado no código do site; o clique no WhatsApp vai como evento Contact", configurar: "" });
  for (const [id, nome] of [["direct", "Instagram Direct"], ["messenger", "Messenger"], ["olx", "OLX"], ["webmotors", "Webmotors"]] as const) {
    lista.push({ id, grupo: "Em breve", nome, para: "Mais um canal de clientes ligado ao carro", estado: "desligado", detalhe: "Ainda não disponível", configurar: "" });
  }

  return NextResponse.json({ conexoes: lista, papel: quem.papel });
}
