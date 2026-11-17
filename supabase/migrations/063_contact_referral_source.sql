ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS referral_source JSONB,
  ADD COLUMN IF NOT EXISTS referral_received_at TIMESTAMPTZ;

ALTER TABLE contacts
  DROP CONSTRAINT IF EXISTS contacts_referral_source_shape;
ALTER TABLE contacts
  ADD CONSTRAINT contacts_referral_source_shape
  CHECK (
    referral_source IS NULL
    OR (
      jsonb_typeof(referral_source) = 'object'
      AND octet_length(referral_source::text) <= 16384
    )
  );

CREATE INDEX IF NOT EXISTS idx_contacts_account_referral_received
  ON contacts(account_id, referral_received_at)
  WHERE referral_source IS NOT NULL;
