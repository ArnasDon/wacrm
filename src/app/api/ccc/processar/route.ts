import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { toErrorResponse } from '@/lib/auth/errors'
import { requirePlatformAdmin } from '@/lib/auth/platform-admin'
import { gerarDiagnosticoComando } from '@/lib/ai/ccc-diagnostico'
import { criarFunilPadrao } from '@/lib/ccc/setup-funil'
import { escolherModelo, type EscolhaModelo } from '@/lib/pipelines/escolher-modelo'

// ============================================================
// POST /api/ccc/processar — a AMARRAÇÃO 2→3.
//
// Num passo: um agente 3R gera o diagnóstico + playbook + scripts + régua
// (a partir das respostas do formulário + a transcrição do kickoff) e, se
// pedido, já monta o funil na conta do cliente. Escreve via service role.
//
// Body: { diagnostico_id, transcricao?, montar_funil?, account_id?, nome_pipeline? }
//   - montar_funil=true + account_id → também cria o pipeline (passo 3).
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _admin: any = null
function admin() {
  if (!_admin) {
    _admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _admin
}

export async function POST(req: Request) {
  // Só o consultor (platform admin) usa o console da CCC. A rota roda com
  // service role (lê e grava em qualquer conta), então estar logado não basta.
  try {
    await requirePlatformAdmin()
  } catch (err) {
    return toErrorResponse(err)
  }

  try {
    const body = await req.json().catch(() => null)
    const diagnosticoId =
      body && typeof body.diagnostico_id === 'string' ? body.diagnostico_id : ''
    const transcricao =
      body && typeof body.transcricao === 'string' ? body.transcricao : undefined
    const montarFunil = body?.montar_funil === true
    const accountIdBody =
      body && typeof body.account_id === 'string' && body.account_id
        ? body.account_id
        : null
    const nomePipeline =
      body && typeof body.nome_pipeline === 'string' ? body.nome_pipeline : undefined

    if (!diagnosticoId) {
      return NextResponse.json(
        { error: 'diagnostico_id é obrigatório.' },
        { status: 400 },
      )
    }

    // 1. Lê o diagnóstico.
    const { data: diag, error: erroLeitura } = await admin()
      .from('ccc_diagnosticos')
      .select('id, account_id, respostas')
      .eq('id', diagnosticoId)
      .single()

    if (erroLeitura || !diag) {
      return NextResponse.json(
        { error: 'Diagnóstico não encontrado.' },
        { status: 404 },
      )
    }

    // 2. Agente 3R gera + persiste os entregáveis.
    const gerado = await gerarDiagnosticoComando({
      respostas: (diag.respostas ?? {}) as Record<string, unknown>,
      transcricao,
    })

    const { data: entregavel, error: erroSalvar } = await admin()
      .from('ccc_entregaveis')
      .insert({
        diagnostico_id: diag.id,
        account_id: diag.account_id,
        entregaveis: gerado.entregaveis,
        conteudo_md: gerado.conteudoMd,
        prompt_versao: gerado.promptVersao,
        uso: gerado.uso,
      })
      .select('id')
      .single()

    if (erroSalvar) {
      return NextResponse.json({ error: erroSalvar.message }, { status: 500 })
    }

    await admin()
      .from('ccc_diagnosticos')
      .update({ status: 'processado' })
      .eq('id', diag.id)

    // 3. (opcional) Monta o funil na conta.
    const accountId = accountIdBody ?? diag.account_id
    // O agente 3R escolhe o modelo da biblioteca pelo diagnóstico; sem
    // consulta possível, cai no Funil geral 3R (nunca nas 6 etapas genéricas).
    let funil = null
    let escolha: EscolhaModelo | null = null
    if (montarFunil) {
      if (!accountId) {
        funil = { ok: false, error: 'montar_funil pediu, mas não há account_id.' }
      } else {
        escolha = await escolherModelo({
          respostas: (diag.respostas ?? {}) as Record<string, unknown>,
          transcricao,
        })
        funil = await criarFunilPadrao({
          supabase: admin(),
          accountId,
          nomePipeline,
          modeloId: escolha.modeloId,
        })
      }
    }

    return NextResponse.json({
      ok: true,
      entregavel_id: entregavel.id,
      entregaveis: gerado.entregaveis,
      conteudo_md: gerado.conteudoMd,
      funil,
      escolha_modelo: escolha,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erro ao processar.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
