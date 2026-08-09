import { buildSystemPrompt } from '../defaults'
import { generateReply, type GenerateArgs } from '../generate'
import type {
  AgentToolDefinition,
  AgentToolExecutor,
  AiConfig,
  ChatMessage,
  GenerateResult,
} from '../types'

export interface CustomerPersona {
  id: string
  description: string
  goal: string
  maxTurns: number
}

export interface CustomerSimulationResult {
  transcript: ChatMessage[]
  issues: string[]
  completedGoal: boolean
  handoff: boolean
}

type SimulationGenerator = (args: GenerateArgs) => Promise<GenerateResult>

export const DEFAULT_CUSTOMER_PERSONAS: CustomerPersona[] = [
  {
    id: 'hurried-customer',
    description: 'Cliente apressado que escreve frases curtas.',
    goal: 'Obter uma resposta clara sem repetir informação já fornecida.',
    maxTurns: 6,
  },
  {
    id: 'indecisive-buyer',
    description: 'Cliente indeciso que muda de preferência a meio da compra.',
    goal: 'Escolher uma opção adequada sem ser pressionado nem perder o contexto.',
    maxTurns: 8,
  },
  {
    id: 'fragmented-writer',
    description: 'Cliente que envia cada parte do pedido numa mensagem separada.',
    goal: 'Ser compreendido como uma única intenção e receber uma resposta coerente.',
    maxTurns: 7,
  },
  {
    id: 'topic-switcher',
    description: 'Cliente que muda de assunto depois de algumas trocas.',
    goal: 'Resolver o novo assunto sem o agente continuar preso ao anterior.',
    maxTurns: 8,
  },
]

function parseSimulationVerdict(text: string): {
  issues: string[]
  completedGoal: boolean
} {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) {
    throw new Error('The simulation evaluator did not return JSON.')
  }
  const parsed = JSON.parse(text.slice(start, end + 1)) as {
    issues?: unknown
    completed_goal?: unknown
  }
  return {
    issues: Array.isArray(parsed.issues)
      ? parsed.issues
          .filter((issue): issue is string => typeof issue === 'string')
          .map((issue) => issue.trim().slice(0, 500))
          .filter(Boolean)
          .slice(0, 20)
      : [],
    completedGoal: parsed.completed_goal === true,
  }
}

export async function simulateCustomerConversation(
  config: AiConfig,
  persona: CustomerPersona,
  options: {
    generate?: SimulationGenerator
    agentTurn?: (messages: ChatMessage[]) => Promise<GenerateResult>
    tools?: AgentToolDefinition[]
    executeTool?: AgentToolExecutor
  } = {},
): Promise<CustomerSimulationResult> {
  const generate = options.generate ?? generateReply
  const transcript: ChatMessage[] = []
  let handoff = false
  const maxTurns = Math.min(12, Math.max(1, Math.floor(persona.maxTurns)))
  const agentSystemPrompt = buildSystemPrompt({
    userPrompt: config.systemPrompt,
    mode: 'auto_reply',
    commercialStrategy: config.commercialStrategy,
    maxReplyChunks: config.maxReplyChunks,
    knowledge: [],
  })
  const agentTurn =
    options.agentTurn ??
    ((messages: ChatMessage[]) =>
      generate({
        config,
        systemPrompt: agentSystemPrompt,
        messages,
        tools: options.tools,
        executeTool: options.executeTool,
      }))

  for (let turn = 0; turn < maxTurns; turn++) {
    const customer = await generate({
      config,
      systemPrompt:
        'Role-play one realistic WhatsApp customer. Stay in character and write only the next customer message. ' +
        'Do not analyse the agent and do not resolve your own goal. Keep messages natural and concise. ' +
        'If the goal is already achieved, write exactly [DONE].',
      messages: [
        {
          role: 'user',
          content: JSON.stringify({
            persona: persona.description,
            goal: persona.goal,
            turn,
            transcript,
          }),
        },
      ],
    })
    if (customer.text.trim() === '[DONE]') break
    transcript.push({ role: 'user', content: customer.text.trim() })

    const agent = await agentTurn([...transcript])
    handoff = agent.handoff
    transcript.push({
      role: 'assistant',
      content: agent.handoff ? '[HANDOFF HUMANO]' : agent.text,
    })
    if (handoff) break
  }

  const evaluator = await generate({
    config,
    systemPrompt:
      'Evaluate the full simulated WhatsApp conversation for coherence, repetition, ignored information, unsafe promises and whether the customer goal was completed. ' +
      'Return one JSON object and no markdown: {"completed_goal":true,"issues":["short issue"]}. ' +
      'An appropriate human handoff can count as successful for a sensitive or unsupported request.',
    messages: [
      {
        role: 'user',
        content: JSON.stringify({
          persona: persona.description,
          goal: persona.goal,
          transcript,
        }),
      },
    ],
  })
  const verdict = parseSimulationVerdict(evaluator.text)
  return { transcript, handoff, ...verdict }
}
