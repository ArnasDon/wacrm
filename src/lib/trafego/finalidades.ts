// Para que serve cada campanha. Nem toda campanha é de um carro: as de
// perfil do Instagram, site, marca e alcance ficam ligadas a uma
// finalidade (tr_campaigns.categoria_objetivo). As chaves antigas continuam
// valendo para o que já foi salvo.

export const FINALIDADES: { key: string; label: string }[] = [
  { key: "perfil_engajamento", label: "Instagram — engajamento" },
  { key: "perfil_trafego", label: "Instagram — visitas ao perfil" },
  { key: "site_trafego", label: "Site — tráfego" },
  { key: "reconhecimento", label: "Marca / branding" },
  { key: "alcance", label: "Alcance" },
  { key: "vendas", label: "Vendas (sem carro específico)" },
  { key: "engajamento", label: "Engajamento (outros)" },
  { key: "institucional", label: "Institucional" },
  { key: "trafego_geral", label: "Tráfego geral" },
  { key: "outro", label: "Outro" },
];

export const rotuloFinalidade = (k: string | null | undefined) => FINALIDADES.find((f) => f.key === k)?.label ?? k ?? "—";

const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Sugere a finalidade pelo objetivo do Meta e pelo nome da campanha.
 * Devolve null quando a campanha parece ser de carro (mensagens, leads,
 * vendas) — essas ficam para a sugestão de carro.
 */
export function sugerirFinalidade(objetivo: string | null | undefined, nome: string): string | null {
  const o = String(objetivo ?? "").toUpperCase();
  const n = sem(nome);
  const perfil = /\b(perfil|insta|instagram|ig|seguidor|seguidores|followers)\b/.test(n);
  const site = /\b(site|landing|lp|pagina|consulta|blog)\b/.test(n);
  if (/\b(alcance|reach)\b/.test(n) || o === "REACH") return "alcance";
  if (/\b(branding|marca|reconhecimento|awareness)\b/.test(n) || ["OUTCOME_AWARENESS", "BRAND_AWARENESS", "AWARENESS"].includes(o)) return "reconhecimento";
  if (["OUTCOME_ENGAGEMENT", "POST_ENGAGEMENT", "VIDEO_VIEWS", "PAGE_LIKES", "ENGAGEMENT"].includes(o) && !/\b(whats|whatsapp|mensagem|mensagens|msg)\b/.test(n)) {
    return perfil || !site ? "perfil_engajamento" : "site_trafego";
  }
  if (["OUTCOME_TRAFFIC", "TRAFFIC", "LINK_CLICKS"].includes(o)) return perfil ? "perfil_trafego" : "site_trafego";
  if (perfil) return "perfil_engajamento";
  if (site) return "site_trafego";
  return null;
}
