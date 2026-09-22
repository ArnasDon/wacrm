import type {
  AutomationRefStepConfig,
  AutomationStepType,
  CreateDealStepConfig,
  CreateTaskStepConfig,
  MoveDealStepConfig,
  RunFlowStepConfig,
  SendMediaStepConfig,
  SendMessageStepConfig,
  SendTemplateStepConfig,
  SendToNumberStepConfig,
  SetAiStepConfig,
  TagStepConfig,
  UpdateContactFieldStepConfig,
  WaitStepConfig,
} from '@/types'
import { digitosDoTelefone, formatarTelefone } from '@/lib/contacts/telefone'

/**
 * "O que esta automação FAZ", em uma linha — o texto em negrito do cartão da
 * grade do funil ("Adicionar tags: DESQUALIFICADO").
 *
 * ⚠️ Devolve CHAVE + valores, nunca texto pronto. O app roda em português e o
 * dicionário é a única fonte de tradução; frase montada aqui nasceria em
 * inglês ou duplicaria o `messages/`. Quem consome faz
 * `t(\`resumo.\${chave}\`, valores)`.
 *
 * ⚠️ **Todo `AutomationStepType` PRECISA de uma chave nos dois dicionários.**
 * O fallback do next-intl é por ARQUIVO, não por chave: faltando uma, a tela
 * mostra `Pipelines.automacoes.resumo.send_x` cru para o operador. Há teste
 * lendo `messages/pt-BR.json` e cobrando uma chave por tipo — é ele que
 * segura isso, não a boa vontade de quem adicionar o próximo passo.
 */

/** Nomes já carregados pela tela, para trocar id por rótulo legível. */
export interface NomesConhecidos {
  tags?: Record<string, string>
  etapas?: Record<string, string>
  fluxos?: Record<string, string>
  automacoes?: Record<string, string>
  canais?: Record<string, string>
}

export interface ResumoDoPasso {
  /** Sufixo da chave de tradução. Sempre igual ao `step_type`. */
  chave: AutomationStepType | string
  /** Valores para o ICU. `alvo` é o trecho que a tela destaca. */
  valores: Record<string, string | number>
  /**
   * O alvo era um id que não existe mais (tag apagada, robô excluído).
   *
   * ⚠️ A tela precisa disso: mostrar o UUID cru faria o operador achar que é
   * o nome, e mostrar vazio faria "Adicionar tags:" seguido de nada — que
   * parece defeito de renderização, não config quebrada.
   */
  alvoSumiu: boolean
}

interface PassoResumivel {
  step_type: AutomationStepType | string
  step_config?: unknown
}

export function descreverPasso(passo: PassoResumivel, nomes: NomesConhecidos = {}): ResumoDoPasso {
  const cfg = (passo.step_config ?? {}) as Record<string, unknown>
  const tipo = passo.step_type

  const porId = (mapa: Record<string, string> | undefined, id: unknown): ResumoDoPasso => {
    const chaveId = typeof id === 'string' ? id : ''
    const nome = chaveId ? mapa?.[chaveId] : undefined
    return {
      chave: tipo,
      valores: { alvo: nome ?? '' },
      alvoSumiu: !nome,
    }
  }

  const simples = (alvo: string | number = ''): ResumoDoPasso => ({
    chave: tipo,
    valores: { alvo },
    alvoSumiu: false,
  })

  switch (tipo) {
    case 'add_tag':
    case 'remove_tag':
      return porId(nomes.tags, (cfg as unknown as TagStepConfig).tag_id)

    case 'run_flow':
      return porId(nomes.fluxos, (cfg as unknown as RunFlowStepConfig).flow_id)

    case 'run_automation':
    case 'stop_automation':
      return porId(nomes.automacoes, (cfg as unknown as AutomationRefStepConfig).automation_id)

    case 'move_deal_stage':
      return porId(nomes.etapas, (cfg as unknown as MoveDealStepConfig).stage_id)

    case 'create_deal':
      return simples((cfg as unknown as CreateDealStepConfig).title ?? '')

    case 'set_deal_status': {
      // O status é um enum curto; o rótulo vem do dicionário, não daqui.
      const s = (cfg as unknown as MoveDealStepConfig).status
      return { chave: `set_deal_status_${s ?? 'open'}`, valores: {}, alvoSumiu: false }
    }

    case 'set_ai':
      // Ligar e desligar são ações OPOSTAS. Uma frase só com "alvo: ligado"
      // faria as duas ficarem parecidas no meio de um quadro cheio.
      return {
        chave: (cfg as unknown as SetAiStepConfig).enabled ? 'set_ai_on' : 'set_ai_off',
        valores: {},
        alvoSumiu: false,
      }

    case 'send_message':
      return simples(recortar((cfg as unknown as SendMessageStepConfig).text))

    case 'send_template':
      return simples((cfg as unknown as SendTemplateStepConfig).template_name ?? '')

    case 'send_media':
      // O tipo do arquivo é mais informativo que a URL, que é ilegível.
      return {
        chave: `send_media_${(cfg as unknown as SendMediaStepConfig).kind ?? 'image'}`,
        valores: {},
        alvoSumiu: false,
      }

    case 'update_contact_field':
      return simples((cfg as unknown as UpdateContactFieldStepConfig).field ?? '')

    case 'send_to_number':
      // O número, legível: é o que distingue dois avisos no mesmo quadro. A
      // mesma leitura do motor — "(83) 98000-0016" digitado sem DDI ganha o
      // 55 antes de ser formatado, senão sairia "+83980000016".
      return simples(formatarTelefone(digitosDoTelefone((cfg as unknown as SendToNumberStepConfig).phone)))

    case 'wait': {
      const w = cfg as unknown as WaitStepConfig
      // "Aguardar 30 h" e "Aguardar 30 h ou até o cliente responder" são
      // passos DIFERENTES para quem lê a grade ou a linha do tempo da
      // conversa: no segundo, a resposta do cliente encerra o que vem depois.
      // Chave própria (e não sufixo colado na tela) porque a frase muda de
      // forma entre os idiomas. `=== true`, como o motor.
      const sufixo = w.parar_se_responder === true ? '_ou_resposta' : ''
      return {
        chave: `wait_${w.unit ?? 'hours'}${sufixo}`,
        valores: { quantidade: Number(w.amount ?? 0) },
        alvoSumiu: false,
      }
    }

    case 'create_task':
      // O TÍTULO, não o responsável: é ele que distingue duas tarefas no mesmo
      // quadro ("Conferir documentação" × "Ligar para o cliente"). O nome de
      // quem recebe não cabe em `NomesConhecidos` — a tela da grade não
      // carrega membros — e um id cru ali seria lido como se fosse o nome.
      return simples(recortar((cfg as unknown as CreateTaskStepConfig).titulo))

    default:
      // send_buttons, send_list, assign_conversation, stop_flow, condition,
      // send_webhook, close_conversation — o tipo já diz o suficiente.
      return simples()
  }
}

/** Primeira linha do texto, curta. O cartão tem uma linha, não um parágrafo. */
function recortar(texto: unknown, limite = 40): string {
  const s = typeof texto === 'string' ? texto.trim().split('\n')[0] : ''
  return s.length > limite ? `${s.slice(0, limite - 1)}…` : s
}
