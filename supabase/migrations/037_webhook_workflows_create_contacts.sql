-- Add create_contacts column to webhook_workflows
ALTER TABLE webhook_workflows
ADD COLUMN IF NOT EXISTS create_contacts BOOLEAN NOT NULL DEFAULT TRUE;
