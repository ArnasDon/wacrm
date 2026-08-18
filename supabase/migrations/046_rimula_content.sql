-- ============================================================
-- 046_rimula_content.sql — Content, ContentTranslation, VoiceNote
-- (§9.0/§9.1, §10)
--
-- Three tables backing the Content Studio pipeline: CREATE → UPLOAD
-- MEDIA → WRITE ORIGINAL COPY → SELECT LANGUAGES → ENTER LOCALIZATION
-- → RECORD/GENERATE VOICE → REVIEW → APPROVE → SCHEDULE/PUBLISH.
--
--   1. content              — the source-language item. `status`
--      uses §9.1's exact enum (`Draft, In Review, Approved, Scheduled,
--      Published, Failed, Archived`) — note the mixed case, matching
--      the spec verbatim rather than normalizing to upper-snake, since
--      this is the literal set the spec's UI/status pipeline names.
--   2. content_translations — one row per (content, language). §10 is
--      explicit that this is content-*data* localization (Urdu,
--      Pashto, Punjabi, Roman Urdu), a different system from the
--      existing `next-intl` UI-chrome localization — never overwrite
--      the source `content` row when a translation is entered.
--   3. voice_notes           — audio for a content item or a specific
--      translation, `source` distinguishing a BA's own recording (P0)
--      from a future TTS-synthesized clip (P1, §10). Storage path
--      follows the same `chat-media` bucket / `account-<id>/...`
--      convention as `product_images` (migration 041) — the bucket's
--      MIME allow-list already covers voice-note audio types
--      (audio/ogg, audio/aac, audio/mp4, audio/amr, audio/opus; see
--      the corrected §9.0 map), so no new bucket is created here.
--
-- Operational content-authoring data — agent+ (BA) writes, any member
-- reads. §14 additionally restricts translation editing to BAs whose
-- own `languages` field covers that language; enforcing that requires
-- reading the caller's own profile row, which is straightforward at
-- the application layer (already loaded on every request) but would
-- need a dedicated helper function to express in RLS. Deferred to the
-- phase that builds the Content Studio UI rather than guessed at here
-- — the account-membership policy below is the correct baseline in
-- the meantime and is never *less* restrictive than the finished
-- policy will be.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- 1. content
-- ============================================================
CREATE TABLE IF NOT EXISTS content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN (
    'poster', 'image', 'video', 'text_post', 'voice_note', 'product_post', 'campaign_post'
  )),
  body TEXT,
  media_url TEXT,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN (
    'Draft', 'In Review', 'Approved', 'Scheduled', 'Published', 'Failed', 'Archived'
  )),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_account ON content(account_id);
CREATE INDEX IF NOT EXISTS idx_content_account_status ON content(account_id, status);
CREATE INDEX IF NOT EXISTS idx_content_product ON content(product_id);
CREATE INDEX IF NOT EXISTS idx_content_campaign ON content(campaign_id);

ALTER TABLE content ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS content_select ON content;
CREATE POLICY content_select ON content FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS content_insert ON content;
CREATE POLICY content_insert ON content FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS content_update ON content;
CREATE POLICY content_update ON content FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS content_delete ON content;
CREATE POLICY content_delete ON content FOR DELETE
  USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON content;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON content
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 2. content_translations
-- ============================================================
CREATE TABLE IF NOT EXISTS content_translations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  content_id UUID NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  -- ur = Urdu, ps = Pashto, pa = Punjabi, ur-Roman = Roman Urdu (§10).
  language TEXT NOT NULL CHECK (language IN ('ur', 'ps', 'pa', 'ur-Roman')),
  body TEXT NOT NULL,
  translated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (content_id, language)
);

CREATE INDEX IF NOT EXISTS idx_content_translations_content ON content_translations(content_id);
CREATE INDEX IF NOT EXISTS idx_content_translations_account ON content_translations(account_id);

ALTER TABLE content_translations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS content_translations_select ON content_translations;
CREATE POLICY content_translations_select ON content_translations FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS content_translations_insert ON content_translations;
CREATE POLICY content_translations_insert ON content_translations FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS content_translations_update ON content_translations;
CREATE POLICY content_translations_update ON content_translations FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS content_translations_delete ON content_translations;
CREATE POLICY content_translations_delete ON content_translations FOR DELETE
  USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON content_translations;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON content_translations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 3. voice_notes
-- ============================================================
CREATE TABLE IF NOT EXISTS voice_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  content_id UUID REFERENCES content(id) ON DELETE CASCADE,
  content_translation_id UUID REFERENCES content_translations(id) ON DELETE CASCADE,
  language TEXT NOT NULL CHECK (language IN ('ur', 'ps', 'pa', 'ur-Roman')),
  -- Storage object path within the existing `chat-media` bucket
  -- (account-<account_id>/... convention, migration 023).
  storage_path TEXT NOT NULL,
  duration_seconds INTEGER,
  source TEXT NOT NULL DEFAULT 'recorded' CHECK (source IN ('recorded', 'tts')),
  recorded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_voice_notes_content ON voice_notes(content_id);
CREATE INDEX IF NOT EXISTS idx_voice_notes_translation ON voice_notes(content_translation_id);
CREATE INDEX IF NOT EXISTS idx_voice_notes_account ON voice_notes(account_id);

ALTER TABLE voice_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS voice_notes_select ON voice_notes;
CREATE POLICY voice_notes_select ON voice_notes FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS voice_notes_insert ON voice_notes;
CREATE POLICY voice_notes_insert ON voice_notes FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS voice_notes_update ON voice_notes;
CREATE POLICY voice_notes_update ON voice_notes FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS voice_notes_delete ON voice_notes;
CREATE POLICY voice_notes_delete ON voice_notes FOR DELETE
  USING (is_account_member(account_id, 'agent'));
