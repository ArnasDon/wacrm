-- Account-level commercial behaviour for the AI assistant.
-- JSONB keeps the selling strategy extensible without turning ai_configs
-- into a wide table for every new merchandising preference.

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS commercial_strategy jsonb NOT NULL DEFAULT
    '{
      "max_products": 3,
      "prefer_visual": true,
      "auto_recommend": true,
      "check_stock": true,
      "keep_selected_product": true,
      "qualification_order": "size_then_color"
    }'::jsonb;

ALTER TABLE ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_commercial_strategy_object;

ALTER TABLE ai_configs
  ADD CONSTRAINT ai_configs_commercial_strategy_object
  CHECK (jsonb_typeof(commercial_strategy) = 'object');
