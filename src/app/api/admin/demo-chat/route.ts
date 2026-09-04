import { NextResponse } from 'next/server';
import { requirePlatformAdmin, toErrorResponse } from '@/lib/auth/account';
import { loadAiConfig } from '@/lib/ai/config';
import { generateAnthropic } from '@/lib/ai/providers/anthropic';
import { generateOpenAi } from '@/lib/ai/providers/openai';
import type { ProviderArgs } from '@/lib/ai/providers/shared';
import { AiError, type ChatMessage } from '@/lib/ai/types';

/**
 * POST /api/admin/demo-chat   (platform admin only)
 *
 * A throwaway sandbox for pitching Sandía: paste a company's would-be
 * system prompt, chat against it, see how the assistant would answer.
 * Nothing is persisted.
 *
 * Uses the SAME AI key as the rest of the program — the platform
 * admin's own account `ai_configs` row (Configuración → Agentes de IA),
 * read with `requireActive:false` so it works even before the master
 * switch is on. Unlike the agent playground it does NOT wrap the prompt
 * in the auto-reply framing / knowledge base — the whole point is to
 * show a prospect their raw prompt, verbatim.
 */

export const dynamic = 'force-dynamic';

const MAX_TURNS = 40;
const MAX_CHARS = 8_000;
const TIMEOUT_MS = 30_000;

export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requirePlatformAdmin();

    const body = (await request.json().catch(() => ({}))) as {
      systemPrompt?: unknown;
      messages?: unknown;
    };

    const systemPrompt =
      typeof body.systemPrompt === 'string'
        ? body.systemPrompt.trim().slice(0, MAX_CHARS)
        : '';
    if (!systemPrompt) {
      return NextResponse.json(
        { error: 'Escribe primero el prompt de la empresa.' },
        { status: 400 },
      );
    }

    const rawMessages = Array.isArray(body.messages) ? body.messages : [];
    const messages: ChatMessage[] = rawMessages
      .filter(
        (m): m is { role: 'user' | 'assistant'; content: string } =>
          !!m &&
          typeof m === 'object' &&
          ((m as { role?: unknown }).role === 'user' ||
            (m as { role?: unknown }).role === 'assistant') &&
          typeof (m as { content?: unknown }).content === 'string',
      )
      .slice(-MAX_TURNS)
      .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));

    if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
      return NextResponse.json(
        { error: 'Envía al menos un mensaje del cliente.' },
        { status: 400 },
      );
    }

    const config = await loadAiConfig(supabase, accountId, {
      requireActive: false,
    }).catch(() => {
      throw new AiError(
        'La clave de IA guardada no se pudo descifrar (revisa ENCRYPTION_KEY).',
        { code: 'key_decrypt_failed', status: 400 },
      );
    });
    if (!config) {
      return NextResponse.json(
        {
          error:
            'No hay un agente de IA configurado. Agrega la clave del proveedor en Agentes de IA.',
          code: 'ai_not_configured',
        },
        { status: 400 },
      );
    }

    const args: ProviderArgs = {
      apiKey: config.apiKey,
      model: config.model,
      systemPrompt,
      messages,
      timeoutMs: TIMEOUT_MS,
    };

    try {
      const { text } =
        config.provider === 'openai'
          ? await generateOpenAi(args)
          : await generateAnthropic(args);
      return NextResponse.json({
        reply: text,
        model: `${config.provider}/${config.model}`,
      });
    } catch (err) {
      if (err instanceof AiError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      throw err;
    }
  } catch (error) {
    return toErrorResponse(error);
  }
}
