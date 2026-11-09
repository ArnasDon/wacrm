import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/trafego/admin";
import { orgIdAtual } from "@/lib/trafego/org";
import { FIRESTORE_PROJETO_PADRAO } from "@/lib/trafego/estoqueSite";
import { lerDocumento } from "./firestore";
import type { Papel } from "./veiculo";

export type Quem = { userId: string; nome: string; orgId: string; papel: Papel; projeto: string };

/** Quem está chamando, de qual loja, com qual papel e qual Firestore é o estoque dessa loja. */
export async function quemNoPatio(): Promise<Quem | { erro: string; status: number }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { erro: "não autenticado", status: 401 };
  const orgId = await orgIdAtual(supabase);
  if (!orgId) return { erro: "loja não encontrada", status: 404 };
  const { data: papel, error } = await supabase.rpc("org_papel", { target_org: orgId });
  if (error) return { erro: "papel não encontrado (a migration 052 foi aplicada?)", status: 500 };
  if (papel !== "socio" && papel !== "marketing" && papel !== "vendedor") return { erro: "sem acesso a esta loja", status: 403 };

  const admin = createAdminClient();
  const { data: cfg } = await admin.from("tr_config").select("estoque_firestore_projeto").eq("org_id", orgId).maybeSingle();
  const { data: perfil } = await admin.from("profiles").select("full_name, email").eq("user_id", user.id).maybeSingle();
  return {
    userId: user.id,
    nome: (perfil?.full_name as string) || (perfil?.email as string) || user.email || "alguém",
    orgId,
    papel,
    projeto: (cfg?.estoque_firestore_projeto as string) || FIRESTORE_PROJETO_PADRAO,
  };
}

/** Pede para a Vercel reconstruir o site, como o admin faz depois de salvar. */
export async function reconstruirSite(projeto: string): Promise<boolean> {
  const config = await lerDocumento(projeto, "site/config");
  const url = (config?.deployHookUrl as string) || process.env.DEPLOY_HOOK_URL_SITE;
  if (!url || !/^https:\/\/api\.vercel\.com\//.test(url)) return false;
  await fetch(url, { method: "POST" }).catch(() => {});
  return true;
}
