import { NextResponse } from "next/server";
import { quemNoPatio } from "@/lib/patio/servidor";
import { situacaoChave } from "@/lib/patio/google";
import { lerDocumento } from "@/lib/patio/firestore";
import { DOC_DIARIO_GRUPO } from "@/lib/patio/entrada-grupo";

export const dynamic = "force-dynamic";

// GET /api/patio/grupo-entradas — a última mensagem do grupo de entradas que
// chegou ao sistema e o que foi feito com ela. Sócio e marketing.
export async function GET() {
  const q = await quemNoPatio();
  if ("erro" in q) return NextResponse.json({ erro: q.erro }, { status: q.status });
  if (q.papel === "vendedor") return NextResponse.json({ erro: "Só sócios e marketing." }, { status: 403 });
  if (situacaoChave() !== "ok") return NextResponse.json({ ultima: null });
  const d = await lerDocumento(q.projeto, DOC_DIARIO_GRUPO);
  return NextResponse.json({ ultima: d });
}
