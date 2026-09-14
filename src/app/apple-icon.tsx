import { ImageResponse } from "next/og";
import { TAMANHOS_DO_ICONE } from "@/lib/marca";

// ============================================================
// Ícone do app INSTALADO na Tela de Início. O iPhone lê o
// `apple-touch-icon` (180); o `manifest.ts` aponta os mesmos arquivos
// para o Android (192 e 512).
//
// É o mesmo símbolo do `icon.tsx` (a aba do navegador) e da barra
// lateral, com duas diferenças de propósito:
// - fundo até a borda, SEM canto arredondado e sem nada transparente: o
//   iPhone arredonda o canto sozinho e pinta de preto o que é
//   transparente — um canto já arredondado sairia com borda escura;
// - o símbolo ocupa metade do quadrado, dentro do círculo central que o
//   Android preserva quando recorta o ícone no formato do aparelho.
//
// ⚠️ O iPhone guarda o ícone NO MOMENTO da instalação: mudar este desenho
// não muda o ícone de quem já instalou — é preciso apagar e adicionar de
// novo.
// ============================================================

export function generateImageMetadata() {
  return TAMANHOS_DO_ICONE.map((lado) => ({
    id: String(lado),
    size: { width: lado, height: lado },
    contentType: "image/png",
  }));
}

export default async function AppleIcon({
  id,
}: {
  id: Promise<string | number>;
}) {
  const lado = Number(await id);
  const simbolo = Math.round(lado / 2);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#7c3aed",
        }}
      >
        <svg
          width={simbolo}
          height={simbolo}
          viewBox="0 0 24 24"
          fill="none"
          stroke="#ffffff"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </div>
    ),
    { width: lado, height: lado },
  );
}
