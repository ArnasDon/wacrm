ALTER TABLE quick_replies
  DROP CONSTRAINT IF EXISTS quick_replies_content_matches_kind;

ALTER TABLE quick_replies
  ADD CONSTRAINT quick_replies_content_matches_kind CHECK (
    (kind = 'text' AND content_text IS NOT NULL AND btrim(content_text) <> '')
    OR (kind = 'interactive' AND interactive_payload IS NOT NULL)
  ) NOT VALID;
