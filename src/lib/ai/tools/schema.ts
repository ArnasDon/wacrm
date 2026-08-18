import type { AiTool, ToolParameter } from './types'

// ============================================================
// Convert a tool's `parameters[]` into the JSON-Schema shape each
// provider's tool-calling API expects. Both providers describe
// arguments as a JSON Schema object; only the wrapper differs.
//
// `tool.description` is sent through verbatim as `name`/`function.name`'s
// sibling field — it is the ONLY signal the model gets about a tool, and
// it rides along on every single call whether or not the tool ends up
// used, so both correctness and prompt-token cost live in this one
// string. Neither the Anthropic nor the OpenAI tool-calling API has a
// separate "expected response shape" field — the model only sees
// whatever text comes back in the tool_result after it calls the tool —
// so if the response needs interpreting reliably, that has to be stated
// in `description` too. The convention the Tools tab's UI nudges authors
// toward: what it does, when to call it, what NOT to use it for (when a
// similar tool exists), and the response shape, e.g. "Checks live stock
// for a SKU. Call before promising availability. Not for order history —
// use get_order_status. Returns JSON: {in_stock: boolean, quantity:
// number}." Kept short deliberately — this is live prompt weight on
// every turn, not documentation.
// ============================================================

interface JsonSchemaProperty {
  type: string
  description?: string
  enum?: string[]
}

interface JsonSchemaObject {
  type: 'object'
  properties: Record<string, JsonSchemaProperty>
  required: string[]
}

function paramsToJsonSchema(parameters: ToolParameter[]): JsonSchemaObject {
  const properties: Record<string, JsonSchemaProperty> = {}
  const required: string[] = []
  for (const p of parameters) {
    properties[p.name] = {
      type: p.type,
      ...(p.description ? { description: p.description } : {}),
      ...(p.enum && p.enum.length > 0 ? { enum: p.enum } : {}),
    }
    if (p.required) required.push(p.name)
  }
  return { type: 'object', properties, required }
}

/** Anthropic Messages API tool definition. */
export interface AnthropicToolDef {
  name: string
  description: string
  input_schema: JsonSchemaObject
}

export function toAnthropicTool(tool: AiTool): AnthropicToolDef {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: paramsToJsonSchema(tool.parameters),
  }
}

/** OpenAI Chat Completions function-calling tool definition. */
export interface OpenAiToolDef {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: JsonSchemaObject
  }
}

export function toOpenAiTool(tool: AiTool): OpenAiToolDef {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: paramsToJsonSchema(tool.parameters),
    },
  }
}
