"use client";

// ============================================================
// Configurações → API → Documentação: como ligar o CRM ao n8n, ao Make ou a
// qualquer sistema que fale HTTP — os três caminhos (API, webhooks
// recebidos, webhooks enviados), a chave, os ids, o passo a passo das duas
// ferramentas, os avisos, receitas e erros comuns.
//
// Por que uma aba DENTRO do CRM, e não só o `docs/public-api.md`: a
// documentação daqui mostra o endereço DESTA instalação nos exemplos (quem
// cola o curl genérico esquece de trocar o domínio), leva a outras abas por
// clique (Chaves, IDs, Webhooks) e cita os números do servidor — limite por
// minuto, prazo da entrega, falhas que desligam — pelas constantes
// espelhadas de `exemplos-de-requisicao.ts`, que o teste amarra à fonte.
// Número digitado à mão no dicionário mente na primeira mudança.
//
// ⚠️ CONCISA DE PROPÓSITO. O dicionário inteiro vai para o navegador em
// TODA página (`NextIntlClientProvider` no layout), então cada parágrafo
// aqui pesa na caixa de entrada também. A referência completa de cada
// endpoint continua em `docs/public-api.md`; esta aba é o caminho, não o
// catálogo. Os trechos de código NÃO moram no dicionário — saem do módulo
// puro, e só os marcadores ("SUA_CHAVE") são traduzidos.
//
// Regras do texto (medidas no use-intl deste repo): `{`, `}` e `<` literais
// vão entre aspas simples ICU; tag de `t.rich` sem atributo (a classe vem
// do handler abaixo); um parágrafo por chave; só chaves literais.
// ============================================================

import { useSyncExternalStore, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, KeyRound } from "lucide-react";
import { useTranslations } from "next-intl";

import { BlocoDeCodigo, ValorCopiavel } from "./copiar";
import {
  CodigoEmLinha,
  Lista,
  Paragrafo,
  Recolhivel,
  Secao,
  Subtitulo,
} from "./documentacao/pecas";
import {
  EVENTOS_POR_GRUPO,
  useRotulosDosEventos,
  useRotulosDosGrupos,
} from "./documentacao/rotulos-dos-eventos";
import * as ex from "@/lib/integracoes/exemplos-de-requisicao";

type AbaDaApi = "chaves" | "ids" | "docs";

const SECOES = [
  "comecar",
  "chave",
  "ids",
  "n8n",
  "make",
  "avisos",
  "receber",
  "receitas",
  "erros",
] as const;
type IdDaSecao = (typeof SECOES)[number];

const ancora = (id: IdDaSecao) => `doc-${id}`;

/**
 * A origem de onde a tela foi aberta — a queda de `NEXT_PUBLIC_SITE_URL`.
 * `useSyncExternalStore` com instantâneo de servidor NULO: a renderização
 * no servidor não tem `window`, e ler `window` direto no render faria o HTML
 * do servidor e o do navegador divergirem (erro de hidratação).
 */
function nadaAAssinar() {
  return () => {};
}
function useOrigem(): string | null {
  return useSyncExternalStore(
    nadaAAssinar,
    () => window.location.origin,
    () => null,
  );
}

/** Rola até a seção sem pôr `#…` na URL (o `?tab=api&aba=docs` fica limpo). */
function irParaSecao(e: MouseEvent<HTMLAnchorElement>, id: IdDaSecao) {
  e.preventDefault();
  document
    .getElementById(ancora(id))
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function BotaoDeLink({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="font-medium text-primary underline-offset-2 hover:underline"
    >
      {children}
    </button>
  );
}

const CLASSE_DO_LINK = "font-medium text-primary underline-offset-2 hover:underline";

export function DocumentacaoDeIntegracao({
  irParaAba,
}: {
  /** Troca a sub-aba da seção API (ex.: `"ids"` para a aba de IDs). */
  irParaAba: (aba: AbaDaApi) => void;
}) {
  const t = useTranslations("Settings.documentacao");
  const rotulos = useRotulosDosEventos();
  const grupos = useRotulosDosGrupos();

  const origem = useOrigem();
  const base = ex.urlBaseDoCrm(process.env.NEXT_PUBLIC_SITE_URL, origem) ?? "";

  const m: ex.Marcadores = {
    chave: t("marcador.chave"),
    idDoContato: t("marcador.idDoContato"),
    idDoFunil: t("marcador.idDoFunil"),
    idDaEtapa: t("marcador.idDaEtapa"),
    idDaConexao: t("marcador.idDaConexao"),
    segredo: t("marcador.segredo"),
    tituloDoNegocio: t("marcador.tituloDoNegocio"),
    textoDaMensagem: t("marcador.textoDaMensagem"),
  };

  // Os manipuladores das tags de `t.rich`. Passados juntos a toda chamada:
  // tag sem manipulador faz a mensagem INTEIRA sair como a chave crua.
  const rico = {
    b: (c: ReactNode) => (
      <strong className="font-medium text-foreground">{c}</strong>
    ),
    code: (c: ReactNode) => <CodigoEmLinha>{c}</CodigoEmLinha>,
    chaves: (c: ReactNode) => (
      <BotaoDeLink onClick={() => irParaAba("chaves")}>{c}</BotaoDeLink>
    ),
    ids: (c: ReactNode) => (
      <BotaoDeLink onClick={() => irParaAba("ids")}>{c}</BotaoDeLink>
    ),
    // A seção Webhooks lê `?aba=` para abrir direto na sub-aba certa.
    enviados: (c: ReactNode) => (
      <Link href="/settings?tab=webhooks&aba=enviados" className={CLASSE_DO_LINK}>
        {c}
      </Link>
    ),
    recebidos: (c: ReactNode) => (
      <Link href="/settings?tab=webhooks&aba=recebidos" className={CLASSE_DO_LINK}>
        {c}
      </Link>
    ),
  };

  const tituloDaSecao: Record<IdDaSecao, () => string> = {
    comecar: () => t("secao.comecar"),
    chave: () => t("secao.chave"),
    ids: () => t("secao.ids"),
    n8n: () => t("secao.n8n"),
    make: () => t("secao.make"),
    avisos: () => t("secao.avisos"),
    receber: () => t("secao.receber"),
    receitas: () => t("secao.receitas"),
    erros: () => t("secao.erros"),
  };

  const bloco = (codigo: string, nome: string) => (
    <BlocoDeCodigo codigo={codigo} rotulo={t("copiarTrecho", { nome })} />
  );

  const caminhos: Array<{
    icone: typeof KeyRound;
    titulo: string;
    texto: string;
    destino: IdDaSecao;
  }> = [
    {
      icone: KeyRound,
      titulo: t("comecar.api.titulo"),
      texto: t("comecar.api.texto"),
      destino: "chave",
    },
    {
      icone: ArrowDownLeft,
      titulo: t("comecar.recebidos.titulo"),
      texto: t("comecar.recebidos.texto"),
      destino: "receber",
    },
    {
      icone: ArrowUpRight,
      titulo: t("comecar.enviados.titulo"),
      texto: t("comecar.enviados.texto"),
      destino: "avisos",
    },
  ];

  const receitas: Array<{ titulo: string; texto: ReactNode; codigo: string }> = [
    {
      titulo: t("receitas.negocio.titulo"),
      texto: t.rich("receitas.negocio.texto", rico),
      codigo: ex.curlCriarNegocio(base, m),
    },
    {
      titulo: t("receitas.etiqueta.titulo"),
      texto: t.rich("receitas.etiqueta.texto", rico),
      codigo: ex.curlAplicarEtiqueta(base, m),
    },
    {
      titulo: t("receitas.campo.titulo"),
      texto: t.rich("receitas.campo.texto", rico),
      codigo: ex.curlPreencherCampo(base, m),
    },
    {
      titulo: t("receitas.mensagem.titulo"),
      texto: t.rich("receitas.mensagem.texto", rico),
      codigo: ex.curlMandarMensagem(base, m),
    },
  ];

  return (
    <div className="min-w-0 space-y-5">
      <Paragrafo>{t("intro")}</Paragrafo>

      <nav aria-label={t("indice")} className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("indice")}
        </p>
        <ol className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {SECOES.map((id) => (
            <li key={id} className="min-w-0 truncate">
              <a
                href={`#${ancora(id)}`}
                onClick={(e) => irParaSecao(e, id)}
                className="text-primary underline-offset-2 hover:underline"
              >
                {tituloDaSecao[id]()}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      {/* a) Por onde começar */}
      <Secao id={ancora("comecar")} titulo={tituloDaSecao.comecar()}>
        <Paragrafo>{t("comecar.intro")}</Paragrafo>
        <div className="grid gap-3 sm:grid-cols-3">
          {caminhos.map(({ icone: Icone, titulo, texto, destino }) => (
            <div
              key={destino}
              className="flex min-w-0 flex-col gap-2 rounded-md border border-border p-3"
            >
              <div className="flex items-center gap-2">
                <Icone className="size-4 shrink-0 text-primary" />
                <span className="text-sm font-medium text-foreground">
                  {titulo}
                </span>
              </div>
              <p className="flex-1 text-xs leading-relaxed text-muted-foreground">
                {texto}
              </p>
              <a
                href={`#${ancora(destino)}`}
                onClick={(e) => irParaSecao(e, destino)}
                className="text-xs font-medium text-primary underline-offset-2 hover:underline"
              >
                {t("comecar.verComo")} →
              </a>
            </div>
          ))}
        </div>
      </Secao>

      {/* b) Chave de API */}
      <Secao id={ancora("chave")} titulo={tituloDaSecao.chave()}>
        <Paragrafo>{t.rich("chave.passo1", rico)}</Paragrafo>
        <Paragrafo>
          {t.rich("chave.passo2", { ...rico, prefixo: ex.PREFIXO_DA_CHAVE })}
        </Paragrafo>
        {base ? (
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">{t("chave.urlBase")}</span>
            <ValorCopiavel
              valor={`${base}/api/v1`}
              rotulo={t("chave.copiarUrl")}
            />
          </div>
        ) : null}
        <Paragrafo>{t.rich("chave.passo3", rico)}</Paragrafo>
        {bloco(ex.curlDoMe(base, m), "GET /api/v1/me")}
        <Paragrafo>
          {t.rich("chave.limite", { ...rico, limite: ex.LIMITE_POR_MINUTO })}
        </Paragrafo>
      </Secao>

      {/* c) IDs */}
      <Secao id={ancora("ids")} titulo={tituloDaSecao.ids()}>
        <Paragrafo>{t.rich("ids.intro", rico)}</Paragrafo>
        <Lista>
          <li>{t.rich("ids.etiqueta", rico)}</li>
          <li>{t.rich("ids.campo", rico)}</li>
          <li>{t.rich("ids.usuario", rico)}</li>
          <li>{t.rich("ids.etapa", rico)}</li>
        </Lista>
        <Paragrafo>{t.rich("ids.api", rico)}</Paragrafo>
        {bloco(ex.curlDosFunis(base, m), "GET /api/v1/pipelines")}
      </Secao>

      {/* d) n8n */}
      <Secao id={ancora("n8n")} titulo={tituloDaSecao.n8n()}>
        <Subtitulo>{t("n8n.chamarTitulo")}</Subtitulo>
        <Lista numerada>
          <li>{t.rich("n8n.chamar1", rico)}</li>
          <li>{t.rich("n8n.chamar2", rico)}</li>
          <li>{t.rich("n8n.chamar3", rico)}</li>
        </Lista>
        {bloco(ex.credencialDoN8n(m), "n8n · HTTP Request")}
        <Paragrafo>
          {t.rich("n8n.paginacao", {
            ...rico,
            max: ex.TAMANHO_MAXIMO_DA_PAGINA,
          })}
        </Paragrafo>
        {bloco(ex.paginacaoDoN8n(), "n8n · Pagination")}

        <Subtitulo>{t("n8n.receberTitulo")}</Subtitulo>
        <Lista numerada>
          <li>
            {t.rich("n8n.receber1", {
              ...rico,
              segundos: ex.PRAZO_DA_ENTREGA_SEGUNDOS,
            })}
          </li>
          <li>{t.rich("n8n.receber2", rico)}</li>
          <li>{t.rich("n8n.receber3", rico)}</li>
        </Lista>
        <Paragrafo>{t.rich("n8n.servidor", rico)}</Paragrafo>
      </Secao>

      {/* e) Make */}
      <Secao id={ancora("make")} titulo={tituloDaSecao.make()}>
        <Subtitulo>{t("make.chamarTitulo")}</Subtitulo>
        <Paragrafo>{t.rich("make.chamar", rico)}</Paragrafo>
        {bloco(ex.chaveNoMake(m), "Make · API key")}
        <Paragrafo>{t("make.paginacao")}</Paragrafo>
        {bloco(ex.paginacaoDoMake(), "Make · Pagination")}

        <Subtitulo>{t("make.receberTitulo")}</Subtitulo>
        <Lista numerada>
          <li>{t.rich("make.receber1", rico)}</li>
          <li>
            {t.rich("make.receber2", {
              ...rico,
              segundos: ex.PRAZO_DA_ENTREGA_SEGUNDOS,
            })}
          </li>
        </Lista>
      </Secao>

      {/* f) Avisos do CRM (webhooks enviados) */}
      <Secao id={ancora("avisos")} titulo={tituloDaSecao.avisos()}>
        <Paragrafo>{t.rich("avisos.cadastro", rico)}</Paragrafo>
        <Paragrafo>
          {t.rich("avisos.cabecalhos", {
            ...rico,
            evento: ex.CABECALHO_DO_EVENTO,
            endereco: ex.CABECALHO_DO_ENDERECO,
            assinatura: ex.CABECALHO_DA_ASSINATURA,
          })}
        </Paragrafo>

        <div className="space-y-4">
          {EVENTOS_POR_GRUPO.map(({ grupo, eventos }) => (
            <div key={grupo} className="min-w-0 space-y-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {grupos[grupo]}
              </p>
              <ul className="space-y-2">
                {eventos.map((ev) => (
                  <li
                    key={ev}
                    className="min-w-0 rounded-md border border-border p-3"
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-sm font-medium text-foreground">
                        {rotulos[ev].rotulo}
                      </span>
                      <ValorCopiavel
                        valor={ev}
                        rotulo={t("avisos.copiarNome", { nome: ev })}
                      />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {rotulos[ev].descricao}
                    </p>
                    <Recolhivel
                      titulo={t("avisos.verExemplo")}
                      className="mt-2"
                    >
                      {bloco(ex.jsonDoEvento(ev), ev)}
                    </Recolhivel>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <Subtitulo>{t("avisos.regrasTitulo")}</Subtitulo>
        <Lista>
          <li>
            {t.rich("avisos.regra.umaTentativa", {
              ...rico,
              segundos: ex.PRAZO_DA_ENTREGA_SEGUNDOS,
            })}
          </li>
          <li>
            {t.rich("avisos.regra.desliga", {
              ...rico,
              falhas: ex.FALHAS_QUE_DESLIGAM,
            })}
          </li>
          <li>{t.rich("avisos.regra.repeticao", rico)}</li>
          <li>{t.rich("avisos.regra.teste", rico)}</li>
          <li>{t.rich("avisos.regra.negocio", rico)}</li>
          <li>{t.rich("avisos.regra.atraso", rico)}</li>
          <li>{t.rich("avisos.regra.doisAvisos", rico)}</li>
          <li>{t.rich("avisos.regra.migracao", rico)}</li>
        </Lista>

        <Recolhivel titulo={t("avisos.assinaturaTitulo")}>
          <Paragrafo>
            {t.rich("avisos.assinatura.intro", {
              ...rico,
              assinatura: ex.CABECALHO_DA_ASSINATURA,
              prefixo: ex.PREFIXO_DO_SEGREDO,
              minutos: ex.TOLERANCIA_DA_ASSINATURA_SEGUNDOS / 60,
            })}
          </Paragrafo>
          <Paragrafo>{t.rich("avisos.assinatura.n8n", rico)}</Paragrafo>
          {bloco(ex.codigoDoN8n(), "n8n · Code")}
          {bloco(ex.assinaturaNoN8n(m), "n8n · Crypto + IF")}
          <Paragrafo>{t.rich("avisos.assinatura.make", rico)}</Paragrafo>
          {bloco(ex.assinaturaNoMake(m), "Make · Filter")}
        </Recolhivel>
      </Secao>

      {/* g) Mandar dados ao CRM (webhooks recebidos) */}
      <Secao id={ancora("receber")} titulo={tituloDaSecao.receber()}>
        <Paragrafo>{t.rich("receber.texto", rico)}</Paragrafo>
        <Paragrafo>{t.rich("receber.telefone", rico)}</Paragrafo>
        <Paragrafo>{t.rich("receber.automacao", rico)}</Paragrafo>
      </Secao>

      {/* h) Receitas */}
      <Secao id={ancora("receitas")} titulo={tituloDaSecao.receitas()}>
        <Subtitulo>{t("receitas.etapa.titulo")}</Subtitulo>
        <Paragrafo>{t.rich("receitas.etapa.texto", rico)}</Paragrafo>
        {bloco(ex.filtroDeEtapaNoN8n(m), t("receitas.etapa.titulo"))}
        <Paragrafo>{t.rich("receitas.etapa.laco", rico)}</Paragrafo>
        {receitas.map((r) => (
          <div key={r.titulo} className="min-w-0 space-y-2">
            <Subtitulo>{r.titulo}</Subtitulo>
            <Paragrafo>{r.texto}</Paragrafo>
            {bloco(r.codigo, r.titulo)}
          </div>
        ))}
      </Secao>

      {/* i) Erros comuns */}
      <Secao id={ancora("erros")} titulo={tituloDaSecao.erros()}>
        <Lista>
          <li>{t.rich("erros.e401", rico)}</li>
          <li>{t.rich("erros.e403", rico)}</li>
          <li>
            {t.rich("erros.e429", { ...rico, limite: ex.LIMITE_POR_MINUTO })}
          </li>
          <li>{t.rich("erros.e400", rico)}</li>
          <li>{t.rich("erros.etiquetaPorId", rico)}</li>
          <li>{t.rich("erros.usuario", rico)}</li>
          <li>{t.rich("erros.testUrl", rico)}</li>
          <li>{t.rich("erros.url", rico)}</li>
          <li>
            {t.rich("erros.desligado", {
              ...rico,
              falhas: ex.FALHAS_QUE_DESLIGAM,
            })}
          </li>
        </Lista>
      </Secao>

      <Paragrafo className="text-xs">{t.rich("referencia", rico)}</Paragrafo>
    </div>
  );
}
