-- ============================================================
-- 046_flow_node_registry_authoritative.sql
--
-- Node identities and config contracts now live in the application
-- descriptor registry. The historical CHECK from migrations 010/016
-- forced every additive node release to rewrite a closed enum in SQL
-- and could drift from the runtime/UI registry.
--
-- This is forward-only and non-destructive: no rows, tables, APIs, or
-- legacy automation data are changed. NOT NULL and all relational/RLS
-- constraints on flow_nodes remain in force.
-- ============================================================

ALTER TABLE flow_nodes
  DROP CONSTRAINT IF EXISTS flow_nodes_node_type_check;
