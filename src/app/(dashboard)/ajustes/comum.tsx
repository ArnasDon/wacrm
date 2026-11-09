export function CabecalhoAjustes({ titulo, sub }: { titulo: string; sub: string }) {
  return (
    <div>
      <div className="rot" style={{ fontSize: 13 }}>Ajustes</div>
      <h1 className="disp" style={{ margin: "4px 0 0", fontSize: 40, lineHeight: 1.05 }}>{titulo}</h1>
      <p className="rot" style={{ margin: "6px 0 0", fontSize: 14 }}>{sub}</p>
    </div>
  );
}

export function quando(iso?: string | null): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 2) return "agora há pouco";
  if (min < 60) return `há ${min} min`;
  if (min < 48 * 60) return `há ${Math.round(min / 60)} h`;
  return new Date(t).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}
