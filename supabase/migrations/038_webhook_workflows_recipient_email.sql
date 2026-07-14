-- Add recipient_email_field column to webhook_workflows
ALTER TABLE webhook_workflows
ADD COLUMN IF NOT EXISTS recipient_email_field TEXT;
