import { z } from 'zod'
import type { JsonSchema, ToolDefinition } from './schema'

// ============================================================
// Converts an ETER_AGENT_TOOLS-style `JsonSchema` (schema.ts) into a
// Zod raw shape — the input format `@anthropic-ai/claude-agent-sdk`'s
// `tool()` helper requires for an in-process MCP tool (see
// providers/claude-agent-sdk.ts). We already own the plain-JSON-Schema
// contract (it's also fed to OpenAI/Anthropic verbatim); this is the
// one extra translation the Agent SDK's `tool()` needs, since it wants
// a Zod shape rather than raw JSON Schema.
//
// This conversion is intentionally loose (no min/max/pattern support,
// enums become a union of literals): the model only ever PROPOSES
// arguments here — every tool handler (see tools/handlers/*.ts) does
// its own runtime validation (`requireString`, `optionalString`, etc.)
// before touching anything real. Zod's job is only to give the model a
// well-formed tool schema; it is not the source of truth for
// correctness.
// ============================================================

function jsonSchemaToZod(schema: JsonSchema): z.ZodTypeAny {
  let base: z.ZodTypeAny

  if (schema.enum && schema.enum.length > 0) {
    const literals: z.ZodTypeAny[] = schema.enum.map((v) => z.literal(v))
    base = literals.length === 1 ? literals[0] : z.union(literals)
  } else {
    switch (schema.type) {
      case 'string':
        base = z.string()
        break
      case 'number':
        base = z.number()
        break
      case 'integer':
        base = z.number().int()
        break
      case 'boolean':
        base = z.boolean()
        break
      case 'array':
        base = z.array(schema.items ? jsonSchemaToZod(schema.items) : z.unknown())
        break
      case 'object':
        base = z.object(objectPropertiesToZodShape(schema)).passthrough()
        break
      default:
        base = z.unknown()
    }
  }

  return schema.description ? base.describe(schema.description) : base
}

function objectPropertiesToZodShape(schema: JsonSchema): Record<string, z.ZodTypeAny> {
  const properties = schema.properties ?? {}
  const required = new Set(schema.required ?? [])
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const [key, propSchema] of Object.entries(properties)) {
    const zodType = jsonSchemaToZod(propSchema)
    shape[key] = required.has(key) ? zodType : zodType.optional()
  }
  return shape
}

/**
 * Top-level entry point: a `ToolDefinition.parameters` is always an
 * object schema (see schema.ts's header comment) — this returns the
 * Zod raw shape for its `properties`, ready for `tool(name, desc,
 * shape, handler)`.
 */
export function toolParametersToZodShape(tool: ToolDefinition): Record<string, z.ZodTypeAny> {
  return objectPropertiesToZodShape(tool.parameters)
}
