// Tipos do leitor de card do grupo de entradas (entrada-card.js).
export type VeiculoDoCard = {
  cat: string; brand: string; model: string; versao: string; year: string; mileage: string; color: string; plate: string;
  combustivel: string; cambio: string; ipva: string; chave_manual: boolean; revisoes: string; sale_price: number; description: string;
};
export type InternoDoCard = { purchase_price: number; fipe_value: number; laudo: string; pneus: string; captacao: string; obs: string };
export function ehCard(texto: string): boolean;
export function lerCard(texto: string): { veiculo: VeiculoDoCard; interno: InternoDoCard; faltando: string[] };
export function dinheiro(s: string): number;
export function categoria(marca: string, modelo: string): string;
export function descricao(v: Partial<VeiculoDoCard>, extras?: Partial<InternoDoCard>): string;
