"use client";

// ============================================================
// Configurações → API → aba IDs — uma tela de CONSULTA para quem monta
// automação no n8n, no Make ou em código próprio.
//
// A API pede ids que nenhuma outra tela mostra: o `stage_id` da etapa, o
// `channel_id` da conexão, a CHAVE do campo personalizado, o id de usuário
// de quem recebe a tarefa. Aqui eles aparecem com o nome ao lado e um botão
// de copiar em cada um. A regra do que aparece (busca, forma do JSON) mora
// em `src/lib/integracoes/ids-da-conta.ts`, que tem teste.
//
// ⚠️ Mostra TODOS os funis e TODAS as conexões da conta, sem o recorte do
// perfil de acesso. De propósito: a chave de API enxerga a conta inteira
// (o perfil é recorte de VISUALIZAÇÃO, não barreira — a 956 diz isso por
// escrito), então um id "escondido" aqui continuaria valendo na API, e quem
// monta o fluxo ficaria sem ele. As consultas sob RLS já trazem a conta
// inteira; a rota de conexões também (`listChannels` não olha o perfil).
//
// ⚠️ Cada bloco tem o SEU estado (carregando / falhou / pronto). Lista vazia
// só vira "nenhuma etiqueta nesta conta" com a resposta na mão — durante a
// carga, ou depois de uma falha, a frase seria mentira, e quem veio copiar
// um id sai achando que ele não existe (a armadilha do efeito passivo e da
// lista vazia virando afirmação, no CLAUDE.md).
// ============================================================

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  BookOpen,
  Braces,
  Building2,
  Kanban,
  Loader2,
  RotateCw,
  Search,
  Smartphone,
  Tags,
  TextCursorInput,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconeDoTransporte } from "@/components/channels/transporte-icone";
import { useAuth } from "@/hooks/use-auth";
import { useChannels } from "@/hooks/use-channels";
import { useMembros } from "@/hooks/use-membros";
import { memberLabel } from "@/lib/account/members";
import type { AccountRole } from "@/lib/auth/roles";
import { coresPorCanal } from "@/lib/cb-channels/cores";
import { identidadeDoCanal } from "@/lib/cb-channels/display";
import type { CbChannel } from "@/lib/cb-channels/repo";
import type { Transporte } from "@/lib/cb-channels/transporte";
import { TIPO_DATA } from "@/lib/contacts/campo-data";
import { agruparCampos, type BlocoDeCampos } from "@/lib/contacts/grupos-de-campos";
import {
  contaCasa,
  dadosDoBloco,
  filtrarBlocosDeCampos,
  filtrarConexoes,
  filtrarEtiquetas,
  filtrarFunis,
  filtrarMembros,
  montarFunis,
  montarJsonDosIds,
  normalizarBusca,
  type EstadoDoBloco,
  type EtiquetaDaConta,
  type FunilComEtapas,
  type LinhaDeEtapa,
  type LinhaDeFunil,
  type ResultadoDaEtapa,
} from "@/lib/integracoes/ids-da-conta";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { AccountMember, CustomField, GrupoDeCampos } from "@/types";

import { BotaoCopiar, FONTE_MONO, ValorCopiavel } from "./copiar";
import { ROLE_META } from "./role-meta";
import { SettingsChip } from "./settings-chip";

// ------------------------------------------------------------
// Leitura
// ------------------------------------------------------------

const PAGINA = 1000;

/**
 * Lê TODAS as páginas de uma consulta. O PostgREST corta em 1000 linhas sem
 * avisar, e esta tela existe para COPIAR: a etiqueta que ficasse depois do
 * corte simplesmente não apareceria, e quem a procurava concluiria que ela
 * não existe (o mesmo motivo de `lerCatalogoDeTags` paginar). A ordem de
 * cada consulta termina no `id` para as páginas não repetirem nem pularem
 * linha no empate.
 */
async function lerTodas<T>(
  pagina: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[] | null> {
  const tudo: T[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await pagina(de, de + PAGINA - 1);
    if (error || !data) return null;
    tudo.push(...data);
    if (data.length < PAGINA) return tudo;
  }
}

/** Funis por criação — a ordem da tela de Funis e de `GET /api/v1/pipelines`. */
async function lerFunis(): Promise<FunilComEtapas[] | null> {
  const supabase = createClient();
  const [funis, etapas] = await Promise.all([
    lerTodas<LinhaDeFunil>((de, ate) =>
      supabase.from("pipelines").select("id, name").order("created_at").order("id").range(de, ate),
    ),
    lerTodas<LinhaDeEtapa>((de, ate) =>
      supabase
        .from("pipeline_stages")
        .select("id, name, pipeline_id, position, color, resultado")
        .order("position")
        .order("id")
        .range(de, ate),
    ),
  ]);
  if (!funis || !etapas) return null;
  return montarFunis(funis, etapas);
}

async function lerEtiquetas(): Promise<EtiquetaDaConta[] | null> {
  const supabase = createClient();
  // ⚠️ SEM filtro de `user_id`. A RLS de `tags` é por CONTA; filtrar pelo
  // usuário (o que o `tag-manager.tsx` ainda faz) mostraria só as etiquetas
  // que a própria pessoa criou — e a API aceita as da conta inteira.
  const linhas = await lerTodas<{ id: string; name: string; color: string | null }>((de, ate) =>
    supabase.from("tags").select("id, name, color").order("name").order("id").range(de, ate),
  );
  return linhas?.map((l) => ({ id: l.id, nome: l.name, cor: l.color })) ?? null;
}

async function lerCampos(): Promise<BlocoDeCampos[] | null> {
  const supabase = createClient();
  // ⚠️ `posicao` é posição DENTRO do bloco, e só quem REAGRUPA pode ordenar
  // por ela (regra do CLAUDE.md) — é o caso aqui: `agruparCampos` reparte.
  const [campos, grupos] = await Promise.all([
    lerTodas<CustomField>((de, ate) =>
      supabase
        .from("custom_fields")
        .select("*")
        .order("posicao", { nullsFirst: false })
        .order("field_name")
        .order("id")
        .range(de, ate),
    ),
    lerTodas<GrupoDeCampos>((de, ate) =>
      supabase
        .from("cb_grupos_de_campos")
        .select("*")
        .order("posicao")
        .order("nome")
        .order("id")
        .range(de, ate),
    ),
  ]);
  if (!campos || !grupos) return null;
  return agruparCampos(campos, grupos);
}

/**
 * Um bloco lido do banco, com o seu próprio "tentar de novo".
 *
 * `ler` precisa ser estável (as leituras acima são de módulo). O `setEstado`
 * de "carregando" fica DENTRO da IIFE, como em `use-membros`: `setState`
 * síncrono no corpo do efeito é erro do React Compiler.
 */
function useBloco<T>(ler: () => Promise<T | null>) {
  const [estado, setEstado] = useState<EstadoDoBloco<T>>({ fase: "carregando" });
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    let cancelado = false;
    void (async () => {
      setEstado({ fase: "carregando" });
      let dados: T | null = null;
      try {
        dados = await ler();
      } catch {
        dados = null;
      }
      if (!cancelado) setEstado(dados === null ? { fase: "falhou" } : { fase: "pronto", dados });
    })();
    return () => {
      cancelado = true;
    };
  }, [ler, tentativa]);

  const recarregar = useCallback(() => setTentativa((n) => n + 1), []);
  return { estado, recarregar };
}

// ------------------------------------------------------------
// A aba
// ------------------------------------------------------------

export function IdsDaConta({
  irParaAba,
}: {
  irParaAba: (aba: "chaves" | "ids" | "docs") => void;
}) {
  const t = useTranslations("Settings.idsDaConta");
  const tCopiar = useTranslations("Settings.copiar");
  const tCampos = useTranslations("Contacts.customFields");
  const tCanaisDaConta = useTranslations("Settings.channels");
  const tTransporte = useTranslations("Channels");
  const tPapeis = useTranslations("Settings.roles");

  const { accountId, account, profileLoading } = useAuth();
  const funis = useBloco(lerFunis);
  const etiquetas = useBloco(lerEtiquetas);
  const campos = useBloco(lerCampos);
  const canais = useChannels();
  const membros = useMembros();

  const [busca, setBusca] = useState("");
  const agulha = normalizarBusca(busca);

  // Os dois hooks compartilhados falam a língua deles (`loading`/`falhou`,
  // `carregando`/`falhou`); aqui viram a mesma de todo bloco.
  const estadoDosCanais: EstadoDoBloco<CbChannel[]> = canais.loading
    ? { fase: "carregando" }
    : canais.falhou
      ? { fase: "falhou" }
      : { fase: "pronto", dados: canais.channels };
  const estadoDosMembros: EstadoDoBloco<AccountMember[]> = membros.carregando
    ? { fase: "carregando" }
    : membros.falhou
      ? { fase: "falhou" }
      : { fase: "pronto", dados: membros.membros };
  // A conta vem do perfil. Sem perfil resolvido, a casca inteira já está
  // num spinner; `accountId` nulo DEPOIS disso é conta que não resolveu (o
  // `AccountAccessAlert` do shell diz por quê) — "falhou", sem tentar de novo.
  const conta = accountId ? { id: accountId, nome: account?.name ?? null } : null;
  const faseDaConta: EstadoDoBloco<unknown>["fase"] = profileLoading
    ? "carregando"
    : conta
      ? "pronto"
      : "falhou";

  const rotuloDoGeral = tCampos("groupGeneral");
  const cores = useMemo(() => coresPorCanal(canais.channels), [canais.channels]);

  // O filtrado de cada bloco; `null` enquanto o bloco não está pronto.
  const funisVistos = useMemo(() => {
    const d = dadosDoBloco(funis.estado);
    return d && filtrarFunis(d, agulha);
  }, [funis.estado, agulha]);
  const etiquetasVistas = useMemo(() => {
    const d = dadosDoBloco(etiquetas.estado);
    return d && filtrarEtiquetas(d, agulha);
  }, [etiquetas.estado, agulha]);
  const camposVistos = useMemo(() => {
    const d = dadosDoBloco(campos.estado);
    return d && filtrarBlocosDeCampos(d, agulha, rotuloDoGeral);
  }, [campos.estado, agulha, rotuloDoGeral]);
  const canaisVistos = dadosDoBloco(estadoDosCanais) && filtrarConexoes(canais.channels, agulha);
  const membrosVistos =
    dadosDoBloco(estadoDosMembros) && filtrarMembros(membros.membros, agulha);

  // Durante a busca, bloco PRONTO sem nada que case some (o cabeçalho sozinho
  // não informa nada). Bloco carregando ou que falhou FICA: ele não pode
  // responder "não há", e escondê-lo esconderia justamente que falta olhar ali.
  const mostra = (fase: EstadoDoBloco<unknown>["fase"], vistos: number | null) =>
    !agulha || fase !== "pronto" || (vistos ?? 0) > 0;
  const mostraConta = !agulha || faseDaConta !== "pronto" || (!!conta && contaCasa(conta, agulha));
  const mostraFunis = mostra(funis.estado.fase, funisVistos?.length ?? null);
  const mostraEtiquetas = mostra(etiquetas.estado.fase, etiquetasVistas?.length ?? null);
  const mostraCampos = mostra(campos.estado.fase, camposVistos?.length ?? null);
  const mostraCanais = mostra(estadoDosCanais.fase, canaisVistos?.length ?? null);
  const mostraMembros = mostra(estadoDosMembros.fase, membrosVistos?.length ?? null);
  const nadaCasa =
    !mostraConta &&
    !mostraFunis &&
    !mostraEtiquetas &&
    !mostraCampos &&
    !mostraCanais &&
    !mostraMembros;

  const fases = [
    faseDaConta,
    funis.estado.fase,
    etiquetas.estado.fase,
    campos.estado.fase,
    estadoDosCanais.fase,
    estadoDosMembros.fase,
  ];
  const algumCarregando = fases.includes("carregando");
  const algumFalhou = fases.includes("falhou");

  // Copia TUDO o que carregou, sem o recorte da busca — o botão diz "tudo".
  // Bloco que falhou sai `null` no JSON (ver `montarJsonDosIds`), e o aviso
  // diz isso, porque o JSON vai parar num fluxo onde ninguém vê esta tela.
  async function copiarTudo() {
    const json = montarJsonDosIds({
      conta,
      funis: dadosDoBloco(funis.estado),
      etiquetas: dadosDoBloco(etiquetas.estado),
      campos: dadosDoBloco(campos.estado),
      rotuloDoGeral,
      conexoes: dadosDoBloco(estadoDosCanais),
      membros: dadosDoBloco(estadoDosMembros),
    });
    try {
      await navigator.clipboard.writeText(JSON.stringify(json, null, 2));
      if (algumFalhou) toast.warning(t("copiadoParcial"));
      else toast.success(tCopiar("copiado"));
    } catch {
      toast.error(tCopiar("falhou"));
    }
  }

  // Chave LITERAL por valor (Record de funções): o portão de i18n do CI só
  // confere chamadas com chave literal, e uma chave montada com o valor sairia crua
  // na tela no dia em que aparecesse um valor novo.
  const rotuloDoTipo: Record<string, () => string> = {
    text: () => tCampos("typeText"),
    [TIPO_DATA]: () => tCampos("typeDate"),
    select: () => tCampos("typeSelect"),
    number: () => tCampos("typeNumber"),
  };
  const rotuloDoTransporte: Record<Transporte, () => string> = {
    meta: () => tTransporte("kind_meta"),
    evolution: () => tTransporte("kind_evolution"),
    instagram: () => tTransporte("kind_instagram"),
  };
  const rotuloDoPapel: Record<AccountRole, () => string> = {
    owner: () => tPapeis("owner"),
    admin: () => tPapeis("admin"),
    agent: () => tPapeis("agent"),
    viewer: () => tPapeis("viewer"),
  };
  const seloDoResultado: Record<ResultadoDaEtapa, { rotulo: () => string; variante: "ok" | "err" }> = {
    ganho: { rotulo: () => t("funis.ganho"), variante: "ok" },
    perdido: { rotulo: () => t("funis.perdido"), variante: "err" },
  };

  // Os trechos de código e o destaque dentro das frases de "por onde a API
  // devolve isto". Tag sem atributo no dicionário; a classe vem daqui.
  const rico = {
    code: (partes: ReactNode) => (
      <code
        className="rounded bg-muted px-1 py-px text-[11px] text-foreground"
        style={{ fontFamily: FONTE_MONO }}
      >
        {partes}
      </code>
    ),
    b: (partes: ReactNode) => <strong className="font-semibold text-foreground">{partes}</strong>,
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="max-w-[62ch] min-w-0 text-sm text-muted-foreground">{t("intro")}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => irParaAba("docs")}
          className="shrink-0 self-start"
        >
          <BookOpen />
          {t("verDocumentacao")}
        </Button>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder={t("buscar")}
            aria-label={t("buscarAria")}
            className="pl-8"
          />
        </div>
        {/* Desligado enquanto algum bloco carrega: o JSON copiado nesse
            instante levaria `null` onde a resposta ainda ia chegar. */}
        <Button
          variant="outline"
          onClick={() => void copiarTudo()}
          disabled={algumCarregando}
          className="shrink-0"
        >
          <Braces />
          {t("copiarTudo")}
        </Button>
      </div>

      {nadaCasa ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          {t("nadaEncontrado", { busca: busca.trim() })}
        </p>
      ) : null}

      {mostraConta ? (
        <BlocoDeIds
          icone={Building2}
          titulo={t("conta.titulo")}
          total={null}
          fonte={t.rich("conta.fonte", rico)}
          fase={faseDaConta}
        >
          {conta ? (
            <ul>
              <LinhaDeId>
                <div className="min-w-0">
                  {conta.nome ? (
                    <p className="truncate text-sm font-medium text-foreground">{conta.nome}</p>
                  ) : null}
                  <p className="text-xs text-muted-foreground">{t("conta.rotulo")}</p>
                </div>
                <ValorCopiavel valor={conta.id} rotulo={t("conta.copiar")} className="max-w-full" />
              </LinhaDeId>
            </ul>
          ) : null}
        </BlocoDeIds>
      ) : null}

      {mostraFunis ? (
        <BlocoDeIds
          icone={Kanban}
          titulo={t("funis.titulo")}
          total={dadosDoBloco(funis.estado)?.length ?? null}
          fonte={t.rich("funis.fonte", rico)}
          fase={funis.estado.fase}
          aoTentarDeNovo={funis.recarregar}
        >
          {funisVistos && funisVistos.length === 0 ? (
            <Vazio>{t("funis.vazio")}</Vazio>
          ) : (
            <div className="divide-y divide-border">
              {funisVistos?.map((funil) => (
                <div key={funil.id}>
                  <div className="flex flex-col gap-1.5 bg-muted/30 px-4 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                    <p className="min-w-0 truncate text-sm font-semibold text-foreground">
                      {funil.nome}
                    </p>
                    <ValorCopiavel
                      valor={funil.id}
                      rotulo={t("funis.copiarFunil", { nome: funil.nome })}
                      className="max-w-full"
                    />
                  </div>
                  {funil.etapas.length === 0 ? (
                    <Vazio>{t("funis.semEtapas")}</Vazio>
                  ) : (
                    <ol className="divide-y divide-border">
                      {funil.etapas.map((etapa) => {
                        const selo = etapa.resultado ? seloDoResultado[etapa.resultado] : null;
                        return (
                          <LinhaDeId key={etapa.id} className="sm:pl-6">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="w-5 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                                {etapa.ordem}
                              </span>
                              <Bolinha cor={etapa.cor} />
                              <span className="min-w-0 truncate text-sm text-foreground">
                                {etapa.nome}
                              </span>
                              {selo ? (
                                <span title={t("funis.dicaResultado")} className="shrink-0">
                                  <SettingsChip variant={selo.variante}>{selo.rotulo()}</SettingsChip>
                                </span>
                              ) : null}
                            </div>
                            <ValorCopiavel
                              valor={etapa.id}
                              rotulo={t("funis.copiarEtapa", { nome: etapa.nome })}
                              className="max-w-full"
                            />
                          </LinhaDeId>
                        );
                      })}
                    </ol>
                  )}
                </div>
              ))}
            </div>
          )}
        </BlocoDeIds>
      ) : null}

      {mostraEtiquetas ? (
        <BlocoDeIds
          icone={Tags}
          titulo={t("etiquetas.titulo")}
          total={dadosDoBloco(etiquetas.estado)?.length ?? null}
          fonte={t.rich("etiquetas.fonte", rico)}
          fase={etiquetas.estado.fase}
          aoTentarDeNovo={etiquetas.recarregar}
        >
          {etiquetasVistas && etiquetasVistas.length === 0 ? (
            <Vazio>{t("etiquetas.vazio")}</Vazio>
          ) : (
            <ul className="divide-y divide-border">
              {etiquetasVistas?.map((etiqueta) => (
                <LinhaDeId key={etiqueta.id}>
                  <div className="flex min-w-0 items-center gap-2">
                    <Bolinha cor={etiqueta.cor} />
                    <span className="min-w-0 truncate text-sm text-foreground">{etiqueta.nome}</span>
                  </div>
                  <ValorCopiavel
                    valor={etiqueta.id}
                    rotulo={t("etiquetas.copiar", { nome: etiqueta.nome })}
                    className="max-w-full"
                  />
                </LinhaDeId>
              ))}
            </ul>
          )}
        </BlocoDeIds>
      ) : null}

      {mostraCampos ? (
        <BlocoDeIds
          icone={TextCursorInput}
          titulo={t("campos.titulo")}
          total={
            dadosDoBloco(campos.estado)?.reduce((soma, bloco) => soma + bloco.campos.length, 0) ??
            null
          }
          fonte={
            <>
              {t.rich("campos.fonte", rico)}{" "}
              {t.rich("campos.nasAutomacoes", rico)}
            </>
          }
          fase={campos.estado.fase}
          aoTentarDeNovo={campos.recarregar}
        >
          {camposVistos && camposVistos.every((bloco) => bloco.campos.length === 0) ? (
            <Vazio>{t("campos.vazio")}</Vazio>
          ) : (
            <div className="divide-y divide-border">
              {camposVistos?.map((bloco) => (
                <div key={bloco.grupo?.id ?? "geral"}>
                  <p className="bg-muted/30 px-4 py-1.5 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
                    {bloco.grupo?.nome ?? rotuloDoGeral}
                  </p>
                  <ul className="divide-y divide-border">
                    {bloco.campos.map((campo) => (
                      <li key={campo.id} className="space-y-1.5 px-4 py-2.5">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="min-w-0 truncate text-sm text-foreground">
                            {campo.field_name}
                          </span>
                          <SettingsChip>
                            {rotuloDoTipo[campo.field_type]?.() ?? campo.field_type}
                          </SettingsChip>
                        </div>
                        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
                          {/* A CHAVE em destaque: é ela, e não o id, que a
                              API e as mensagens das automações usam. */}
                          <span className="inline-flex max-w-full min-w-0 items-center gap-1.5">
                            <span className="shrink-0 text-[11px] font-medium text-primary">
                              {t("campos.chave")}
                            </span>
                            <ValorCopiavel
                              valor={campo.field_key}
                              rotulo={t("campos.copiarChave", { nome: campo.field_name })}
                              className="[&>code]:bg-primary-soft [&>code]:text-primary"
                            />
                          </span>
                          <IdDiscreto
                            valor={campo.id}
                            rotulo={t("campos.copiarId", { nome: campo.field_name })}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </BlocoDeIds>
      ) : null}

      {mostraCanais ? (
        <BlocoDeIds
          icone={Smartphone}
          titulo={t("conexoes.titulo")}
          total={dadosDoBloco(estadoDosCanais)?.length ?? null}
          fonte={t.rich("conexoes.fonte", rico)}
          fase={estadoDosCanais.fase}
          aoTentarDeNovo={canais.recarregar}
        >
          {canaisVistos && canaisVistos.length === 0 ? (
            <Vazio>{t("conexoes.vazio")}</Vazio>
          ) : (
            <ul className="divide-y divide-border">
              {canaisVistos?.map((canal) => (
                <LinhaDeId key={canal.id}>
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        aria-hidden
                        className={cn(
                          "size-2 shrink-0 rounded-full",
                          cores.get(canal.id)?.ponto ?? "bg-muted-foreground/40",
                        )}
                      />
                      <span className="min-w-0 truncate text-sm font-medium text-foreground">
                        {canal.label}
                      </span>
                      {canal.is_default ? (
                        <SettingsChip className="shrink-0">{tCanaisDaConta("defaultBadge")}</SettingsChip>
                      ) : null}
                    </div>
                    <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                      <IconeDoTransporte kind={canal.kind} className="size-3.5 shrink-0" />
                      <span className="min-w-0 truncate">
                        {rotuloDoTransporte[canal.kind]()}
                        {" · "}
                        {identidadeDoCanal(canal) ?? t("conexoes.semIdentidade")}
                      </span>
                    </p>
                  </div>
                  <ValorCopiavel
                    valor={canal.id}
                    rotulo={t("conexoes.copiar", { nome: canal.label })}
                    className="max-w-full"
                  />
                </LinhaDeId>
              ))}
            </ul>
          )}
        </BlocoDeIds>
      ) : null}

      {mostraMembros ? (
        <BlocoDeIds
          icone={UsersRound}
          titulo={t("membros.titulo")}
          total={dadosDoBloco(estadoDosMembros)?.length ?? null}
          fonte={t.rich("membros.fonte", rico)}
          fase={estadoDosMembros.fase}
          aoTentarDeNovo={membros.recarregar}
        >
          {/* Sem frase de "nenhum membro": quem está olhando É membro, e a
              lista pronta nunca vem vazia. */}
          <ul className="divide-y divide-border">
            {membrosVistos?.map((membro) => {
              const papel = ROLE_META[membro.role];
              const IconeDoPapel = papel.icon;
              const nome = memberLabel(membro);
              return (
                <LinhaDeId key={membro.user_id}>
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 truncate text-sm font-medium text-foreground">
                        {nome}
                      </span>
                      <SettingsChip variant={papel.variant} className="shrink-0">
                        <IconeDoPapel />
                        {rotuloDoPapel[membro.role]()}
                      </SettingsChip>
                    </div>
                    {/* A rota de membros só devolve o e-mail a quem administra
                        (`canManageMembers`); para os outros ele vem nulo. */}
                    {membro.email ? (
                      <p className="truncate text-xs text-muted-foreground">{membro.email}</p>
                    ) : null}
                  </div>
                  <ValorCopiavel
                    valor={membro.user_id}
                    rotulo={t("membros.copiar", { nome })}
                    className="max-w-full"
                  />
                </LinhaDeId>
              );
            })}
          </ul>
        </BlocoDeIds>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------
// Peças
// ------------------------------------------------------------

function BlocoDeIds({
  icone: Icone,
  titulo,
  total,
  fonte,
  fase,
  aoTentarDeNovo,
  children,
}: {
  icone: LucideIcon;
  titulo: string;
  /** Quantos há na conta (sem o recorte da busca); `null` enquanto não se sabe. */
  total: number | null;
  /** Por onde a API devolve esta lista — ou o aviso de que não devolve. */
  fonte: ReactNode;
  fase: EstadoDoBloco<unknown>["fase"];
  /** Sem ele, a falha não oferece "tentar de novo" (a conta, que vem do perfil). */
  aoTentarDeNovo?: () => void | Promise<void>;
  children: ReactNode;
}) {
  const t = useTranslations("Settings.idsDaConta");
  const tSecao = useTranslations("Settings.secaoApi");
  // O `recarregar` das conexões não volta o hook para "carregando" (ele
  // mantém a lista enquanto busca); sem este estado, o clique em "tentar de
  // novo" não teria resposta nenhuma na tela até a rede responder.
  const [tentando, setTentando] = useState(false);

  async function tentar() {
    if (!aoTentarDeNovo) return;
    setTentando(true);
    try {
      await aoTentarDeNovo();
    } finally {
      setTentando(false);
    }
  }

  return (
    <section className="min-w-0 overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex items-start gap-3 border-b border-border px-4 py-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
          <Icone className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="flex items-baseline gap-2 text-sm font-semibold text-foreground">
            {titulo}
            {total !== null ? (
              <span className="text-xs font-normal text-muted-foreground tabular-nums">{total}</span>
            ) : null}
          </h3>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{fonte}</p>
        </div>
      </header>

      {fase === "carregando" || tentando ? (
        <p className="flex items-center gap-2 px-4 py-4 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          {t("carregando")}
        </p>
      ) : fase === "falhou" ? (
        <div className="flex flex-wrap items-center gap-3 px-4 py-4">
          <p className="text-xs text-muted-foreground">{t("falhou")}</p>
          {aoTentarDeNovo ? (
            <Button variant="outline" size="sm" onClick={() => void tentar()}>
              <RotateCw className="size-3.5" />
              {tSecao("tentarDeNovo")}
            </Button>
          ) : null}
        </div>
      ) : (
        children
      )}
    </section>
  );
}

/**
 * Uma linha da lista: o nome à esquerda, o id à direita. No celular empilha
 * (nome em cima, id embaixo) — um UUID em fonte mono tem ~240 px, e lado a
 * lado com o nome a 375 px um dos dois sumiria no truncamento.
 */
function LinhaDeId({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <li
      className={cn(
        "flex min-w-0 flex-col gap-1.5 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3",
        className,
      )}
    >
      {children}
    </li>
  );
}

function Vazio({ children }: { children: ReactNode }) {
  return <p className="px-4 py-4 text-xs text-muted-foreground">{children}</p>;
}

/** A cor que vem do banco (etiqueta, etapa). Sem cor, um cinza do tema. */
function Bolinha({ cor }: { cor: string | null }) {
  return (
    <span
      aria-hidden
      className={cn("size-2.5 shrink-0 rounded-full", !cor && "bg-muted-foreground/40")}
      style={cor ? { backgroundColor: cor } : undefined}
    />
  );
}

/**
 * O id do campo personalizado, em segundo plano: a API e as automações usam
 * a CHAVE, e um id do mesmo tamanho e cor ao lado dela convidaria a copiar o
 * errado. Ele continua copiável — é o que a automação grava internamente, e
 * quem depura um fluxo às vezes precisa dele.
 */
function IdDiscreto({ valor, rotulo }: { valor: string; rotulo: string }) {
  const t = useTranslations("Settings.idsDaConta");
  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-1 text-muted-foreground">
      <span className="shrink-0 text-[11px]">{t("rotuloId")}</span>
      <code className="min-w-0 truncate text-[10.5px]" style={{ fontFamily: FONTE_MONO }} title={valor}>
        {valor}
      </code>
      <BotaoCopiar valor={valor} rotulo={rotulo} />
    </span>
  );
}
