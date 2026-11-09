import { NextResponse } from "next/server";
import { quemNoPatio, type Quem } from "./servidor";
import { situacaoChave } from "./google";

/** Sócio ou marketing, com a chave do Firebase pronta. */
export async function quemNoSite(): Promise<Quem | NextResponse> {
  const quem = await quemNoPatio();
  if ("erro" in quem) return NextResponse.json({ erro: quem.erro }, { status: quem.status });
  if (quem.papel === "vendedor") return NextResponse.json({ erro: "Só sócios e marketing mexem no site." }, { status: 403 });
  if (situacaoChave() !== "ok") return NextResponse.json({ erro: "A chave do Firebase não está pronta neste projeto." }, { status: 503 });
  return quem;
}
