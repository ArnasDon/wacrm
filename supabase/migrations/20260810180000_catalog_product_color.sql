-- A first-class colour field for internal catalogue products, separate
-- from the free-text description. Lets the catalogue UI show/edit what
-- the AI classifier decided without parsing it back out of a sentence.

alter table wacrm.catalog_products
  add column if not exists color text;
