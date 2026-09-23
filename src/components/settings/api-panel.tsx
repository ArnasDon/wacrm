"use client";

// ============================================================
// Configurações → API: tudo o que quem liga outro sistema ao CRM precisa,
// numa seção só, em três sub-abas.
//
//   Chaves        — as chaves de API (a tela que esta seção era até aqui).
//   IDs           — os ids da conta que a API e as automações pedem.
//   Documentação  — como chamar a API e receber os avisos (webhooks).
//
// A sub-aba mora na URL (`?aba=`), ao lado do `?tab=` da seção: dá para
// mandar a alguém o link direto da aba de IDs, e o voltar do navegador não
// desfaz a troca de aba (é `replace`, como a troca de seção). Valor
// desconhecido ou ausente cai em Chaves — é o que `?tab=api` sempre abriu,
// e os links antigos continuam chegando no mesmo lugar. A página de
// Configurações apaga o `aba` ao trocar de SEÇÃO, senão o `?aba=ids`
// sobrevivia à ida para outra seção e voltava a valer na volta.
//
// A seção NÃO é só de admin (não está em `SECOES_SO_DE_ADMIN`): qualquer
// membro lê as chaves (criar e revogar ficam atrás de `RequireRole`), os IDs
// e a documentação — é quem monta o fluxo no n8n que precisa deles.
// ============================================================

import { useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { ApiKeysSettings } from "./api-keys-settings";
import { DocumentacaoDeIntegracao } from "./documentacao-de-integracao";
import { IdsDaConta } from "./ids-da-conta";
import { SettingsPanelHead } from "./settings-panel-head";
import { SubAbas } from "./sub-abas";

/** As sub-abas — o mesmo tipo que `DocumentacaoDeIntegracao` recebe em `irParaAba`. */
type AbaDaApi = "chaves" | "ids" | "docs";

function resolverAba(valor: string | null): AbaDaApi {
  return valor === "ids" || valor === "docs" ? valor : "chaves";
}

export function ApiPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations("Settings.secaoApi");

  const aba = resolverAba(searchParams.get("aba"));

  const irParaAba = useCallback(
    (proxima: AbaDaApi) => {
      const params = new URLSearchParams(searchParams.toString());
      // O `tab` é regravado junto: este painel só monta com a seção API na
      // tela, mas é a página que resolve a seção — não custa garantir que o
      // link copiado depois do clique abra esta mesma aba.
      params.set("tab", "api");
      params.set("aba", proxima);
      router.replace(`/settings?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  // Record com uma chave LITERAL por aba: o portão de i18n do CI só confere
  // chamadas com chave literal — uma chave montada com o id da aba passaria
  // por ele e poderia sair crua na tela.
  const rotulos: Record<AbaDaApi, () => string> = {
    chaves: () => t("abas.chaves"),
    ids: () => t("abas.ids"),
    docs: () => t("abas.docs"),
  };
  const abas = (["chaves", "ids", "docs"] as const).map((id) => ({
    id,
    rotulo: rotulos[id](),
  }));

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t("titulo")} description={t("descricao")} />

      <SubAbas abas={abas} ativa={aba} aoTrocar={irParaAba} rotulo={t("abasAria")} className="mb-5" />

      {aba === "chaves" ? (
        <ApiKeysSettings />
      ) : aba === "ids" ? (
        <IdsDaConta irParaAba={irParaAba} />
      ) : (
        <DocumentacaoDeIntegracao irParaAba={irParaAba} />
      )}
    </section>
  );
}
