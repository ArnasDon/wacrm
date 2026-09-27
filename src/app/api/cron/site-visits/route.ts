import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { runAutomationsForTrigger } from '@/lib/automations/engine';
import { sendPushToAccount } from '@/lib/push';

export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  const supplied = request.headers.get('x-cron-secret') ?? '';
  const suppliedBuf = Buffer.from(supplied);
  const expectedBuf = Buffer.from(expected);
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = supabaseAdmin();

  // 1. T-24h confirmation reminder (status: pending, reminded_24h: false)
  const tomorrowStart = new Date();
  tomorrowStart.setHours(tomorrowStart.getHours() + 23);
  const tomorrowEnd = new Date();
  tomorrowEnd.setHours(tomorrowEnd.getHours() + 25);

  const { data: visits24h } = await admin
    .from('site_visits')
    .select('*, contacts(*), properties(*)')
    .eq('status', 'pending')
    .eq('reminded_24h', false)
    .gte('scheduled_at', tomorrowStart.toISOString())
    .lte('scheduled_at', tomorrowEnd.toISOString());

  if (visits24h && visits24h.length > 0) {
    for (const visit of visits24h) {
      if (!visit.contact_id) continue;
      await runAutomationsForTrigger({
        accountId: visit.account_id,
        triggerType: 'visit_reminder_24h',
        contactId: visit.contact_id,
        context: {
          vars: {
            visit_id: visit.id,
            property_title: visit.properties?.title || 'the property',
            scheduled_at: visit.scheduled_at,
          },
        },
      });
      await admin
        .from('site_visits')
        .update({ reminded_24h: true })
        .eq('id', visit.id);

      sendPushToAccount(visit.account_id, {
        title: 'Visit Reminder (24h)',
        body: `Upcoming visit tomorrow at ${visit.properties?.title || 'property'} for ${visit.contacts?.name || 'client'}`,
      }).catch(console.error);
    }
  }

  // 2. T-2h reminder with location (status: confirmed, reminded_2h: false)
  const in2hStart = new Date();
  in2hStart.setHours(in2hStart.getHours() + 1);
  const in2hEnd = new Date();
  in2hEnd.setHours(in2hEnd.getHours() + 3);

  const { data: visits2h } = await admin
    .from('site_visits')
    .select('*, contacts(*), properties(*)')
    .eq('status', 'confirmed')
    .eq('reminded_2h', false)
    .gte('scheduled_at', in2hStart.toISOString())
    .lte('scheduled_at', in2hEnd.toISOString());

  if (visits2h && visits2h.length > 0) {
    for (const visit of visits2h) {
      if (!visit.contact_id) continue;
      await runAutomationsForTrigger({
        accountId: visit.account_id,
        triggerType: 'visit_reminder_2h',
        contactId: visit.contact_id,
        context: {
          vars: {
            visit_id: visit.id,
            property_title: visit.properties?.title || 'the property',
            scheduled_at: visit.scheduled_at,
          },
        },
      });
      await admin
        .from('site_visits')
        .update({ reminded_2h: true })
        .eq('id', visit.id);

      sendPushToAccount(visit.account_id, {
        title: 'Visit Reminder (2h)',
        body: `Upcoming visit in 2 hours at ${visit.properties?.title || 'property'} for ${visit.contacts?.name || 'client'}`,
      }).catch(console.error);
    }
  }

  // 3. No-show recovery (status: pending, passed scheduled_at)
  const now = new Date();
  const { data: noShows } = await admin
    .from('site_visits')
    .select('*, contacts(*), properties(*)')
    .eq('status', 'pending')
    .lt('scheduled_at', now.toISOString());

  if (noShows && noShows.length > 0) {
    for (const visit of noShows) {
      if (!visit.contact_id) continue;
      await runAutomationsForTrigger({
        accountId: visit.account_id,
        triggerType: 'visit_no_show',
        contactId: visit.contact_id,
        context: {
          vars: {
            visit_id: visit.id,
            property_title: visit.properties?.title || 'the property',
            scheduled_at: visit.scheduled_at,
          },
        },
      });
      await admin
        .from('site_visits')
        .update({ status: 'no_show' })
        .eq('id', visit.id);
    }
  }

  return NextResponse.json({
    success: true,
    processed24h: visits24h?.length || 0,
    processed2h: visits2h?.length || 0,
    processedNoShows: noShows?.length || 0,
  });
}
