import type { MetadataRoute } from "next";
import { NOME_CURTO_DO_APP, NOME_DO_APP, TAMANHOS_DO_ICONE } from "@/lib/marca";

// ============================================================
// Manifesto do app INSTALADO na Tela de Início do celular.
//
// ⚠️⚠️ `scope: "/"` é a razão de este arquivo existir. Sem manifesto, o
// iPhone decide sozinho quais endereços pertencem ao app, a partir da
// página em que a pessoa estava ao instalar — e a regra exata que ele usa
// não é documentada. Relatado pelo operador com print em 14/09/2026: abrir
// uma conversa, que só troca `/inbox` por `/inbox?c=…` na mesma página, já
// cobria a tela com a moldura de navegador (X e endereço em cima; voltar,
// recarregar e "abrir no Safari" embaixo), a mesma que o iPhone usa quando
// a navegação SAI do app. Com o escopo na raiz, todo endereço do CRM é o
// app. Link para OUTRO site continua abrindo na moldura — e aí é o certo.
//
// ⚠️ O iPhone lê o manifesto NA INSTALAÇÃO. Quem já instalou só pega uma
// mudança daqui apagando o ícone e adicionando de novo — e entra de novo,
// porque o app instalado guarda o login separado do Safari.
// ============================================================

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: NOME_DO_APP,
    short_name: NOME_CURTO_DO_APP,
    // `id` fixo: sem ele a identidade do app instalado É o `start_url`, e
    // trocar a tela de abertura faria o Android tratá-lo como outro app.
    id: "/",
    // Decisão do operador (14/09/2026): no celular o uso é atender, então
    // o app abre na caixa de entrada. O Meu dia continua aparecendo antes,
    // quando for a hora dele (a porta de entrada vale para qualquer tela).
    start_url: "/inbox",
    scope: "/",
    display: "standalone",
    // A mesma cor do `themeColor` do layout — o modo escuro é o padrão.
    background_color: "#020617",
    theme_color: "#020617",
    icons: [
      ...TAMANHOS_DO_ICONE.map((lado) => ({
        src: `/apple-icon/${lado}`,
        sizes: `${lado}x${lado}`,
        type: "image/png",
      })),
      // O Android recorta o ícone no formato do aparelho (círculo, gota…)
      // só quando ele se declara recortável. O desenho é o mesmo: fundo até
      // a borda e o símbolo dentro da área que sobrevive ao recorte.
      {
        src: "/apple-icon/512",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
