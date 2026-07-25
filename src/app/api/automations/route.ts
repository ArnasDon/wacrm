import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { getTemplate } from '@/lib/automations/templates';
import {
  insertSteps,
  type BuilderStepInput,
} from '@/lib/automations/steps-tree';
import {
  validateStepsForActivation,
  validateTriggerForActivation,
} from '@/lib/automations/validate';
import { generatedAutomationSchema } from '@/lib/automations/dsl/schema';
import { hashAutomationDraft } from '@/lib/automations/draft-integrity';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('automations')
    .select('*')
    .order('created_at', { ascending: false });
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ automations: data ?? [] });
}

export async function POST(request: Request) {
  // Creating an automation is a write — the RLS automations_insert policy
  // requires `agent`, but this route inserts via the service-role client
  // which bypasses RLS, so the role must be enforced here.
  try {
    await requireRole('agent');
  } catch (err) {
    return toErrorResponse(err);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Resolve the caller's account_id — `automations.account_id` is NOT
  // NULL post-017, so an INSERT without it trips the not-null constraint
  // even though the admin client bypasses RLS.
  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .single();
  const accountId = profile?.account_id as string | undefined;
  if (!accountId) {
    return NextResponse.json(
      { error: 'Your profile is not linked to an account.' },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  if (!body)
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

  const {
    name,
    description,
    trigger_type,
    trigger_config,
    is_active,
    steps,
    template,
    source,
    generation_id,
  } = body;

  const isAiCopilot = source === 'ai_copilot';
  const generationId =
    typeof generation_id === 'string' ? generation_id.trim() : '';
  const hasGenerationId = generationId.length > 0;
  if (!isAiCopilot && hasGenerationId) {
    return NextResponse.json(
      { error: 'generation_id requires source "ai_copilot"' },
      { status: 400 }
    );
  }
  if (isAiCopilot && generationId.length === 0) {
    return NextResponse.json(
      { error: 'generation_id is required for AI-generated automations' },
      { status: 400 }
    );
  }

  let effectiveSteps: BuilderStepInput[] | undefined = steps;
  let effectiveName = name;
  let effectiveDescription = description;
  let effectiveTriggerType = trigger_type;
  let effectiveTriggerConfig = trigger_config;
  let generationDraftHash: string | null = null;

  if (template && (!steps || steps.length === 0)) {
    const t = getTemplate(template);
    if (t) {
      effectiveName = effectiveName ?? t.name;
      effectiveDescription = effectiveDescription ?? t.description;
      effectiveTriggerType = effectiveTriggerType ?? t.trigger_type;
      effectiveTriggerConfig = effectiveTriggerConfig ?? t.trigger_config;
      effectiveSteps = t.steps as unknown as BuilderStepInput[];
    }
  }

  if (!effectiveName || !effectiveTriggerType) {
    return NextResponse.json(
      { error: 'name and trigger_type are required' },
      { status: 400 }
    );
  }

  const admin = supabaseAdmin();

  if (isAiCopilot) {
    const { data: generation, error: generationError } = await admin
      .from('ai_automation_generations')
      .select('id, account_id, user_id, result, automation_id, draft_hash')
      .eq('id', generationId)
      .eq('account_id', accountId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (generationError) {
      return NextResponse.json(
        { error: generationError.message },
        { status: 500 }
      );
    }
    if (!generation) {
      return NextResponse.json(
        { error: 'AI automation generation not found' },
        { status: 404 }
      );
    }
    if (generation.result !== 'draft') {
      return NextResponse.json(
        { error: 'AI automation generation did not produce a draft' },
        { status: 409 }
      );
    }
    if (generation.automation_id !== null) {
      return NextResponse.json(
        { error: 'AI automation generation is already linked' },
        { status: 409 }
      );
    }
    generationDraftHash =
      typeof generation.draft_hash === 'string' ? generation.draft_hash : null;
  }

  // Block activation of a clearly broken automation up-front instead of
  // letting every trigger silently produce a failed log row. AI-generated
  // drafts get the same validation before persistence; incomplete manual
  // drafts remain saveable so users can keep progress mid-build.
  if (is_active || isAiCopilot) {
    const issues = [
      ...validateTriggerForActivation(
        effectiveTriggerType,
        effectiveTriggerConfig ?? {}
      ),
      ...validateStepsForActivation(
        (effectiveSteps ?? []) as unknown as {
          step_type: string;
          step_config: Record<string, unknown>;
        }[]
      ),
    ];
    if (issues.length > 0) {
      return NextResponse.json(
        {
          error: is_active
            ? 'Cannot activate automation with invalid configuration'
            : 'Cannot save AI-generated automation with invalid configuration',
          issues,
        },
        { status: 400 }
      );
    }
  }

  let aiDraftHash: string | null = null;
  if (isAiCopilot) {
    const parsedDraft = generatedAutomationSchema.safeParse({
      name: effectiveName,
      description: effectiveDescription ?? '',
      trigger_type: effectiveTriggerType,
      trigger_config: effectiveTriggerConfig ?? {},
      steps: effectiveSteps ?? [],
    });
    if (!parsedDraft.success) {
      return NextResponse.json(
        {
          error: 'Cannot save AI-generated automation with invalid configuration',
          issues: parsedDraft.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
        { status: 400 }
      );
    }

    aiDraftHash = hashAutomationDraft(parsedDraft.data);
    if (generationDraftHash !== aiDraftHash) {
      return NextResponse.json(
        {
          error: 'AI automation draft does not match the verified generation',
        },
        { status: 409 }
      );
    }

    effectiveName = parsedDraft.data.name;
    effectiveDescription = parsedDraft.data.description;
    effectiveTriggerType = parsedDraft.data.trigger_type;
    effectiveTriggerConfig = parsedDraft.data.trigger_config;
    effectiveSteps = parsedDraft.data.steps;
  }

  const { data: automation, error: insertErr } = await admin
    .from('automations')
    .insert({
      user_id: user.id,
      account_id: accountId,
      name: effectiveName,
      description: effectiveDescription ?? null,
      trigger_type: effectiveTriggerType,
      trigger_config: effectiveTriggerConfig ?? {},
      is_active: isAiCopilot ? false : !!is_active,
    })
    .select()
    .single();

  if (insertErr || !automation) {
    return NextResponse.json(
      { error: insertErr?.message ?? 'insert failed' },
      { status: 500 }
    );
  }

  async function rollbackAutomation(reason: string) {
    try {
      const { error: rollbackErr } = await admin
        .from('automations')
        .delete()
        .eq('id', automation.id);
      if (rollbackErr) {
        console.error(
          `Failed to roll back automation ${automation.id} after ${reason}:`,
          rollbackErr
        );
      }
    } catch (rollbackErr) {
      console.error(
        `Failed to roll back automation ${automation.id} after ${reason}:`,
        rollbackErr
      );
    }
  }

  if (effectiveSteps && effectiveSteps.length > 0) {
    const err = await insertSteps(automation.id, effectiveSteps);
    if (err) {
      await rollbackAutomation('step insertion failed');
      return NextResponse.json({ error: err }, { status: 500 });
    }
  }

  if (isAiCopilot) {
    const { data: linkedGeneration, error: linkError } = await admin
      .from('ai_automation_generations')
      .update({ automation_id: automation.id })
      .eq('id', generationId)
      .eq('account_id', accountId)
      .eq('user_id', user.id)
      .eq('result', 'draft')
      .eq('draft_hash', aiDraftHash)
      .is('automation_id', null)
      .select('id')
      .maybeSingle();

    if (linkError || !linkedGeneration) {
      await rollbackAutomation('generation linkage failed');
      if (linkError) {
        return NextResponse.json({ error: linkError.message }, { status: 500 });
      }
      return NextResponse.json(
        { error: 'AI automation generation was linked by another request' },
        { status: 409 }
      );
    }
  }

  return NextResponse.json({ automation }, { status: 201 });
}
