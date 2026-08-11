import { supabaseAdmin } from './admin-client'
import { runAutomationsForTrigger } from './engine'

export async function processAppointmentReminders() {
  const db = supabaseAdmin();
  
  // Calculate window: deals scheduled in the next 24 hours + 1 hour grace
  const now = new Date();
  const targetTime = new Date(now.getTime() + 24 * 60 * 60 * 1000 + 60 * 60 * 1000); // 25 hours from now
  
  // Select active deals that need a reminder
  const { data: deals, error } = await db
    .from('deals')
    .select('*, contact:contacts(*)')
    .not('contact_id', 'is', null)
    .gte('appointment_at', now.toISOString())
    .lte('appointment_at', targetTime.toISOString())
    .or('appointment_reminder_sent.eq.false,appointment_reminder_sent.is.null');

  if (error) {
    console.error('[appointment-reminder] Error loading deals:', error.message);
    return;
  }

  if (!deals || deals.length === 0) {
    return;
  }

  console.log(`[appointment-reminder] Found ${deals.length} deals to process`);

  for (const deal of deals) {
    try {
      // 1. Mark as sent first to prevent race condition/double triggering
      const { error: updateErr } = await db
        .from('deals')
        .update({ appointment_reminder_sent: true })
        .eq('id', deal.id);

      if (updateErr) {
        console.error(`[appointment-reminder] Failed to update reminder status for deal ${deal.id}:`, updateErr.message);
        continue;
      }

      // 2. Fire the automation trigger
      await runAutomationsForTrigger({
        accountId: deal.account_id,
        triggerType: 'appointment_reminder',
        contactId: deal.contact_id,
        context: {
          conversation_id: deal.conversation_id || undefined,
          vars: {
            deal_title: deal.title,
            appointment_at: deal.appointment_at,
          }
        }
      });

      console.log(`[appointment-reminder] Successfully triggered automation for deal ${deal.id}`);
    } catch (err) {
      console.error(`[appointment-reminder] Error processing deal ${deal.id}:`, err);
    }
  }
}
