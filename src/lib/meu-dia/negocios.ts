// ============================================================
// "Meus negócios no funil" — agrupamento por etapa, puro.
//
// ⚠️⚠️ O DONO DO NEGÓCIO É `deals.assigned_to`, E ELE GUARDA `profiles.id`
// — não `auth.users.id`. É a EXCEÇÃO no Meu dia: `cb_tasks`,
// `conversations` e `notifications` guardam o id do LOGIN, e o hook filtra
// por `user.id` nos três. Aqui, `user.id` devolve ZERO linhas sem erro
// nenhum — a pessoa com trinta cards abertos vê o bloco vazio e conclui que
// não tem negócio nenhum. O filtro sai de `profile.id`, e a consulta do
// hook carrega esta nota junto.
//
// ⚠️ O recorte por FUNIL do perfil é feito aqui, em JS, e não na consulta:
// é o mesmo motivo do recorte de conversas por canal — manter a régua num
// lugar só (`funilNoEscopo`), que já sabe o que fazer com perfil sem
// restrição. Um advogado do trabalhista não precisa do funil do bancário na
// tela de entrada.
// ============================================================

import { funilNoEscopo } from '@/lib/perfis/escopo';
import type { ContextoDeAcesso } from '@/lib/perfis/tipos';

/** Só o que este bloco lê — o select do hook é enxuto por isso. */
export interface NegocioDoBloco {
  id: string;
  title: string | null;
  value: number | string | null;
  pipeline_id: string | null;
  stage_id: string | null;
  pipeline?: { id: string; name: string | null } | null;
  stage?: { id: string; name: string | null; position?: number | null } | null;
}

export interface GrupoDeEtapa {
  /** `funil|etapa` — chave estável de render, e o que agrupa. */
  chave: string;
  pipelineId: string | null;
  stageId: string | null;
  funilNome: string | null;
  etapaNome: string | null;
  posicao: number;
  quantidade: number;
  /** Soma dos valores; `0` quando ninguém tem valor preenchido. */
  valor: number;
}

/**
 * ⚠️ `value` é `NUMERIC(12,2)`, e o PostgREST pode entregá-lo como STRING.
 * `Number(null)` é 0 e `Number('')` também — o que não é problema aqui
 * (somar zero), mas `Number('abc')` é NaN e contaminaria o total inteiro
 * com "NaN" na tela. Valor que não vira número finito conta como zero.
 */
export function valorDoNegocio(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * ⚠️ Negócio SEM funil PASSA no recorte, pela mesma regra de
 * `conversaNoEscopo`: não sabemos de qual funil ele é, e escondê-lo
 * afirmaria algo que ninguém sabe. (Hoje `deals.pipeline_id` é NOT NULL na
 * prática; a guarda existe para o dia em que deixar de ser.)
 */
export function negociosNoEscopo<T extends { pipeline_id: string | null }>(
  negocios: T[],
  ctx: ContextoDeAcesso
): T[] {
  return negocios.filter(
    (n) => n.pipeline_id === null || funilNoEscopo(ctx, n.pipeline_id)
  );
}

/**
 * Agrupa por (funil, etapa) e ordena pela POSIÇÃO da etapa no funil, que é
 * a ordem que o operador enxerga no quadro — nunca por quantidade nem por
 * valor, que embaralhariam o funil e fariam a leitura "onde está parado?"
 * exigir procurar. Etapa sem posição vai para o fim (a régua de
 * `nullsFirst: false` do resto do projeto).
 */
export function agruparPorEtapa(
  negocios: NegocioDoBloco[],
  ctx: ContextoDeAcesso
): GrupoDeEtapa[] {
  const grupos = new Map<string, GrupoDeEtapa>();
  for (const n of negociosNoEscopo(negocios, ctx)) {
    const chave = `${n.pipeline_id ?? '?'}|${n.stage_id ?? '?'}`;
    const atual = grupos.get(chave);
    if (atual) {
      atual.quantidade += 1;
      atual.valor += valorDoNegocio(n.value);
      continue;
    }
    grupos.set(chave, {
      chave,
      pipelineId: n.pipeline_id,
      stageId: n.stage_id,
      funilNome: n.pipeline?.name ?? null,
      etapaNome: n.stage?.name ?? null,
      posicao: n.stage?.position ?? Number.MAX_SAFE_INTEGER,
      quantidade: 1,
      valor: valorDoNegocio(n.value),
    });
  }
  return [...grupos.values()].sort(
    (a, b) =>
      a.posicao - b.posicao ||
      (a.funilNome ?? '').localeCompare(b.funilNome ?? '') ||
      (a.etapaNome ?? '').localeCompare(b.etapaNome ?? '')
  );
}
