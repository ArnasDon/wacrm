import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  flowAnalyticsResponseSchema,
  parseFlowAnalyticsQuery,
} from '@/lib/flows/analytics';
import { createClient } from '@/lib/supabase/server';

const flowIdSchema = z.string().uuid();
const privateHeaders = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie',
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: privateHeaders });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const { id: rawFlowId } = await context.params;
  const flowId = flowIdSchema.safeParse(rawFlowId);
  if (!flowId.success) return json({ error: 'Invalid request' }, 400);

  let query;
  try {
    query = parseFlowAnalyticsQuery(new URL(request.url).searchParams);
  } catch {
    return json({ error: 'Invalid analytics request' }, 400);
  }

  const { data, error } = await supabase.rpc('get_flow_node_analytics', {
    p_flow_id: flowId.data,
    p_version_id: query.version_id ?? null,
    p_from: query.from ?? null,
    p_to: query.to ?? null,
  });
  if (error) {
    if (error.message.includes('analytics_not_found')) {
      return json({ error: 'Not found' }, 404);
    }
    if (error.message.includes('analytics_unauthorized')) {
      return json({ error: 'Unauthorized' }, 401);
    }
    if (
      error.message.includes('analytics_invalid_window') ||
      error.message.includes('analytics_node_limit')
    ) {
      return json({ error: 'Invalid analytics request' }, 400);
    }
    console.error('[flow-analytics] RPC failed');
    return json({ error: 'Unable to load analytics' }, 500);
  }

  const parsed = flowAnalyticsResponseSchema.safeParse(data);
  if (!parsed.success) {
    console.error('[flow-analytics] RPC returned an invalid result');
    return json({ error: 'Unable to load analytics' }, 500);
  }
  return json(parsed.data);
}
