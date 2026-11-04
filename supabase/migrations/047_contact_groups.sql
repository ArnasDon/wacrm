-- Contact groups: named lists of contacts for broadcast targeting.
-- Distinct from `tags` / `contact_tags` — tags stay for labels &
-- automations; groups are audience buckets (CSV-friendly member lists).

CREATE TABLE IF NOT EXISTS contact_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3b82f6',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contact_groups_account
  ON contact_groups(account_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_groups_account_name
  ON contact_groups(account_id, lower(name));

ALTER TABLE contact_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contact_groups_select ON contact_groups;
CREATE POLICY contact_groups_select ON contact_groups
  FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS contact_groups_insert ON contact_groups;
CREATE POLICY contact_groups_insert ON contact_groups
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS contact_groups_update ON contact_groups;
CREATE POLICY contact_groups_update ON contact_groups
  FOR UPDATE USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS contact_groups_delete ON contact_groups;
CREATE POLICY contact_groups_delete ON contact_groups
  FOR DELETE USING (is_account_member(account_id, 'agent'));

CREATE TABLE IF NOT EXISTS contact_group_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id UUID NOT NULL REFERENCES contact_groups(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (group_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_contact_group_members_group
  ON contact_group_members(group_id);

CREATE INDEX IF NOT EXISTS idx_contact_group_members_contact
  ON contact_group_members(contact_id);

ALTER TABLE contact_group_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contact_group_members_select ON contact_group_members;
CREATE POLICY contact_group_members_select ON contact_group_members
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM contact_groups g
      WHERE g.id = contact_group_members.group_id
        AND is_account_member(g.account_id)
    )
  );

DROP POLICY IF EXISTS contact_group_members_modify ON contact_group_members;
CREATE POLICY contact_group_members_modify ON contact_group_members
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM contact_groups g
      WHERE g.id = contact_group_members.group_id
        AND is_account_member(g.account_id, 'agent')
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM contact_groups g
      WHERE g.id = contact_group_members.group_id
        AND is_account_member(g.account_id, 'agent')
    )
    AND EXISTS (
      SELECT 1 FROM contacts c
      WHERE c.id = contact_group_members.contact_id
        AND is_account_member(c.account_id, 'agent')
    )
  );
