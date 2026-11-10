// Estoque do site (coleção pública "vehicles" do Firestore do site) e as regras
// para ligar cada carro do site a um carro do painel. Usado no servidor (sync)
// e no navegador (tela Carros e sugestões de vínculo em Campanhas).
// Só lê campos públicos — custos e dados do proprietário nunca passam por aqui.

export const FIRESTORE_PROJETO_PADRAO = "ibox-site";

export type VeiculoSite = {
  id: string;
  placa: string;
  nome: string; // "TOYOTA COROLLA ALTIS PREMIUM"
  modelo: string;
  ano: number | null;
  anoTexto: string;
  status: string; // available | sold | unavailable
  preco: number | null;
  foto: string | null;
  categoria: string;
};

export type CarroPainel = {
  id: string;
  placa: string | null;
  modelo: string | null;
  ano?: number | null;
  site_vehicle_id?: string | null;
  status?: string | null;
};

type Campo = Record<string, unknown> | undefined;
const txt = (c: Campo) => (c ? String(c.stringValue ?? c.integerValue ?? c.doubleValue ?? "") : "");

export async function lerEstoqueSite(projeto: string = FIRESTORE_PROJETO_PADRAO): Promise<VeiculoSite[]> {
  const campos = ["plate", "brand", "model", "versao", "year", "status", "finance", "img", "cat"];
  const base =
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projeto)}/databases/(default)/documents/vehicles?pageSize=300` +
    campos.map((f) => `&mask.fieldPaths=${f}`).join("");
  const out: VeiculoSite[] = [];
  let token = "";
  for (let i = 0; i < 20; i++) {
    const r = await fetch(base + (token ? `&pageToken=${encodeURIComponent(token)}` : ""), { cache: "no-store" });
    if (!r.ok) throw new Error(`Estoque do site indisponível (Firestore ${r.status})`);
    const d = (await r.json()) as { documents?: { name: string; fields?: Record<string, Campo> }[]; nextPageToken?: string };
    for (const doc of d.documents || []) {
      const f = doc.fields || {};
      const status = txt(f.status) || "available";
      if (status === "review") continue; // rascunho do grupo de entradas, ainda não aprovado
      const fin = (f.finance as { mapValue?: { fields?: Record<string, Campo> } } | undefined)?.mapValue?.fields || {};
      const precoTxt = txt(fin.sale_price);
      const preco = precoTxt ? Number(precoTxt) : NaN;
      const anoTexto = txt(f.year);
      const ano = Number((anoTexto.match(/\d{4}/) || [])[0]) || null;
      const marca = txt(f.brand).trim();
      const modelo = txt(f.model).trim();
      const versao = txt(f.versao).trim();
      out.push({
        id: doc.name.split("/").pop() || doc.name,
        placa: txt(f.plate).trim(),
        nome: [marca, modelo, versao].filter(Boolean).join(" ").replace(/\s+/g, " ").toUpperCase(),
        modelo: modelo.toUpperCase(),
        ano,
        anoTexto,
        status,
        preco: Number.isFinite(preco) && preco > 0 ? preco : null,
        foto: txt(f.img) || null,
        categoria: txt(f.cat) || "carros",
      });
    }
    if (!d.nextPageToken) break;
    token = d.nextPageToken;
  }
  return out;
}

// Placa normalizada: só letras e números, padrão Mercosul (ABC1234 → ABC1C34).
export function normPlaca(p: string | null | undefined): string {
  const s = String(p || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (/^[A-Z]{3}\d{4}$/.test(s)) return s.slice(0, 4) + "ABCDEFGHIJ"[Number(s[4])] + s.slice(5);
  return s;
}

// Distância de edição com troca de vizinhos (RPC4A87 × RCP4A87 = 1).
export function distancia(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}

const IGNORAR = new Set(["de", "da", "do", "e", "com", "para", "pra", "carro", "venda", "oferta", "the", "auto", "flex", "aut", "manual"]);
export function palavras(s: string | null | undefined): string[] {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length >= 2 && !IGNORAR.has(w) && !/^\d{1,2}$/.test(w));
}

// O modelo do carro do site aparece no texto? (aceita "corolla cross", "t-cross", "hb20s"…)
function temModelo(texto: string[], modeloSite: string): boolean {
  const m = palavras(modeloSite);
  if (m.length === 0) return false;
  const junto = texto.join("");
  return m.every((w) => texto.includes(w)) || junto.includes(m.join(""));
}

export type Candidato = { car: CarroPainel; motivo: string; forte: boolean };

// Para um carro do site, qual carro já cadastrado no painel parece ser o mesmo?
export function candidatoNoPainel(v: VeiculoSite, cars: CarroPainel[]): Candidato | null {
  const livres = cars.filter((c) => !c.site_vehicle_id);
  const pv = normPlaca(v.placa);
  if (pv.length >= 7) {
    const igual = livres.find((c) => normPlaca(c.placa) === pv);
    if (igual) return { car: igual, motivo: "placa igual", forte: true };
    const parecida = livres.find((c) => {
      const pc = normPlaca(c.placa);
      return pc.length === 7 && distancia(pc, pv) === 1 && temModelo(palavras(c.modelo), v.modelo);
    });
    if (parecida) return { car: parecida, motivo: `placa quase igual (${parecida.placa} × ${v.placa}) e mesmo modelo`, forte: false };
  }
  const mesmos = livres.filter((c) => {
    if (!temModelo(palavras(c.modelo), v.modelo)) return false;
    const anoCarro = c.ano || Number((String(c.modelo || "").match(/\b(19|20)\d{2}\b/) || [])[0]) || null;
    return !anoCarro || !v.ano || Math.abs(anoCarro - v.ano) <= 1;
  });
  if (mesmos.length === 1) return { car: mesmos[0], motivo: "mesmo modelo, sem placa que confirme", forte: false };
  return null;
}

export const MARCAS = new Set([
  "vw", "volkswagen", "volkswagem", "toyota", "fiat", "chevrolet", "gm", "jeep", "honda", "hyundai", "bmw", "audi", "ram",
  "ford", "nissan", "renault", "mitsubishi", "mercedes", "benz", "land", "rover", "range", "porsche", "jaguar", "byd", "kia",
  "peugeot", "peugot", "citroen", "caoa", "chery", "cherry", "jaecoo", "troller", "volvo", "seadoo", "sea", "doo", "yamaha",
]);

// Sugestão de carro para uma campanha, pelo nome dela ("09/10 - fiat strada freedom", "SW4 (4D14)").
// Final de placa no nome vale mais que tudo; senão, precisa citar o modelo (não só a marca).
// Só sugere quando há um único melhor candidato.
export function sugerirCarroParaCampanha<T extends CarroPainel & { nomeSite?: string | null; modeloSite?: string | null }>(
  nomeCampanha: string,
  cars: T[]
): T | null {
  const texto = palavras(nomeCampanha);
  if (texto.length === 0) return null;
  const junto = texto.join("");
  // ano com 4 dígitos ("2022") ou com 2 no fim do nome ("SW4 SRX 22")
  const ano2 = Number((nomeCampanha.match(/\b(\d{2})\s*$/) || [])[1]);
  const anoNome = Number((nomeCampanha.match(/\b(19|20)\d{2}\b/) || [])[0]) || (ano2 >= 10 && ano2 <= 30 ? 2000 + ano2 : null);
  const finaisPlaca = (nomeCampanha.toUpperCase().match(/\b[A-Z0-9]{4}\b/g) || []).filter((f) => /\d/.test(f) && /[A-Z]/.test(f));
  let melhor: T | null = null;
  let melhorPontos = 0;
  let empate = false;
  for (const c of cars) {
    const placa = normPlaca(c.placa);
    const placaCrua = String(c.placa || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const bateuPlaca = placa.length >= 7 && finaisPlaca.some((f) => placa.endsWith(f) || placaCrua.endsWith(f));
    const pc = palavras(c.nomeSite || c.modelo || "");
    const principal = palavras(c.modeloSite || c.modelo).find((w) => !MARCAS.has(w) && !/^(19|20)\d{2}$/.test(w));
    const citaModelo = !!principal && (texto.includes(principal) || junto.includes(principal));
    if (!bateuPlaca && !citaModelo) continue;
    if (!bateuPlaca && anoNome && c.ano && Math.abs(anoNome - c.ano) > 1) continue;
    let pontos = pc.filter((w) => texto.includes(w)).length * 2 + (bateuPlaca ? 10 : 0);
    if (anoNome && c.ano && anoNome === c.ano) pontos += 3;
    if (c.status === "vendido") pontos -= 1;
    if (pontos > melhorPontos) {
      melhor = c;
      melhorPontos = pontos;
      empate = false;
    } else if (pontos === melhorPontos) empate = true;
  }
  return melhor && !empate && melhorPontos >= 2 ? melhor : null;
}
