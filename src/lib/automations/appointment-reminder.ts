import { supabaseAdmin } from './admin-client'
import { runAutomationsForTrigger } from './engine'

export async function processAppointmentReminders() {
  const db = supabaseAdmin();
  
  await process24HourReminders(db);
  await process1HourReminders(db);
}

async function process24HourReminders(db: ReturnType<typeof supabaseAdmin>) {
  const now = new Date();
  const targetTime = new Date(now.getTime() + 24 * 60 * 60 * 1000 + 60 * 60 * 1000); // 25 hours from now
  
  const { data: deals, error } = await db
    .from('deals')
    .select('*, contact:contacts(*)')
    .not('contact_id', 'is', null)
    .gte('appointment_at', now.toISOString())
    .lte('appointment_at', targetTime.toISOString())
    .or('appointment_reminder_sent.eq.false,appointment_reminder_sent.is.null');

  if (error || !deals || deals.length === 0) return;

  for (const deal of deals) {
    try {
      const { error: updateErr } = await db
        .from('deals')
        .update({ appointment_reminder_sent: true })
        .eq('id', deal.id);

      if (updateErr) continue;

      const appointment_at_formatted = formatAppointmentDate(deal.appointment_at);

      await runAutomationsForTrigger({
        accountId: deal.account_id,
        triggerType: 'appointment_reminder',
        contactId: deal.contact_id,
        context: {
          conversation_id: deal.conversation_id || undefined,
          vars: {
            deal_id: deal.id,
            deal_title: deal.title,
            deal_value: deal.value,
            deal_currency: deal.currency,
            deal_status: deal.status,
            appointment_at: deal.appointment_at,
            appointment_at_formatted,
            agendamento: appointment_at_formatted,
            data_agendamento: appointment_at_formatted,
            deal: {
              id: deal.id,
              title: deal.title,
              value: deal.value,
              currency: deal.currency,
              status: deal.status,
              appointment_at: deal.appointment_at,
              appointment_at_formatted,
              agendamento: appointment_at_formatted,
            }
          }
        }
      });

      console.log(`[appointment-reminder-24h] Successfully triggered automation for deal ${deal.id}`);
    } catch (err) {
      console.error(`[appointment-reminder-24h] Error processing deal ${deal.id}:`, err);
    }
  }
}

async function process1HourReminders(db: ReturnType<typeof supabaseAdmin>) {
  const now = new Date();
  const targetTime1h = new Date(now.getTime() + 1 * 60 * 60 * 1000 + 15 * 60 * 1000); // 1h 15m from now

  // Select active deals with appointments scheduled within 1 hour (up to 1h 15m from now)
  const { data: deals, error } = await db
    .from('deals')
    .select('*, contact:contacts(*)')
    .not('contact_id', 'is', null)
    .gte('appointment_at', now.toISOString())
    .lte('appointment_at', targetTime1h.toISOString());

  if (error || !deals || deals.length === 0) return;

  for (const deal of deals) {
    try {
      // Check if 1h reminder was already triggered for this contact in automation_logs
      const { data: existingLog } = await db
        .from('automation_logs')
        .select('id')
        .eq('contact_id', deal.contact_id)
        .eq('trigger_event', 'appointment_reminder_1h')
        .gte('created_at', new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString())
        .maybeSingle();

      if (existingLog) continue;

      const appointment_at_formatted = formatAppointmentDate(deal.appointment_at);

      await runAutomationsForTrigger({
        accountId: deal.account_id,
        triggerType: 'appointment_reminder_1h',
        contactId: deal.contact_id,
        context: {
          conversation_id: deal.conversation_id || undefined,
          vars: {
            deal_id: deal.id,
            deal_title: deal.title,
            deal_value: deal.value,
            deal_currency: deal.currency,
            deal_status: deal.status,
            appointment_at: deal.appointment_at,
            appointment_at_formatted,
            agendamento: appointment_at_formatted,
            data_agendamento: appointment_at_formatted,
            deal: {
              id: deal.id,
              title: deal.title,
              value: deal.value,
              currency: deal.currency,
              status: deal.status,
              appointment_at: deal.appointment_at,
              appointment_at_formatted,
              agendamento: appointment_at_formatted,
            }
          }
        }
      });

      console.log(`[appointment-reminder-1h] Successfully triggered 1h reminder for deal ${deal.id}`);
    } catch (err) {
      console.error(`[appointment-reminder-1h] Error processing deal ${deal.id}:`, err);
    }
  }
}

function formatAppointmentDate(appointmentAt: string | null | undefined): string {
  if (!appointmentAt) return '';
  try {
    const d = new Date(appointmentAt);
    const dateStr = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const timeStr = d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
    return `${dateStr} às ${timeStr}`;
  } catch {
    return String(appointmentAt);
  }
}
