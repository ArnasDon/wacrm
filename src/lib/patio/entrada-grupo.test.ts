import { describe, it, expect } from "vitest";
import { dadosDoCard } from "./entrada-grupo";
import { novoCarro, separarParaFirestore } from "./veiculo";

const CARD = `*MARCA:* TOYOTA
*MODELO:* HILUX
*PLACA* : RCO-1A97
*VERSÃO:* SRV
*ANO:* 2021/2021
*COMBUSTÍVEL:* flex
*CÂMBIO:* automático
*KM:* 150.000
*TABELA FIPE:* R$186.044,00
💰*CUSTO:* R$160.000,00
*CAPTAÇÃO*: Loja`;

describe("entrada pelo grupo", () => {
  it("card vira carro aguardando revisão, com custo só no privado", () => {
    const d = dadosDoCard(CARD);
    expect(d).toMatchObject({ brand: "Toyota", model: "Hilux", plate: "RCO-1A97", purchase_price: 160000, fipe_value: 186044, captacao: "Loja" });
    const c = novoCarro("grp_x", d, CARD);
    expect(c.status).toBe("review");
    const { publico, privado } = separarParaFirestore(c);
    expect(JSON.stringify(publico)).not.toContain("160000");
    expect((privado.finance as Record<string, unknown>).purchase_price).toBe(160000);
  });
});
