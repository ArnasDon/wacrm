"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { SeletorDeCliente } from "@/components/agenda/seletor-de-cliente";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { avisarAsaasMudou } from "@/lib/asaas/aviso";
import { diaPorExtenso, type FaixaDeAtraso } from "@/lib/asaas/inadimplencia";
import { NOMES_DAS_LISTAS, type ItemDaLista, type ItemInadimplente, type NomeDaLista, type Pagina, type ResumoDoEspelho } from "@/lib/asaas/listas";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";

/**
 * As cinco listas do cartão do Asaas (§3.3 do plano): Para confirmar, Sem
 * ficha, Ligados, Ignorados e Inadimplentes — paginadas pela rota
 * `GET /api/cb/asaas/clientes`, com Ligar/Ignorar/Desligar em cada linha.
 *
 * ⚠️ Cada lista guarda `{ chave, pagina }` e `carregando` é DERIVADO de
 * `chave !== chaveAtual`: a frase de vazio ("Nenhum cliente para confirmar")
 * só aparece com resposta resolvida para ESTA combinação de lista, página e
 * busca — nunca sobre a lista anterior nem durante a carga (a armadilha do
 * efeito passivo). Falha mostra "Não consegui ler" com Tentar de novo.
 */

type Faixa = "" | FaixaDeAtraso;

type Resposta<T> = Pagina<T> & { conectado: boolean; leituraFresca: boolean };

interface Estado {
  chave: string;
  pagina: Resposta<ItemDaLista> | Resposta<ItemInadimplente> | null;
  falhou: boolean;
}

interface Props {
  /** os números do cartão, para os rótulos das abas; `null` enquanto não se sabe */
  resumo: ResumoDoEspelho | null;
  /** muda quando o cartão recarrega (depois de sincronizar): relê a lista */
  versao: number;
  /** o vínculo mudou por aqui: o cartão relê o resumo */
  aoMudar: () => void;
}

const FAIXAS: Faixa[] = ["", "ate_5", "de_6_a_30", "mais_de_30"];

export function AsaasListas({ resumo, versao, aoMudar }: Props) {
  const t = useTranslations("Settings.integracoes");
  const [lista, setLista] = useState<NomeDaLista>("confirmar");
  const [pagina, setPagina] = useState(1);
  const [digitado, setDigitado] = useState("");
  const [busca, setBusca] = useState("");
  const [faixa, setFaixa] = useState<Faixa>("");
  const [recarga, setRecarga] = useState(0);
  const [estado, setEstado] = useState<Estado>({ chave: "", pagina: null, falhou: false });
  /** id do cliente cujo seletor de contato está aberto */
  const [escolhendo, setEscolhendo] = useState<string | null>(null);
  const [agindo, setAgindo] = useState<string | null>(null);

  const chave = `${lista}|${pagina}|${busca}|${faixa}|${versao}|${recarga}`;

  // A busca espera a digitação parar — cada tecla seria uma leitura do espelho inteiro.
  useEffect(() => {
    const timer = setTimeout(() => {
      setBusca(digitado.trim());
      setPagina(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [digitado]);

  useEffect(() => {
    let vivo = true;
    const params = new URLSearchParams({ lista, pagina: String(pagina) });
    if (busca) params.set("busca", busca);
    if (lista === "inadimplentes" && faixa) params.set("faixa", faixa);
    void fetch(`/api/cb/asaas/clientes?${params.toString()}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        return (await res.json()) as Resposta<ItemDaLista> | Resposta<ItemInadimplente>;
      })
      .then((corpo) => {
        if (vivo) setEstado({ chave, pagina: corpo, falhou: false });
      })
      .catch(() => {
        if (vivo) setEstado({ chave, pagina: null, falhou: true });
      });
    return () => {
      vivo = false;
    };
  }, [chave, lista, pagina, busca, faixa]);

  const carregando = estado.chave !== chave;

  const agir = useCallback(
    async (clienteId: string, corpo: { acao: string; contact_id?: string }) => {
      setAgindo(clienteId);
      try {
        const res = await fetch(`/api/cb/asaas/clientes/${clienteId}/vinculo`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(corpo),
        });
        if (!res.ok) {
          toast.error(t("asaas.acaoFalhou"));
          return;
        }
        setEscolhendo(null);
        avisarAsaasMudou();
        setRecarga((n) => n + 1);
        aoMudar();
      } finally {
        setAgindo(null);
      }
    },
    [aoMudar, t],
  );

  const desligar = (item: ItemDaLista) => {
    if (!window.confirm(t("asaas.confirmarDesligar", { nome: item.contato?.nome || item.contato?.telefone || "—" }))) return;
    void agir(item.id, { acao: "desligar" });
  };

  const trocarLista = (nova: NomeDaLista) => {
    setLista(nova);
    setPagina(1);
    setEscolhendo(null);
  };

  const contagem = (nome: NomeDaLista): number | null => {
    if (!resumo) return null;
    if (nome === "confirmar") return resumo.confirmar;
    if (nome === "sem_ficha") return resumo.semFicha;
    if (nome === "ligados") return resumo.ligados;
    if (nome === "ignorados") return resumo.ignorados;
    return resumo.inadimplentes;
  };

  const origem = (o: string | null) =>
    // chave montada: `asaas.origem.<origem>` — `ORIGENS_DO_VINCULO` em
    // `lib/asaas/cartao.ts`, cobrada nos dois dicionários por teste.
    o && ["telefone", "cpf", "email", "criada", "manual", "desvinculado"].includes(o) ? t(`asaas.origem.${o}` as Parameters<typeof t>[0]) : "";
  const motivo = (m: ItemDaLista["candidatos"][number]["motivo"]) =>
    // chave montada: `asaas.candidatoMotivo.<motivo>` — `MOTIVOS_DO_CANDIDATO` em `lib/asaas/vinculo.ts`.
    t(`asaas.candidatoMotivo.${m}` as Parameters<typeof t>[0]);

  const pag = estado.pagina;

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {NOMES_DAS_LISTAS.map((nome) => {
          const n = contagem(nome);
          return (
            <button
              key={nome}
              type="button"
              onClick={() => trocarLista(nome)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs",
                lista === nome ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {/* chave montada: `asaas.listas.<nome>` — `NOMES_DAS_LISTAS`, cobrada por teste */}
              {t(`asaas.listas.${nome}` as Parameters<typeof t>[0])}
              {n !== null ? ` (${n})` : ""}
            </button>
          );
        })}
      </div>

      {lista === "inadimplentes" ? (
        <div className="flex flex-wrap gap-1.5">
          {FAIXAS.map((f) => (
            <button
              key={f || "todas"}
              type="button"
              onClick={() => {
                setFaixa(f);
                setPagina(1);
              }}
              className={cn("rounded-md border px-2 py-0.5 text-xs", faixa === f ? "border-primary text-foreground" : "border-border text-muted-foreground hover:bg-muted")}
            >
              {/* chave montada: `asaas.faixa.<faixa>` */}
              {t(`asaas.faixa.${f || "todas"}` as Parameters<typeof t>[0])}
            </button>
          ))}
        </div>
      ) : (
        <Input value={digitado} onChange={(e) => setDigitado(e.target.value)} placeholder={t("asaas.buscar")} className="max-w-sm" />
      )}

      {estado.falhou && !carregando ? (
        <p className="text-muted-foreground">
          {t("asaas.listaFalhou")}{" "}
          <button type="button" onClick={() => setRecarga((n) => n + 1)} className="underline">
            {t("tentarDeNovo")}
          </button>
        </p>
      ) : carregando || !pag ? (
        <p className="text-muted-foreground">{t("asaas.carregando")}</p>
      ) : pag.itens.length === 0 ? (
        // chave montada: `asaas.vazio.<nome>`
        <p className="text-muted-foreground">{t(`asaas.vazio.${lista}` as Parameters<typeof t>[0])}</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {lista === "inadimplentes"
            ? (pag.itens as ItemInadimplente[]).map((i) => <LinhaInadimplente key={i.id} item={i} t={t} />)
            : (pag.itens as ItemDaLista[]).map((item) => (
                <li key={item.id} className="space-y-1.5 p-3 text-xs">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-sm font-medium text-foreground">{item.nome || "—"}</span>
                    {item.documento && <span className="text-muted-foreground">{item.documento}</span>}
                    {item.telefone && <span className="text-muted-foreground">{item.telefone}</span>}
                    {item.email && <span className="truncate text-muted-foreground">{item.email}</span>}
                    {item.divida && (
                      <span className="text-red-700 dark:text-red-300">
                        {t("asaas.dividaCurta", { parcelas: item.divida.parcelas, valor: formatCurrency(item.divida.total), dias: item.divida.dias ?? 0 })}
                      </span>
                    )}
                  </div>

                  {item.situacao === "ligado" && item.contato && (
                    <p className="text-muted-foreground">
                      {t("asaas.ligadoA", { nome: item.contato.nome || item.contato.telefone || "—" })}
                      {" · "}
                      {item.origem === "manual"
                        ? t("asaas.ligadoAMao", { quem: item.vinculadoPorNome ?? "—", quando: item.vinculadoEm ? new Date(item.vinculadoEm).toLocaleDateString(undefined) : "—" })
                        : item.origem === "criada"
                          ? t("asaas.fichaCriadaEm", { quando: item.vinculadoEm ? new Date(item.vinculadoEm).toLocaleDateString(undefined) : "—" })
                          : origem(item.origem)}
                    </p>
                  )}
                  {item.fichaCriadaApagada && <p className="text-amber-600 dark:text-amber-400">{t("asaas.fichaCriadaApagada")}</p>}
                  {item.manualOrfao && <p className="text-amber-600 dark:text-amber-400">{t("asaas.manualOrfao")}</p>}
                  {item.situacao === "sem_ficha" && !item.telefone && !item.fichaCriadaApagada && (
                    <p className="text-muted-foreground">{t("asaas.semTelefoneNoAsaas")}</p>
                  )}

                  {item.candidatos.length > 0 && (
                    <ul className="space-y-1">
                      {item.candidatos.map((k) => (
                        <li key={k.id} className="flex flex-wrap items-center gap-2">
                          <span>
                            {t("asaas.pareceSer")} <span className="font-medium text-foreground">{k.nome || k.telefone || "—"}</span>
                            {k.telefone && k.nome ? ` (${k.telefone})` : ""} · {motivo(k.motivo)}
                            {k.pontuacao !== null ? ` · ${t("asaas.pontuacao", { pct: Math.round(k.pontuacao * 100) })}` : ""}
                          </span>
                          <Button type="button" size="sm" variant="outline" disabled={agindo === item.id} onClick={() => void agir(item.id, { acao: "ligar", contact_id: k.id })}>
                            {t("asaas.ligar")}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    {item.situacao === "ligado" && (
                      <Button type="button" size="sm" variant="outline" disabled={agindo === item.id} onClick={() => desligar(item)}>
                        {t("asaas.desligar")}
                      </Button>
                    )}
                    {item.situacao === "ignorado" && (
                      <Button type="button" size="sm" variant="outline" disabled={agindo === item.id} onClick={() => void agir(item.id, { acao: "reconsiderar" })}>
                        {t("asaas.reconsiderar")}
                      </Button>
                    )}
                    {(item.situacao === "confirmar" || item.situacao === "sem_ficha") && (
                      <>
                        <Button type="button" size="sm" variant="outline" disabled={agindo === item.id} onClick={() => setEscolhendo(escolhendo === item.id ? null : item.id)}>
                          {item.candidatos.length > 0 ? t("asaas.outroContato") : t("asaas.vincularA")}
                        </Button>
                        <Button type="button" size="sm" variant="ghost" disabled={agindo === item.id} onClick={() => void agir(item.id, { acao: "ignorar" })}>
                          {t("asaas.ignorar")}
                        </Button>
                      </>
                    )}
                  </div>
                  {escolhendo === item.id && (
                    <div className="max-w-sm">
                      <SeletorDeCliente valor={null} aoEscolher={(c) => c && void agir(item.id, { acao: "ligar", contact_id: c.id })} />
                    </div>
                  )}
                </li>
              ))}
        </ul>
      )}

      {pag && pag.total > 0 && !carregando && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Button type="button" size="sm" variant="ghost" disabled={pag.pagina <= 1} onClick={() => setPagina((p) => Math.max(1, p - 1))}>
            {t("asaas.anterior")}
          </Button>
          <span>{t("asaas.paginacao", { pagina: pag.pagina, paginas: pag.paginas, total: pag.total })}</span>
          <Button type="button" size="sm" variant="ghost" disabled={pag.pagina >= pag.paginas} onClick={() => setPagina((p) => p + 1)}>
            {t("asaas.proxima")}
          </Button>
        </div>
      )}

      {lista === "sem_ficha" && <p className="max-w-[70ch] text-xs text-muted-foreground">{t("asaas.semFichaRodape")}</p>}
    </div>
  );
}

function LinhaInadimplente({ item, t }: { item: ItemInadimplente; t: ReturnType<typeof useTranslations<"Settings.integracoes">> }) {
  const d = item.divida;
  return (
    <li className="space-y-1 p-3 text-xs">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-sm font-medium text-foreground">{item.nome || "—"}</span>
        {item.documento && <span className="text-muted-foreground">{item.documento}</span>}
        {item.contato ? (
          <span className="text-muted-foreground">{t("asaas.ligadoA", { nome: item.contato.nome || item.contato.telefone || "—" })}</span>
        ) : (
          <span className="text-amber-600 dark:text-amber-400">{t("asaas.semFichaMarca")}</span>
        )}
      </div>
      <p className="text-red-700 dark:text-red-300">
        {t("asaas.parcelasResumo", { n: d.parcelas, rotulos: d.rotulos })}
        {" · "}
        {t("asaas.totalDesde", { valor: formatCurrency(d.total), dia: d.desde ? diaPorExtenso(d.desde) : "—", dias: d.dias ?? 0 })}
        {d.totalAtualizado !== d.total ? ` · ${t("asaas.atualizado", { valor: formatCurrency(d.totalAtualizado) })}` : ""}
        {d.negativada ? ` · ${t("asaas.negativada")}` : ""}
      </p>
    </li>
  );
}
