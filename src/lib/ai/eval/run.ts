import { buildSystemPrompt } from '../defaults'
import { generateReply, type GenerateArgs } from '../generate'
import type { AiConfig, GenerateResult } from '../types'
import type { GoldenCase } from './golden-set'

export interface CriterionResult {
  criterion: string
  score: number
  reason: string
}

export interface EvalCaseResult {
  id: string
  description: string
  response: string
  handoff: boolean
  criteria: CriterionResult[]
  score: number
}

export interface EvalSuiteResult {
  cases: EvalCaseResult[]
  score: number
  baselineScore: number | null
  regression: number | null
  passed: boolean
}

type EvalGenerator = (args: GenerateArgs) => Promise<GenerateResult>

interface JudgePayload {
  scores: Array<{
    criterion_index: number
    score: number
    reason: string
  }>
}

function clampScore(value: number): number {
  return Math.min(1, Math.max(0, value))
}

export function parseJudgeResult(text: string, criteria: string[]): CriterionResult[] {
  const objectStart = text.indexOf('{')
  const objectEnd = text.lastIndexOf('}')
  if (objectStart < 0 || objectEnd <= objectStart) {
    throw new Error('The evaluation judge did not return a JSON object.')
  }
  const parsed = JSON.parse(text.slice(objectStart, objectEnd + 1)) as JudgePayload
  if (!Array.isArray(parsed.scores)) {
    throw new Error('The evaluation judge returned no scores array.')
  }

  return criteria.map((criterion, index) => {
    const item = parsed.scores.find((score) => score.criterion_index === index)
    if (!item || !Number.isFinite(item.score)) {
      throw new Error(`The evaluation judge omitted criterion ${index}.`)
    }
    return {
      criterion,
      score: clampScore(item.score),
      reason:
        typeof item.reason === 'string' && item.reason.trim()
          ? item.reason.trim().slice(0, 500)
          : 'Sem justificação.',
    }
  })
}

async function evaluateCase(args: {
  config: AiConfig
  goldenCase: GoldenCase
  generate: EvalGenerator
}): Promise<EvalCaseResult> {
  const systemPrompt = buildSystemPrompt({
    userPrompt: args.config.systemPrompt,
    mode: 'auto_reply',
    commercialStrategy: args.config.commercialStrategy,
    maxReplyChunks: args.config.maxReplyChunks,
    knowledge: [],
  })
  const candidate = await args.generate({
    config: args.config,
    systemPrompt,
    messages: args.goldenCase.conversation,
  })
  const visibleResponse = candidate.handoff
    ? '[DECISÃO: HANDOFF HUMANO]'
    : candidate.text

  const judge = await args.generate({
    config: args.config,
    systemPrompt:
      'You are a strict customer-support response evaluator. Assess only the supplied criteria. ' +
      'Return one JSON object and no markdown: {"scores":[{"criterion_index":0,"score":0.0,"reason":"short factual reason"}]}. ' +
      'Use scores from 0 to 1. A handoff decision is represented explicitly and is valid when the criterion requires human intervention.',
    messages: [
      {
        role: 'user',
        content: JSON.stringify({
          case_description: args.goldenCase.description,
          conversation: args.goldenCase.conversation,
          candidate_response: visibleResponse,
          criteria: args.goldenCase.criteria,
        }),
      },
    ],
  })
  const criteria = parseJudgeResult(judge.text, args.goldenCase.criteria)
  const score =
    criteria.reduce((total, item) => total + item.score, 0) /
    Math.max(1, criteria.length)

  return {
    id: args.goldenCase.id,
    description: args.goldenCase.description,
    response: candidate.text,
    handoff: candidate.handoff,
    criteria,
    score,
  }
}

export async function runEvalSuite(
  config: AiConfig,
  cases: GoldenCase[],
  options: {
    generate?: EvalGenerator
    baselineScore?: number | null
    minimumScore?: number
    allowedRegression?: number
  } = {},
): Promise<EvalSuiteResult> {
  if (cases.length === 0) throw new Error('The evaluation suite has no cases.')
  const generate = options.generate ?? generateReply
  const results: EvalCaseResult[] = []
  for (const goldenCase of cases) {
    results.push(await evaluateCase({ config, goldenCase, generate }))
  }

  const score =
    results.reduce((total, result) => total + result.score, 0) / results.length
  const baselineScore = Number.isFinite(options.baselineScore)
    ? clampScore(options.baselineScore as number)
    : null
  const regression = baselineScore === null ? null : score - baselineScore
  const minimumScore = options.minimumScore ?? 0.75
  const allowedRegression = Math.max(0, options.allowedRegression ?? 0.02)
  const passed =
    score >= minimumScore &&
    (regression === null || regression >= -allowedRegression)

  return { cases: results, score, baselineScore, regression, passed }
}
