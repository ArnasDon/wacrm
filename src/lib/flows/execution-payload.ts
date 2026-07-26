export const MAX_FLOW_EXECUTION_FIELD_BYTES = 60 * 1024;
export const MAX_DEBUG_EXECUTION_FIELD_BYTES = 32 * 1024;
export const MAX_DEBUG_EXECUTION_RESPONSE_BYTES = 256 * 1024;

type SentinelShape = "object" | "array";

function encodedBytes(value: unknown): number | null {
  try {
    const encoded = JSON.stringify(value);
    return encoded === undefined
      ? null
      : new TextEncoder().encode(encoded).byteLength;
  } catch {
    return null;
  }
}

function truncationSentinel(
  originalBytes: number | null,
  shape: SentinelShape,
): unknown {
  const sentinel = {
    truncated: true,
    reason: "payload_exceeded_limit",
    ...(originalBytes === null ? {} : { original_bytes: originalBytes }),
  };
  return shape === "array" ? [sentinel] : sentinel;
}

function boundJson(
  value: unknown,
  maxBytes: number,
  shape: SentinelShape,
): unknown {
  const bytes = encodedBytes(value);
  if (bytes === null || bytes > maxBytes) {
    return truncationSentinel(bytes, shape);
  }
  return structuredClone(value);
}

export function boundFlowExecutionPayload(value: unknown): unknown {
  return boundJson(value, MAX_FLOW_EXECUTION_FIELD_BYTES, "object");
}

export function boundDebugExecutionPayload(
  value: unknown,
  shape: SentinelShape = "object",
): unknown {
  return boundJson(value, MAX_DEBUG_EXECUTION_FIELD_BYTES, shape);
}
