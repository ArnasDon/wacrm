DELETE FROM message_templates duplicate
USING (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY account_id, name, language
      ORDER BY
        (meta_template_id IS NOT NULL) DESC,
        (COALESCE(status, 'DRAFT') <> 'DRAFT') DESC,
        updated_at DESC NULLS LAST,
        created_at DESC NULLS LAST,
        id
    ) AS keep_rank
  FROM message_templates
  WHERE language IS NOT NULL
) ranked
WHERE duplicate.id = ranked.id
  AND ranked.keep_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS message_templates_account_name_language_key
  ON message_templates (account_id, name, language);

DROP INDEX IF EXISTS message_templates_user_name_language_key;
