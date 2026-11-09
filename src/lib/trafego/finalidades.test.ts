import { describe, it, expect } from "vitest";
import { sugerirFinalidade } from "./finalidades";

describe("finalidade das campanhas", () => {
  it("pelo objetivo do Meta e pelo nome", () => {
    expect(sugerirFinalidade("OUTCOME_ENGAGEMENT", "Engajamento perfil novembro")).toBe("perfil_engajamento");
    expect(sugerirFinalidade("OUTCOME_TRAFFIC", "Tráfego para o perfil do Instagram")).toBe("perfil_trafego");
    expect(sugerirFinalidade("OUTCOME_TRAFFIC", "Tráfego site estoque")).toBe("site_trafego");
    expect(sugerirFinalidade("OUTCOME_AWARENESS", "Institucional loja")).toBe("reconhecimento");
    expect(sugerirFinalidade("OUTCOME_AWARENESS", "Alcance Salvador")).toBe("alcance");
    expect(sugerirFinalidade("OUTCOME_ENGAGEMENT", "Hilux 2022 WhatsApp")).toBeNull();
    expect(sugerirFinalidade("OUTCOME_LEADS", "Song Plus GS")).toBeNull();
    expect(sugerirFinalidade("OUTCOME_SALES", "Seguidores IG")).toBe("perfil_engajamento");
  });
});
