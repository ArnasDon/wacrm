"use client";

// ESQUELETO — o conteúdo da aba "Documentação" (Configurações → API) entra
// aqui. A aba o importa pelo nome; a assinatura abaixo é o contrato.

export function DocumentacaoDeIntegracao({
  irParaAba,
}: {
  /** Troca a sub-aba da seção API (ex.: `"ids"` para a aba de IDs). */
  irParaAba: (aba: "chaves" | "ids" | "docs") => void;
}) {
  void irParaAba;
  return null;
}
