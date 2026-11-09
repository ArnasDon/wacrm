"use client";

import { useEffect, useState } from "react";

// Carregar e salvar uma tela do Site, com aviso padrão.
export function useDocSite<T>(url: string) {
  const [dados, setDados] = useState<T | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    fetch(url, { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro || "Não foi possível abrir.");
        setDados(d as T);
      })
      .catch((e: Error) => setErro(e.message));
  }, [url]);

  async function salvar(corpo: unknown, pronto = "Salvo.") {
    setSalvando(true);
    setAviso(null);
    try {
      const r = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.erro || "Não foi possível salvar.");
      setAviso(d.siteAtualizando ? `${pronto} O site está sendo atualizado (leva uns minutos).` : pronto);
    } catch (e) {
      setAviso((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }
  return { dados, setDados, erro, aviso, salvando, salvar };
}

export function Cabecalho({ titulo, sub }: { titulo: string; sub: string }) {
  return (
    <div>
      <div className="rot" style={{ fontSize: 13 }}>Site · iboxprime.com.br</div>
      <h1 className="disp" style={{ margin: "4px 0 0", fontSize: 40, lineHeight: 1.05 }}>{titulo}</h1>
      <p className="rot" style={{ margin: "6px 0 0", fontSize: 14 }}>{sub}</p>
    </div>
  );
}
