import { Buffer } from "node:buffer";
import { z } from "zod";

const cursorSchema = z.object({
  timestamp: z.string().datetime({ offset: true }),
  id: z.string().uuid(),
});

export interface DebugCompoundCursor {
  timestamp: string;
  id: string;
}

export function encodeDebugCursor(cursor: DebugCompoundCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeDebugCursor(value: string): DebugCompoundCursor | null {
  if (!value || value.length > 512) return null;
  try {
    return cursorSchema.parse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
  } catch {
    return null;
  }
}

export function descendingCursorFilter(
  timestampColumn: string,
  cursor: DebugCompoundCursor,
): string {
  return `${timestampColumn}.lt.${cursor.timestamp},and(${timestampColumn}.eq.${cursor.timestamp},id.lt.${cursor.id})`;
}
