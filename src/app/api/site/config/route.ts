import { NextResponse } from "next/server";
import { quemNoSite } from "@/lib/patio/site-servidor";
import { lerDocumento, atualizarCampos } from "@/lib/patio/firestore";
import { reconstruirSite } from "@/lib/patio/servidor";

export const dynamic = "force-dynamic";

// Configurações do site (Firestore site/config), as mesmas da tela
// "Configurações" do admin antigo. O link de reconstrução nunca volta
// inteiro para o navegador: só se está ligado e os últimos caracteres.
const CAMPOS = ["phone", "addr", "email", "wa", "insta", "yt", "tiktok"] as const;

export async function GET() {
  const quem = await quemNoSite();
  if (quem instanceof NextResponse) return quem;
  const cfg = (await lerDocumento(quem.projeto, "site/config")) ?? {};
  const hook = typeof cfg.deployHookUrl === "string" ? cfg.deployHookUrl : "";
  return NextResponse.json({
    config: Object.fromEntries(CAMPOS.map((k) => [k, typeof cfg[k] === "string" ? cfg[k] : ""])),
    reconstrucao: hook ? { ligado: true, final: hook.slice(-4) } : { ligado: false },
    papel: quem.papel,
  });
}

export async function PUT(req: Request) {
  const quem = await quemNoSite();
  if (quem instanceof NextResponse) return quem;
  let corpo: { config?: Record<string, unknown>; deployHookUrl?: string };
  try { corpo = await req.json(); } catch { return NextResponse.json({ erro: "pedido inválido" }, { status: 400 }); }
  const dados: Record<string, unknown> = {};
  for (const k of CAMPOS) {
    const v = corpo.config?.[k];
    if (typeof v === "string") dados[k] = v.trim().slice(0, 300);
  }
  if (typeof corpo.deployHookUrl === "string" && corpo.deployHookUrl.trim()) {
    if (quem.papel !== "socio") return NextResponse.json({ erro: "Só sócio troca o link de reconstrução do site." }, { status: 403 });
    const url = corpo.deployHookUrl.trim();
    if (!/^https:\/\/api\.vercel\.com\/v1\/integrations\/deploy\/[A-Za-z0-9_/-]+$/.test(url)) return NextResponse.json({ erro: "Esse não parece um Deploy Hook da Vercel (começa com https://api.vercel.com/v1/integrations/deploy/)." }, { status: 400 });
    dados.deployHookUrl = url;
  }
  try {
    await atualizarCampos(quem.projeto, "site/config", dados, Object.keys(dados));
    const siteAtualizando = await reconstruirSite(quem.projeto).catch(() => false);
    return NextResponse.json({ ok: true, siteAtualizando });
  } catch (e) {
    console.error("[site/config]", e);
    return NextResponse.json({ erro: "Não foi possível salvar agora." }, { status: 502 });
  }
}
