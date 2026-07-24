ALTER TABLE custom_fields
  DROP CONSTRAINT IF EXISTS custom_fields_field_type_check;

ALTER TABLE custom_fields
  DROP CONSTRAINT IF EXISTS custom_fields_field_options_check;

UPDATE custom_fields
SET field_type = lower(field_type)
WHERE lower(field_type) IN ('text', 'number', 'date', 'select', 'checkbox', 'url', 'phone')
  AND field_type <> lower(field_type);

UPDATE custom_fields
SET field_type = 'text'
WHERE field_type NOT IN ('text', 'number', 'date', 'select', 'checkbox', 'url', 'phone');

UPDATE custom_fields
SET field_options = NULL
WHERE field_type <> 'select'
  AND field_options IS NOT NULL;

ALTER TABLE custom_fields
  ADD CONSTRAINT custom_fields_field_type_check
  CHECK (field_type IN ('text', 'number', 'date', 'select', 'checkbox', 'url', 'phone'));

ALTER TABLE custom_fields
  ADD CONSTRAINT custom_fields_field_options_check
  CHECK (field_type = 'select' OR field_options IS NULL);
