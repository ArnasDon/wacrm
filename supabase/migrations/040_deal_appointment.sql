-- Migration 040: Add appointment_at and appointment_reminder_sent to deals
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS appointment_at TIMESTAMPTZ;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS appointment_reminder_sent BOOLEAN DEFAULT FALSE;

-- Index for appointment reminder scheduler
CREATE INDEX IF NOT EXISTS idx_deals_appointment_reminder 
ON public.deals (appointment_at) 
WHERE appointment_at IS NOT NULL AND (appointment_reminder_sent IS FALSE OR appointment_reminder_sent IS NULL);
