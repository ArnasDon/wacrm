import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { loadAiConfig } from "@/lib/ai/config";
import {
  FlowGenerationError,
  generateFlowFromPrompt,
  type FlowCopilotGenerationMetadata,
  type FlowCopilotHistoryEntry,
} from "@/lib/ai/flow-generate";
import { recordAutomationGeneration } from "@/lib/ai/automation-telemetry";
import { AiError, type AiConfig } from "@/lib/ai/types";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import {
  FlowCodeError,
  parseFlowCodeInput,
  type FlowCodeDocument,
} from "@/lib/flows/flow-code";
import { loadFlowCodeCatalog } from "@/lib/flows/flow-code-server";

const MAX_MESSAGE_LENGTH = 2000;
const MAX_CONTEXT_MESSAGES = 12;
const MAX_LOCALE_LENGTH = 32;
const MAX_CURRENT_DRAFT_CHARS = 64_000;
const MAX_CURRENT_DRAFT_BYTES = 128_000;

type TelemetryContext = {
  accountId: string;
  userId: string;
  config: AiConfig;
};

export async function POST(request: Request) {
  const startedAt = Date.now();
  let telemetryContext: TelemetryContext | null = null;
  let telemetryAttempted = false;

  try {
    const account = await requireRole("agent");

    let limit;
    try {
      limit = await checkRateLimit(
        `ai-flow-copilot:${account.userId}`,
        RATE_LIMITS.aiCopilot,
      );
    } catch (error) {
      console.error("[flows/generate] distributed rate limit unavailable:", error);
      return NextResponse.json(
        {
          error: "Rate limit service unavailable",
          code: "rate_limit_unavailable",
        },
        { status: 503 },
      );
    }
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    const parsedRequest = parseRequest(body);
    if (!parsedRequest.success) {
      return NextResponse.json(
        { error: parsedRequest.error, code: parsedRequest.code },
        { status: parsedRequest.status },
      );
    }

    const config = await loadAiConfig(account.supabase, account.accountId).catch(
      (error) => {
        console.error("[flows/generate] loadAiConfig error:", error);
        throw new AiError("Stored API key could not be decrypted.", {
          code: "key_decrypt_failed",
          status: 400,
        });
      },
    );
    if (!config) {
      return NextResponse.json(
        {
          error:
            "No AI agent configured yet. Add your provider key under Settings → AI agent (/settings?tab=ai-agent).",
          code: "ai_not_configured",
        },
        { status: 400 },
      );
    }
    telemetryContext = {
      accountId: account.accountId,
      userId: account.userId,
      config,
    };

    const catalog = await loadFlowCodeCatalog(supabaseAdmin(), account.accountId);
    const turn = await generateFlowFromPrompt({
      config,
      history: parsedRequest.history,
      currentDraft: parsedRequest.currentDraft,
      locale: parsedRequest.locale,
      catalog,
    });

    telemetryAttempted = true;
    const draftHash = turn.kind === "draft" ? turn.preview.digest : null;
    const generationId = await recordAutomationGeneration({
      accountId: account.accountId,
      userId: account.userId,
      config,
      result: turn.kind,
      failureCode: null,
      generationCount: turn.metadata.generationCount,
      repairCount: turn.metadata.repairCount,
      verificationCount: turn.metadata.verificationCount,
      promptTokens: turn.metadata.promptTokens,
      completionTokens: turn.metadata.completionTokens,
      durationMs: Date.now() - startedAt,
      issueCount: turn.metadata.issueCount,
      draftHash,
    });

    if (turn.kind === "question") {
      return NextResponse.json({
        kind: "question",
        text: turn.text,
        reasonCode: turn.reasonCode,
        choices: turn.choices,
        issues: turn.issues ?? [],
      });
    }

    return NextResponse.json({
      kind: "draft",
      flow: turn.flow,
      code: turn.code,
      digest: turn.preview.digest,
      preview: turn.preview,
      draft: turn.graph,
      generation_id: generationId,
      verified: true,
      issues: [],
    });
  } catch (error) {
    if (telemetryContext && !telemetryAttempted) {
      telemetryAttempted = true;
      const metadata = metadataFromError(error);
      try {
        await recordAutomationGeneration({
          accountId: telemetryContext.accountId,
          userId: telemetryContext.userId,
          config: telemetryContext.config,
          result: "failed",
          failureCode:
            error instanceof AiError ? error.code : "flow_generation_failed",
          generationCount: metadata.generationCount,
          repairCount: metadata.repairCount,
          verificationCount: metadata.verificationCount,
          promptTokens: metadata.promptTokens,
          completionTokens: metadata.completionTokens,
          durationMs: Date.now() - startedAt,
          issueCount: metadata.issueCount,
          draftHash: null,
        });
      } catch (telemetryError) {
        console.error(
          "[flows/generate] failed to record failure telemetry:",
          telemetryError,
        );
      }
    }

    if (error instanceof AiError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    return toErrorResponse(error);
  }
}

type ParsedRequest =
  | {
      success: true;
      history: FlowCopilotHistoryEntry[];
      currentDraft: FlowCodeDocument | null;
      locale: string;
    }
  | { success: false; error: string; code: string; status: number };

function parseRequest(body: unknown): ParsedRequest {
  if (!body || typeof body !== "object") {
    return {
      success: false,
      error: "message is required",
      code: "invalid_request",
      status: 400,
    };
  }
  const input = body as Record<string, unknown>;
  const message = typeof input.message === "string" ? input.message.trim() : "";
  if (!message) {
    return {
      success: false,
      error: "message is required",
      code: "invalid_request",
      status: 400,
    };
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return {
      success: false,
      error: `message is too long (max ${MAX_MESSAGE_LENGTH} characters)`,
      code: "message_too_long",
      status: 400,
    };
  }

  const history = Array.isArray(input.history)
    ? input.history
        .filter(isHistoryEntry)
        .map((entry) => ({
          role: entry.role,
          text: entry.text.trim().slice(0, MAX_MESSAGE_LENGTH),
        }))
        .filter((entry) => entry.text.length > 0)
        .slice(-(MAX_CONTEXT_MESSAGES - 1))
    : [];
  history.push({ role: "user", text: message });

  let currentDraft: FlowCodeDocument | null = null;
  if (input.currentDraft !== undefined && input.currentDraft !== null) {
    const size = measureSerializedSize(input.currentDraft);
    if (size !== null && isDraftTooLarge(size)) return currentDraftTooLarge();
    try {
      currentDraft = parseFlowCodeInput(JSON.stringify(input.currentDraft))
        .document;
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof FlowCodeError
            ? error.message
            : "currentDraft does not match the flow-code schema",
        code: "invalid_current_draft",
        status: 400,
      };
    }
  }

  const requestedLocale =
    typeof input.locale === "string"
      ? input.locale.trim().slice(0, MAX_LOCALE_LENGTH)
      : "";
  const locale = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(requestedLocale)
    ? requestedLocale
    : "en";

  return { success: true, history, currentDraft, locale };
}

function isHistoryEntry(
  entry: unknown,
): entry is { role: "user" | "assistant"; text: string } {
  if (!entry || typeof entry !== "object") return false;
  const candidate = entry as { role?: unknown; text?: unknown };
  return (
    (candidate.role === "user" || candidate.role === "assistant") &&
    typeof candidate.text === "string"
  );
}

function metadataFromError(error: unknown): FlowCopilotGenerationMetadata {
  if (error instanceof FlowGenerationError) return error.metadata;
  return {
    generationCount: 0,
    repairCount: 0,
    verificationCount: 0,
    promptTokens: 0,
    completionTokens: 0,
    issueCount: 0,
  };
}

function measureSerializedSize(
  value: unknown,
): { chars: number; bytes: number } | null {
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== "string") return null;
    return {
      chars: serialized.length,
      bytes: new TextEncoder().encode(serialized).length,
    };
  } catch {
    return null;
  }
}

function isDraftTooLarge(size: { chars: number; bytes: number }): boolean {
  return (
    size.chars > MAX_CURRENT_DRAFT_CHARS || size.bytes > MAX_CURRENT_DRAFT_BYTES
  );
}

function currentDraftTooLarge(): ParsedRequest {
  return {
    success: false,
    error:
      `currentDraft is too large (max ${MAX_CURRENT_DRAFT_CHARS} characters or ` +
      `${MAX_CURRENT_DRAFT_BYTES} bytes when serialized)`,
    code: "current_draft_too_large",
    status: 413,
  };
}
