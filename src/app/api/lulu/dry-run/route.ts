// ============================================================
// POST /api/lulu/dry-run     (admin+, cookie session)
//
// Simulates the next-best-action engine over every synced customer and
// returns a report. SENDS NOTHING and WRITES NOTHING (PRD §79 "Dry Run").
// All configured campaigns are simulated whether or not they are active.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  campaignFromRow,
  policyFromRow,
  runDryRun,
  type CampaignRow,
  type DryRunProfileRow,
  type PolicyRow,
} from '@/lib/lulu';

export const maxDuration = 60;

const PAGE = 1000;
const PARALLEL = 8;
const COLUMNS =
  'customer_id, mobile, name, language, birthday, last_order_date, total_orders, total_sales, median_interval_days, vip_flag, marketing_opt_in, active_complaint, suspect_reason, preferred_store';

export async function POST() {
  try {
    const ctx = await requireRole('admin');
    const db = ctx.supabase;
    const accountId = ctx.accountId;

    const [{ data: campaignRows, error: cErr }, { data: policyRow }, { data: syncRows }, countRes] =
      await Promise.all([
        db.from('lulu_campaigns').select('id, campaign_code, name, campaign_type, rule_params, offer_id, active').eq('account_id', accountId),
        db.from('lulu_contact_policy').select('*').eq('account_id', accountId).maybeSingle(),
        db
          .from('lulu_customer_sync_log')
          .select('data_as_of, finished_at')
          .eq('account_id', accountId)
          .order('started_at', { ascending: false })
          .limit(1),
        db.from('lulu_customer_profiles').select('id', { count: 'exact', head: true }).eq('account_id', accountId),
      ]);

    if (cErr) throw cErr;
    if (!campaignRows || campaignRows.length === 0) {
      return NextResponse.json({ error: 'No campaigns configured yet. Create the default campaigns first.' }, { status: 400 });
    }
    const total = countRes.count ?? 0;
    if (countRes.error) throw countRes.error;
    if (total === 0) {
      return NextResponse.json({ error: 'No customers synced yet.' }, { status: 400 });
    }

    // Page through the customer base (PostgREST caps a response at 1000 rows).
    const pageCount = Math.ceil(total / PAGE);
    const rows: DryRunProfileRow[] = [];
    for (let start = 0; start < pageCount; start += PARALLEL) {
      const batch = await Promise.all(
        Array.from({ length: Math.min(PARALLEL, pageCount - start) }, (_, i) => {
          const from = (start + i) * PAGE;
          return db
            .from('lulu_customer_profiles')
            .select(COLUMNS)
            .eq('account_id', accountId)
            .order('customer_id')
            .range(from, from + PAGE - 1);
        })
      );
      for (const b of batch) {
        if (b.error) throw b.error;
        rows.push(...((b.data ?? []) as unknown as DryRunProfileRow[]));
      }
    }

    const report = runDryRun(
      rows,
      (campaignRows as CampaignRow[]).map(campaignFromRow),
      policyFromRow(policyRow as PolicyRow | null),
      new Date()
    );

    return NextResponse.json({
      report,
      dataAsOf: syncRows?.[0]?.data_as_of ?? null,
      note: 'Simulation only — nothing was sent or saved. Message history is empty until the sender exists, so frequency caps are not applied yet.',
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
