import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { toolParametersToZodShape } from './json-schema-to-zod'
import type { ToolDefinition } from './schema'

function tool(parameters: ToolDefinition['parameters']): ToolDefinition {
  return { name: 't', description: 'd', parameters }
}

describe('toolParametersToZodShape', () => {
  it('produces an empty shape for a tool with no properties', () => {
    const shape = toolParametersToZodShape(tool({ type: 'object', properties: {}, additionalProperties: false }))
    expect(Object.keys(shape)).toEqual([])
  })

  it('marks required fields as required and the rest optional', () => {
    const shape = toolParametersToZodShape(
      tool({
        type: 'object',
        properties: {
          starts_at: { type: 'string', format: 'date-time' },
          lead_name: { type: 'string' },
        },
        required: ['starts_at'],
        additionalProperties: false,
      }),
    )
    const schema = z.object(shape)
    expect(schema.safeParse({ starts_at: '2026-09-22T10:00:00+01:00' }).success).toBe(true)
    expect(schema.safeParse({}).success).toBe(false)
  })

  it('converts an integer enum into an accepted set of literals', () => {
    const shape = toolParametersToZodShape(
      tool({
        type: 'object',
        properties: {
          necessidade: { type: 'integer', enum: [0, 1, 2] },
        },
        required: ['necessidade'],
        additionalProperties: false,
      }),
    )
    const schema = z.object(shape)
    expect(schema.safeParse({ necessidade: 1 }).success).toBe(true)
    expect(schema.safeParse({ necessidade: 5 }).success).toBe(false)
  })

  it('converts an array-of-string field', () => {
    const shape = toolParametersToZodShape(
      tool({
        type: 'object',
        properties: { tags: { type: 'array', items: { type: 'string' } } },
        additionalProperties: false,
      }),
    )
    const schema = z.object(shape)
    expect(schema.safeParse({ tags: ['a', 'b'] }).success).toBe(true)
    expect(schema.safeParse({ tags: [1] }).success).toBe(false)
  })
})
