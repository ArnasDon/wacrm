import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/whatsapp/encryption";
import { orgIdAtual } from "./org";

// Utilitários das rotas de servidor do módulo Tráfego.

/** Loja de quem chamou + confirmação de que é sócio/gestor (dono ou admin da conta-mãe). */
export async function gestorDaLoja(): Promise<{ orgId: string } | { erro: string; status: number }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { erro: "não autenticado", status: 401 };
  const orgId = await orgIdAtual(supabase);
  if (!orgId) return { erro: "loja não encontrada", status: 404 };
  const { data: ehGestor, error } = await supabase.rpc("org_gestor", { target_org: orgId });
  if (error || !ehGestor) return { erro: "sem permissão", status: 403 };
  return { orgId };
}

/** Token do Meta de cada loja (descriptografado), lido só no servidor. */
export async function tokensMetaDasLojas(
  admin: SupabaseClient,
  orgIds?: string[],
): Promise<Record<string, string>> {
  let q = admin.from("tr_config").select("org_id, meta_access_token").not("meta_access_token", "is", null);
  if (orgIds?.length) q = q.in("org_id", orgIds);
  const { data, error } = await q;
  if (error) throw new Error(`tr_config: ${error.message}`);
  const saida: Record<string, string> = {};
  for (const linha of (data ?? []) as { org_id: string; meta_access_token: string }[]) {
    try {
      saida[linha.org_id] = decrypt(linha.meta_access_token);
    } catch (e) {
      console.error("[trafego] token do Meta não abriu para a loja", linha.org_id, e);
    }
  }
  return saida;
}

/** Chave do Windsor de cada loja (descriptografada); sem chave própria, usa a do ambiente. */
export async function chavesWindsorDasLojas(admin: SupabaseClient): Promise<Record<string, string>> {
  const { data } = await admin.from("tr_config").select("org_id, windsor_api_key").not("windsor_api_key", "is", null);
  const saida: Record<string, string> = {};
  for (const l of (data ?? []) as { org_id: string; windsor_api_key: string }[]) {
    try {
      saida[l.org_id] = decrypt(l.windsor_api_key);
    } catch (e) {
      console.error("[trafego] chave do Windsor não abriu para a loja", l.org_id, e);
    }
  }
  return saida;
}
