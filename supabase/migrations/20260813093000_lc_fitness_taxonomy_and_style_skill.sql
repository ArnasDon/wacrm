-- Tenant data backfill for the LC Fitness pilot account, following the
-- same account-resolution-by-source-name pattern already used by the
-- earlier LC Fitness catalogue migrations (20260808113000, 20260808114500,
-- 20260808123000): resolve the account once via its known catalogue
-- source name, then insert plain tenant configuration rows. The engine
-- itself (src/lib/catalog/taxonomy.ts, src/lib/ai/defaults.ts) no longer
-- needs to know this vocabulary — this migration only seeds it as LC's
-- own data so their existing behaviour does not regress.
--
-- Idempotent — safe to run multiple times (ON CONFLICT DO NOTHING).

do $$
declare
  v_account_id uuid;
  v_agent_id uuid;
begin
  select account_id into v_account_id
  from wacrm.catalog_sources
  where source_type = 'external_supabase'
    and lower(trim(name)) = lower('Base LC Fitness')
  limit 1;

  if v_account_id is null then
    -- No LC Fitness source configured in this environment (e.g. a fresh
    -- install) — nothing to seed.
    return;
  end if;

  -- Category taxonomy: the vocabulary the catalogue engine used to have
  -- hardcoded, now moved to this account's own data, plus "pantalona"
  -- (previously unsupported — this is the concrete proof the mechanism
  -- works: LC gets it purely through configuration, not a code change).
  insert into wacrm.catalog_taxonomy_terms (account_id, kind, canonical_value, aliases)
  values
    (v_account_id, 'category', 'legging', array['leggings','colante','colantes','calca de treino','calcas de treino','calca fitness','calcas fitness','tights']),
    (v_account_id, 'category', 'camisola', array['camisolas','camiseta','camisetas','t shirt','t shirts','tshirt','tshirts']),
    (v_account_id, 'category', 'top', array['tops']),
    (v_account_id, 'category', 'saia calcao', array['saia calcoes','skort']),
    (v_account_id, 'category', 'calcao', array['calcoes','short','shorts']),
    (v_account_id, 'category', 'macacao', array['macacoes','jumpsuit']),
    (v_account_id, 'category', 'conjunto', array['conjuntos','set']),
    (v_account_id, 'category', 'sapatilha', array['sapatilhas','tenis','calcado desportivo','sapato desportivo']),
    (v_account_id, 'category', 'saia', array['saias']),
    (v_account_id, 'category', 'acessorio', array['acessorios']),
    (v_account_id, 'category', 'pantalona', array['pantalonas','calca pantalona','calcas pantalona','wide leg','wide-leg'])
  on conflict (account_id, kind, canonical_value) do nothing;

  -- Colour taxonomy, unchanged from the engine's previous hardcoded list.
  insert into wacrm.catalog_taxonomy_terms (account_id, kind, canonical_value, aliases)
  values
    (v_account_id, 'color', 'preto', array['preta','pretos','pretas','negro','negra']),
    (v_account_id, 'color', 'branco', array['branca','brancos','brancas']),
    (v_account_id, 'color', 'azul', array['azuis','azul claro','azul escuro','azul-claro','azul-escuro']),
    (v_account_id, 'color', 'vermelho', array['vermelha','vermelhos','vermelhas']),
    (v_account_id, 'color', 'verde', array['verdes']),
    (v_account_id, 'color', 'amarelo', array['amarela','amarelos','amarelas']),
    (v_account_id, 'color', 'roxo', array['roxa','roxos','roxas','lilas','lils']),
    (v_account_id, 'color', 'rosa', array['rosas','cor de rosa']),
    (v_account_id, 'color', 'cinza', array['cinzento','cinzenta','cinzentos','cinzentas']),
    (v_account_id, 'color', 'bege', array['beges']),
    (v_account_id, 'color', 'laranja', array['laranjas']),
    (v_account_id, 'color', 'dourado', array['dourada','dourados','douradas']),
    (v_account_id, 'color', 'prateado', array['prateada','prateados','prateadas'])
  on conflict (account_id, kind, canonical_value) do nothing;

  -- Move the "Personal styling rule" out of the shared core prompt
  -- (src/lib/ai/defaults.ts) into LC's own Skill, so the fashion/body/
  -- styling guidance only applies to LC (and any other tenant that
  -- explicitly configures the same skill) instead of every account on
  -- the platform.
  select id into v_agent_id from wacrm.ai_configs where account_id = v_account_id limit 1;

  if v_agent_id is not null then
    insert into wacrm.skills (account_id, agent_id, name, instructions, objective, when_to_use, tool_keys, enabled, sort_order)
    values (
      v_account_id,
      v_agent_id,
      'Consultoria de Estilo',
      'When the customer volunteers something about their own body (height, size, build, skin tone), fitness habits, or style preference (e.g. more conservative/reserved, bold, casual) and asks for an opinion, suggestion or "what would suit me" — treat those details as real search criteria. ' ||
        'Turn the concrete product type/colour/size parts into structured catalogue constraints where possible, use search_catalog to retrieve real candidates, and use get_style_opinion for a visual opinion rather than giving generic advice. ' ||
        'Never comment on, judge, or speculate about the customer''s body beyond exactly what they said. Respond warmly and confidently regardless of body type or size, and never imply any body type is better suited to the brand than another.',
      'Give an honest, warm styling opinion when a customer asks what would suit them.',
      'The customer mentions their body, fitness habits, or style preference and asks for a suggestion or opinion.',
      array['search_catalog','get_style_opinion'],
      true,
      0
    )
    on conflict (account_id, agent_id, name) do nothing;
  end if;
end $$;
