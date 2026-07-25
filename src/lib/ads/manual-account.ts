/**
 * The placeholder `ad_accounts` row that manual platforms hang off.
 *
 * `ad_campaigns.ad_account_id` is NOT NULL, but a Google Ads or "other"
 * campaign has no real account to authenticate against — Google has no
 * usable API here (it needs a developer token Google approves over
 * weeks), so its spend is typed in by hand. One placeholder row per
 * (account, platform) gives those campaigns a parent without inventing a
 * fake credential.
 *
 * Shared by the two routes that can bring a manual platform into
 * existence — POST /api/ads/accounts ("Activate Google Ads" in Settings)
 * and POST /api/ads/campaigns/manual (adding the first campaign) —
 * because if each built the row itself they would drift on name or
 * currency and the operator would end up with two "Google Ads" entries
 * that look like a bug.
 */

export type ManualPlatform = 'google' | 'other'

/** The single external_id used for every manual platform row. */
const MANUAL_EXTERNAL_ID = 'manual'

const PLATFORM_NAMES: Record<ManualPlatform, string> = {
  google: 'Google Ads (manual)',
  other: 'Other (manual)',
}

export function isManualPlatform(value: unknown): value is ManualPlatform {
  return value === 'google' || value === 'other'
}

/**
 * Get-or-create the placeholder row, returning its id.
 *
 * Upsert rather than select-then-insert: two requests racing to add the
 * first Google campaign would otherwise both miss and both insert, and
 * the unique key would fail one of them for no good reason.
 */
export async function ensureManualAdAccount({
  supabase,
  accountId,
  userId,
  platform,
  currency,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
  accountId: string
  userId: string
  platform: ManualPlatform
  currency: string
}): Promise<{ id: string; error?: undefined } | { id?: undefined; error: string }> {
  const { data, error } = await supabase
    .from('ad_accounts')
    .upsert(
      {
        account_id: accountId,
        platform,
        external_id: MANUAL_EXTERNAL_ID,
        name: PLATFORM_NAMES[platform],
        currency,
        status: 'connected',
        created_by: userId,
      },
      { onConflict: 'account_id,platform,external_id', ignoreDuplicates: false },
    )
    .select('id')
    .single()

  if (error || !data) {
    return { error: error?.message ?? 'Failed to create the manual ad account' }
  }
  return { id: data.id as string }
}
