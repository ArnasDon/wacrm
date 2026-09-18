import type { AutomationTriggerType } from '@/types'
import { validateInteractivePayload } from '@/lib/whatsapp/interactive'
import { digitosDoTelefone } from '@/lib/contacts/telefone'
import { MAX_DESCRICAO, MAX_TITULO, normalizarHora } from '@/lib/tasks/validar'
import { motivoDeConfigInvalida } from './lembretes'
import { ehGatilhoDaRegua, horaDeEnvioValida } from '@/lib/asaas/regua'
import { ehMeta } from '@/lib/cb-channels/transporte'
import type { CbChannelKind } from '@/lib/cb-channels/repo'

// ------------------------------------------------------------
// Pre-flight config validation for automations about to be activated.
//
// Activating a broken automation (e.g. an add_tag step with tag_id="")
// used to succeed silently — every trigger then produced a failed log
// row with a cryptic "add_tag needs contact + tag_id" message, and
// users often didn't notice until reviewing logs. This module lets
// the API refuse activation with a useful 400 response instead.
//
// The rules here mirror the runtime checks in engine.ts's runStep;
// they're the same invariants, enforced one step earlier so failures
// surface at save time.
// ------------------------------------------------------------

export interface ValidationIssue {
  /** Dot-path for the UI to highlight; stable enough to build a table. */
  path: string
  message: string
}

interface StepLike {
  step_type: string
  step_config: Record<string, unknown>
  branches?: { yes?: StepLike[]; no?: StepLike[] }
}

export function validateStepsForActivation(steps: StepLike[]): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (!Array.isArray(steps) || steps.length === 0) {
    issues.push({
      path: 'steps',
      message: 'active automations need at least one step',
    })
    return issues
  }
  walk(steps, '', issues)
  return issues
}

function walk(steps: StepLike[], prefix: string, issues: ValidationIssue[]): void {
  steps.forEach((s, i) => {
    const path = `${prefix}steps[${i}]`
    validateOne(s, path, issues)
    if (s.step_type === 'condition' && s.branches) {
      if (s.branches.yes) walk(s.branches.yes, `${path}.yes.`, issues)
      if (s.branches.no) walk(s.branches.no, `${path}.no.`, issues)
    }
  })
}

function validateOne(step: StepLike, path: string, issues: ValidationIssue[]): void {
  const c = step.step_config ?? {}
  switch (step.step_type) {
    case 'move_deal_stage':
      // A etapa é obrigatória: sem ela o passo não sabe para onde mover, e o
      // motor estouraria em execução — o tipo de falha que esta validação
      // existe para antecipar.
      if (!nonEmpty(c.stage_id)) {
        issues.push({ path: `${path}.stage_id`, message: 'stage is required' })
      }
      break
    case 'set_deal_status':
      if (c.status !== 'won' && c.status !== 'lost' && c.status !== 'open') {
        issues.push({
          path: `${path}.status`,
          message: 'status must be "won", "lost" or "open"',
        })
      }
      break
    // Orquestração (936). Os três exigem o alvo pelo mesmo motivo do
    // `move_deal_stage`: sem ele o passo não sabe o que acionar/parar, e a
    // falha só apareceria em execução, no log, longe de quem montou.
    //
    // ⚠️ NÃO se valida aqui se o alvo existe, é da conta ou está ativo. Isso
    // é estado do banco no momento do DISPARO, não do save: a automação alvo
    // pode ser desativada depois, e uma validação que passou ontem afirmaria
    // hoje uma coisa falsa. O motor confere na hora, e a tela avisa enquanto
    // se edita.
    case 'run_automation':
    case 'stop_automation':
      if (!nonEmpty(c.automation_id)) {
        issues.push({ path: `${path}.automation_id`, message: 'automation is required' })
      }
      break
    case 'run_flow':
      if (!nonEmpty(c.flow_id)) {
        issues.push({ path: `${path}.flow_id`, message: 'flow is required' })
      }
      break
    case 'stop_flow':
      // Sem config: para o robô que estiver rodando com o contato, qualquer
      // que seja. Só existe uma run ativa por contato, então não há o que
      // escolher.
      break
    case 'set_ai':
      // `enabled` é booleano e a tela sempre manda um dos dois. Um valor
      // ausente ou de outro tipo viraria "desligar" em silêncio (o motor lê
      // `!cfg.enabled`), que é o oposto do padrão do passo recém-criado.
      if (typeof c.enabled !== 'boolean') {
        issues.push({ path: `${path}.enabled`, message: 'enabled must be true or false' })
      }
      break
    case 'send_media': {
      if (!nonEmpty(c.url)) {
        issues.push({ path: `${path}.url`, message: 'a file is required' })
      }
      const tipos = ['image', 'video', 'document', 'audio']
      if (typeof c.kind !== 'string' || !tipos.includes(c.kind)) {
        issues.push({ path: `${path}.kind`, message: 'kind must be image, video, document or audio' })
      }
      // ⚠️ ÁUDIO COM LEGENDA É RECUSADO, e não é preciosismo. A nota de voz sai
      // por `sendWhatsAppAudio`, que não tem campo de legenda: o texto seria
      // gravado na mensagem, apareceria no fio para a EQUIPE e não chegaria ao
      // cliente. Barrar aqui é a diferença entre o operador descobrir agora,
      // montando a regra, e descobrir depois de o cliente dizer que não
      // recebeu.
      if (c.kind === 'audio' && nonEmpty(c.caption)) {
        issues.push({
          path: `${path}.caption`,
          message: 'audio has no caption — WhatsApp voice notes cannot carry text',
        })
      }
      // Teto do WhatsApp. A assinatura automática ainda entra por cima no
      // envio, então o núcleo revalida — isto só evita o erro óbvio.
      if (typeof c.caption === 'string' && c.caption.length > 1024) {
        issues.push({ path: `${path}.caption`, message: 'caption is longer than 1024 characters' })
      }
      break
    }
    case 'send_message':
      if (!nonEmpty(c.text)) {
        issues.push({ path: `${path}.text`, message: 'message text is required' })
      }
      break
    case 'send_buttons':
    case 'send_list': {
      // The whole step_config IS the interactive payload; validate it
      // against Meta's limits (same check the engine runs before send).
      const result = validateInteractivePayload(c)
      if (!result.ok) {
        issues.push({ path: `${path}.interactive`, message: result.error })
      }
      break
    }
    case 'send_template':
      if (!nonEmpty(c.template_name)) {
        issues.push({ path: `${path}.template_name`, message: 'template name is required' })
      }
      break
    case 'add_tag':
    case 'remove_tag':
      if (!nonEmpty(c.tag_id)) {
        issues.push({ path: `${path}.tag_id`, message: 'tag is required' })
      }
      break
    case 'assign_conversation':
      if (c.mode === 'specific' && !nonEmpty(c.agent_id)) {
        issues.push({
          path: `${path}.agent_id`,
          message: 'agent is required when mode is "specific"',
        })
      }
      break
    case 'update_contact_field':
      if (!nonEmpty(c.field)) {
        issues.push({ path: `${path}.field`, message: 'field name is required' })
      }
      if (c.value === undefined || c.value === null || c.value === '') {
        issues.push({ path: `${path}.value`, message: 'field value is required' })
      }
      break
    case 'create_deal':
      if (!nonEmpty(c.pipeline_id)) {
        issues.push({ path: `${path}.pipeline_id`, message: 'pipeline is required' })
      }
      if (!nonEmpty(c.stage_id)) {
        issues.push({ path: `${path}.stage_id`, message: 'stage is required' })
      }
      if (!nonEmpty(c.title)) {
        issues.push({ path: `${path}.title`, message: 'title is required' })
      }
      break
    case 'wait':
      if (typeof c.amount !== 'number' || !Number.isFinite(c.amount) || c.amount <= 0) {
        issues.push({ path: `${path}.amount`, message: 'wait amount must be greater than 0' })
      }
      if (!['seconds', 'minutes', 'hours', 'days'].includes(String(c.unit))) {
        issues.push({
          path: `${path}.unit`,
          message: 'wait unit must be seconds, minutes, hours, or days',
        })
      }
      // ⚠️ Só booleano. O motor liga a opção apenas com `true` estrito, então
      // um `"true"` gravado aqui seria uma caixa que a tela mostra marcada
      // (truthy) e o motor ignora — a sequência seguiria depois da resposta
      // do cliente com o operador achando que ela para.
      if (c.parar_se_responder !== undefined && typeof c.parar_se_responder !== 'boolean') {
        issues.push({
          path: `${path}.parar_se_responder`,
          message: 'wait parar_se_responder must be true or false',
        })
      }
      break
    case 'condition':
      if (!nonEmpty(c.subject)) {
        issues.push({ path: `${path}.subject`, message: 'condition subject is required' })
      }
      if (!nonEmpty(c.operand)) {
        issues.push({ path: `${path}.operand`, message: 'condition operand is required' })
      }
      break
    case 'send_webhook':
      if (!nonEmpty(c.url)) {
        issues.push({ path: `${path}.url`, message: 'webhook URL is required' })
        break
      }
      try {
        const u = new URL(String(c.url))
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
          issues.push({
            path: `${path}.url`,
            message: 'webhook URL must use http or https',
          })
        }
      } catch {
        issues.push({ path: `${path}.url`, message: 'webhook URL is not a valid URL' })
      }
      break
    case 'close_conversation':
      // No config required.
      break
    case 'send_to_number': {
      // Telefone com DDI (o mesmo `isValidE164` das outras portas de
      // telefone): sem ele o passo não tem destinatário, e o motor
      // estouraria em execução — o tipo de falha que esta validação existe
      // para pegar antes de ativar.
      if (!digitosDoTelefone(typeof c.phone === 'string' ? c.phone : '')) {
        issues.push({ path: `${path}.phone`, message: 'phone must be a valid number with country code' })
      }
      if (!nonEmpty(c.text)) {
        issues.push({ path: `${path}.text`, message: 'message text is required' })
      }
      break
    }
    case 'create_task': {
      if (!nonEmpty(c.titulo)) {
        issues.push({ path: `${path}.titulo`, message: 'task title is required' })
      } else if (String(c.titulo).trim().length > MAX_TITULO) {
        issues.push({ path: `${path}.titulo`, message: `task title must be at most ${MAX_TITULO} chars` })
      }
      // ⚠️ Sem responsável a tarefa não tem para quem ir, e o motor estouraria
      // em execução — o tipo de falha que esta validação existe para pegar
      // antes de a automação ser ativada. Se ela é MEMBRO da conta é o motor
      // que confere: a lista de membros muda depois de a regra ser gravada.
      if (!nonEmpty(c.responsavel_user_id)) {
        issues.push({ path: `${path}.responsavel_user_id`, message: 'task assignee is required' })
      }
      // Mesmo teto do motor e da rota de tarefas. Sem isto a automação ativa
      // com uma descrição longa demais e falha em TODA execução — o passo
      // estoura em `normalizarDescricao` e a tarefa nunca é criada, que é
      // exatamente o que esta validação existe para pegar antes (Codex, #152).
      if (typeof c.descricao === 'string' && c.descricao.trim().length > MAX_DESCRICAO) {
        issues.push({
          path: `${path}.descricao`,
          message: `task description must be at most ${MAX_DESCRICAO} chars`,
        })
      }
      if (c.prazo_em_dias !== undefined && c.prazo_em_dias !== null) {
        const dias = Number(c.prazo_em_dias)
        if (!Number.isFinite(dias) || dias < 0 || dias > 365) {
          issues.push({ path: `${path}.prazo_em_dias`, message: 'due date must be 0–365 days from today' })
        }
      }
      if (nonEmpty(c.hora) && normalizarHora(c.hora) === undefined) {
        issues.push({ path: `${path}.hora`, message: 'time must be HH:MM' })
      }
      break
    }
    default:
      issues.push({ path, message: `unknown step type: ${step.step_type}` })
  }
}

export function validateTriggerForActivation(
  triggerType: AutomationTriggerType | string,
  triggerConfig: unknown,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const cfg = (triggerConfig ?? {}) as Record<string, unknown>

  if (triggerType === 'keyword_match') {
    const k = cfg.keywords
    if (!Array.isArray(k) || k.length === 0) {
      issues.push({ path: 'trigger.keywords', message: 'at least one keyword is required' })
    } else if (k.some((v) => typeof v !== 'string' || v.trim() === '')) {
      issues.push({ path: 'trigger.keywords', message: 'keywords cannot be empty strings' })
    }
    // A missing match_type defaults to "contains" at runtime (see
    // automations/engine.ts and flows/engine.ts, which both read
    // `match_type ?? "contains"`), so only an explicit, unrecognised
    // value is invalid here. This keeps activation validation in step
    // with the engine and with the builder's "Contains" default — an
    // automation that shows the default in the UI must not be rejected.
    if (
      cfg.match_type != null &&
      cfg.match_type !== 'exact' &&
      cfg.match_type !== 'contains' &&
      cfg.match_type !== 'word'
    ) {
      issues.push({
        path: 'trigger.match_type',
        message: 'match type must be "exact", "contains" or "word"',
      })
    }
  } else if (triggerType === 'time_based') {
    if (!nonEmpty(cfg.schedule)) {
      issues.push({ path: 'trigger.schedule', message: 'schedule is required' })
    }
  } else if (triggerType === 'tag_added') {
    if (!nonEmpty(cfg.tag_id)) {
      issues.push({ path: 'trigger.tag_id', message: 'tag is required' })
    }
  } else if (triggerType === 'interactive_reply') {
    const ids = cfg.reply_ids
    if (!Array.isArray(ids) || ids.length === 0) {
      issues.push({
        path: 'trigger.reply_ids',
        message: 'at least one reply id is required',
      })
    } else if (ids.some((v) => typeof v !== 'string' || v.trim() === '')) {
      issues.push({
        path: 'trigger.reply_ids',
        message: 'reply ids cannot be empty strings',
      })
    }
  } else if (triggerType === 'deal_stage_changed') {
    // ⚠️ NÃO exige etapa: vazio significa "qualquer etapa", que é uma regra
    // legítima ("toda vez que um card se mexer, avise o responsável") e a
    // convenção do projeto para escopo vazio. Só o lixo é recusado — string
    // vazia é o que um seletor mal resetado grava, e ela nunca casaria com
    // etapa nenhuma, deixando a automação ativa e muda.
    const ids = cfg.stage_ids
    if (ids != null && !Array.isArray(ids)) {
      issues.push({ path: 'trigger.stage_ids', message: 'stage_ids must be a list' })
    } else if (
      Array.isArray(ids) &&
      ids.some((v) => typeof v !== 'string' || v.trim() === '')
    ) {
      issues.push({
        path: 'trigger.stage_ids',
        message: 'stage ids cannot be empty strings',
      })
    }
  } else if (triggerType === 'date_field_offset') {
    // ⚠️ Aqui a config é OBRIGATÓRIA, ao contrário dos gatilhos de funil.
    // Lá, vazio quer dizer "qualquer etapa" — uma regra legítima. Aqui, sem
    // campo de data não existe nem alvo nem instante: a automação ficaria
    // ativa e muda para sempre.
    const motivo = motivoDeConfigInvalida(cfg as never)
    if (motivo) {
      issues.push({ path: 'trigger.custom_field_id', message: motivo })
    }
  } else if (triggerType === 'calendly_booking') {
    // Vazio = qualquer evento (convenção do projeto). Só o lixo é recusado:
    // `event_type_uri` que não seja texto nunca casaria com evento nenhum e
    // deixaria a automação ativa e muda.
    const uri = cfg.event_type_uri
    if (uri != null && typeof uri !== 'string') {
      issues.push({ path: 'trigger.event_type_uri', message: 'event type must be a string' })
    }
  } else if (triggerType === 'webhook_received') {
    // Vazio = qualquer webhook de entrada da conta (convenção do projeto).
    // Só o lixo é recusado: um `webhook_id` que não seja texto nunca casaria
    // com acionamento nenhum e deixaria a automação ativa e muda.
    const id = cfg.webhook_id
    if (id != null && typeof id !== 'string') {
      issues.push({ path: 'trigger.webhook_id', message: 'webhook must be a string' })
    }
  } else if (ehGatilhoDaRegua(triggerType)) {
    // A régua do Asaas (998). O marco é OBRIGATÓRIO na cobrança: sem ele a
    // automação ficaria ativa e muda. A hora fica na faixa que a varredura
    // aceita (08:00–17:00; a mensagem sai até as 18:00), e o sinalizador de
    // dia útil tem de ser booleano — `"false"` é truthy.
    if (triggerType === 'asaas_cobranca_vencida') {
      const dias = Number(cfg.dias_de_atraso)
      if (!Number.isInteger(dias) || dias < 1 || dias > 365) {
        issues.push({ path: 'trigger.dias_de_atraso', message: 'days overdue must be a whole number from 1 to 365' })
      }
    }
    if (cfg.hora_envio != null && cfg.hora_envio !== '' && !horaDeEnvioValida(cfg.hora_envio)) {
      issues.push({ path: 'trigger.hora_envio', message: 'send time must be HH:MM between 08:00 and 17:00' })
    }
    if (cfg.somente_dias_uteis != null && typeof cfg.somente_dias_uteis !== 'boolean') {
      issues.push({ path: 'trigger.somente_dias_uteis', message: 'business days only must be true or false' })
    }
  } else if (triggerType === 'deal_status_changed') {
    const st = cfg.statuses
    if (st != null && !Array.isArray(st)) {
      issues.push({ path: 'trigger.statuses', message: 'statuses must be a list' })
    } else if (
      Array.isArray(st) &&
      st.some((v) => v !== 'won' && v !== 'lost' && v !== 'open')
    ) {
      issues.push({
        path: 'trigger.statuses',
        message: 'status must be "won", "lost" or "open"',
      })
    }
  }

  return issues
}

function nonEmpty(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0
}

/**
 * As regras a MAIS dos passos das automações da régua do Asaas (998), além
 * de `validateStepsForActivation`:
 *
 * - NENHUM "Aguardar", em nenhum escopo: a espera retoma às cegas (só confere
 *   se a automação continua ligada) e sairia sem reconfirmar o pagamento —
 *   `[mensagem][aguardar 4 dias][mensagem]` mandaria a de 5 dias a quem
 *   pagou no dia 2. Cada marco é uma automação própria (§2.4 do plano).
 * - NENHUM "Acionar automação"/"Iniciar robô", em nenhum escopo: a entrega
 *   por eles não conta como envio na trava, e a filha pode esperar.
 * - NENHUM modelo, botões ou lista, em nenhum escopo: só saem pela Meta, e a
 *   régua sai por conexão de QR Code (a varredura exige isso).
 * - TODO `send_message` com a conexão escolhida (`channel_id`, D19): a
 *   varredura confere que ela resolve e está viva ANTES de travar, e o
 *   motor falha fechado se não resolver — sem conexão escolhida a
 *   automação não liga, porque o padrão da conta em silêncio seria o link
 *   de pagamento saindo por outro número.
 */
export function validateAsaasReguaForActivation(
  triggerType: AutomationTriggerType | string,
  steps: StepLike[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (!ehGatilhoDaRegua(triggerType)) return issues
  // ⚠️ UMA conexão para TODOS os envios da automação (D19): a varredura
  // resolve e confere a saúde da conexão do PRIMEIRO `send_message` e a
  // passa em `context.channel_id`; um segundo envio apontado para outra
  // conexão sairia por um número que ninguém conferiu (revisão adversarial
  // do PR #206). `send_media` entra na mesma regra — a mídia também sai
  // pelo canal do passo.
  let conexao: string | null = null
  // ⚠️ Pelo menos UM `send_message`: é dele que a varredura resolve a conexão
  // (`primeiroEnvio`). O `enviado` da trava vem de QUALQUER passo que entrega
  // ao contato (`PASSOS_QUE_FALAM_COM_O_CONTATO`, em asaas/regua.ts). Uma
  // automação só com `send_media` (ou sem envio) ativava e era pulada em
  // todo ciclo como "conexão inválida" (Codex, 3ª rodada do PR #206).
  let temMensagem = false
  const visitar = (lista: StepLike[], prefixo: string) => {
    lista.forEach((s, i) => {
      const path = `${prefixo}steps[${i}]`
      if (s.step_type === 'wait') {
        issues.push({ path: `${path}.step_type`, message: 'the Asaas collection sequence cannot wait — each milestone is its own automation' })
      }
      // ⚠️ Nem "Acionar automação" nem "Iniciar robô", em nenhum escopo: a
      // mensagem que sai pela FILHA fica no log dela, e o log da régua fecha
      // só com `run_automation: success` → a trava vira `barrada` e o cliente
      // cobrado fica fora do intervalo mínimo; pior, a filha comum pode ter um
      // "Aguardar" e retomar dias depois sem reconfirmar o pagamento, e a
      // cerca de conexão do motor olha o gatilho da FILHA — a proibição do
      // "Aguardar" e a D19 ficavam dribladas por um passo (revisão da 4ª
      // rodada do PR #206). Parar (`stop_*`) segue permitido: não entrega nada.
      if (s.step_type === 'run_automation' || s.step_type === 'run_flow') {
        issues.push({ path: `${path}.step_type`, message: 'the Asaas collection sequence cannot run another automation or bot — the message must be sent by this automation' })
      }
      // ⚠️ Nem modelo, nem botões, nem lista, em nenhum escopo: só saem pela
      // Meta, e a régua é só QR Code na v1 (o modelo aprovado é Fase 4). Fixado
      // num número oficial, o passo passava em `validateChannelScopeForActivation`
      // e saía por um número que a varredura não sondou (ela confere só o do
      // primeiro `send_message`) e que o motor não cerca (a trava que falha
      // fechado existe só no `send_message`) — o link de pagamento por outro
      // número, que a D19 proíbe. Sem conexão fixada, herdava o QR Code do
      // disparo, falhava sempre e gastava a trava do marco como `falhou`
      // (revisão da 4ª rodada do PR #206).
      if (s.step_type === 'send_template' || s.step_type === 'send_buttons' || s.step_type === 'send_list') {
        issues.push({ path: `${path}.step_type`, message: 'the Asaas collection sequence sends through a QR Code connection — templates, buttons and lists are only available on the official API' })
      }
      if (s.step_type === 'send_message') temMensagem = true
      if (s.step_type === 'send_message' || s.step_type === 'send_media') {
        const canal = s.step_config?.channel_id
        if (!nonEmpty(canal)) {
          issues.push({ path: `${path}.channel_id`, message: 'the Asaas collection message needs a connection chosen on the step' })
        } else if (conexao === null) {
          conexao = canal as string
        } else if (canal !== conexao) {
          issues.push({ path: `${path}.channel_id`, message: 'the Asaas collection sequence must send every message through the same connection' })
        }
      }
      if (s.step_type === 'condition' && s.branches) {
        if (s.branches.yes) visitar(s.branches.yes, `${path}.yes.`)
        if (s.branches.no) visitar(s.branches.no, `${path}.no.`)
      }
    })
  }
  visitar(steps, '')
  if (!temMensagem) {
    issues.push({ path: 'steps', message: 'the Asaas collection sequence needs a text message step (send_message)' })
  }
  return issues
}

// ------------------------------------------------------------
// Multi-canal: passos que só existem na API OFICIAL da Meta.
//
// `send_template`, `send_buttons` e `send_list` não têm equivalente na
// Evolution (Baileys). Antes, o operador montava um menu de botões, ativava
// sem nenhum aviso, e ele funcionava para METADE dos clientes — a tela de
// logs mostrava execuções `failed` alternando com `success`, sem nenhuma
// indicação de que a causa era o número por onde a pessoa escreveu.
//
// Agora a ativação recusa a combinação impossível na hora de salvar.
// ------------------------------------------------------------

/** Passos que exigem um canal Meta (API oficial). */
const META_ONLY_STEPS = new Set(['send_template', 'send_buttons', 'send_list']);

export interface ChannelForValidation {
  id: string;
  label: string;
  kind: CbChannelKind;
}

/**
 * Recusa a automação quando um passo exclusivo da API oficial não tem como
 * cair num canal Meta.
 *
 * São DUAS perguntas, e por muito tempo só a segunda era feita:
 *
 * 1. **O passo fixa um canal de saída?** (`step_config.channel_id`, que ganhou
 *    tela agora). Então é ELE quem manda, e o escopo do gatilho não importa —
 *    o passo vai sair por aquele número, ponto. Canal Evolution aqui é erro
 *    mesmo com escopo vazio: era o buraco que a tela nova abriria, porque a
 *    versão anterior desta função retornava cedo quando `channelIds` era
 *    vazio e nunca chegava a olhar dentro dos passos.
 * 2. **Senão, o passo HERDA** o canal do disparo, que fica dentro do escopo.
 *    Aí basta o escopo conter algum canal Meta para a combinação ser possível
 *    — e escopo vazio ("todos") sempre é possível.
 *
 * Canal desconhecido (apagado entre editar e salvar) nunca trava a ativação:
 * o trigger da 903 limpa `channel_ids`, e para o `step_config` o builder já
 * avisa na tela. Mesma escolha de `validateFlowChannelForActivation`.
 */
export function validateChannelScopeForActivation(
  steps: StepLike[],
  channelIds: string[] | null | undefined,
  contasCanais: ChannelForValidation[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const porId = new Map(contasCanais.map((c) => [c.id, c]));

  // Herança: o escopo consegue alcançar um canal Meta?
  const escopo =
    channelIds && channelIds.length > 0
      ? contasCanais.filter((c) => channelIds.includes(c.id))
      : [];
  // Escopo vazio, ou só com ids desconhecidos, = "todos os canais".
  const herancaPodeSerMeta = escopo.length === 0 || escopo.some((c) => ehMeta(c));
  const nomesDoEscopo = escopo.map((c) => c.label).join(', ');

  const visitar = (lista: StepLike[], prefixo: string) => {
    lista.forEach((s, i) => {
      const path = `${prefixo}steps[${i}]`;
      if (META_ONLY_STEPS.has(s.step_type)) {
        const fixado = s.step_config?.channel_id;
        const canalFixado = typeof fixado === 'string' && fixado ? porId.get(fixado) : undefined;

        if (canalFixado) {
          if (!ehMeta(canalFixado)) {
            issues.push({
              path: `${path}.channel_id`,
              message: `"${s.step_type}" só funciona em número oficial da Meta, e este passo está fixado para enviar por "${canalFixado.label}", que é um número não oficial (QR Code). Troque a conexão de saída deste passo ou use uma mensagem de texto.`,
            });
          }
        } else if (!herancaPodeSerMeta) {
          issues.push({
            path: `${path}.step_type`,
            message: `"${s.step_type}" só funciona em número oficial da Meta, e esta automação está restrita a ${nomesDoEscopo}. Inclua um canal oficial no escopo ou troque o passo por uma mensagem de texto.`,
          });
        }
      }
      if (s.step_type === 'condition' && s.branches) {
        if (s.branches.yes) visitar(s.branches.yes, `${path}.yes.`);
        if (s.branches.no) visitar(s.branches.no, `${path}.no.`);
      }
    });
  };
  visitar(steps, '');
  return issues;
}
