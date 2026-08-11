import { it } from 'vitest';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

it('triggers appointment reminders manually', async () => {
  console.log('ENCRYPTION_KEY in test case:', process.env.ENCRYPTION_KEY);
  console.log('--- STARTING MANUAL APPOINTMENT REMINDER RUN ---');
  try {
    const { processAppointmentReminders } = await import('./appointment-reminder');
    await processAppointmentReminders();
    console.log('--- MANUAL RUN COMPLETED SUCCESSFULLY ---');
  } catch (err) {
    console.error('Error running manual appointment reminders:', err);
  }
});
