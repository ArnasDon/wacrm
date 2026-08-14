import type { SupabaseClient } from '@supabase/supabase-js';
import type { CalcProject } from '@/types';
import type { FlowComponentTemplate } from './types';

type DB = SupabaseClient;

// ------------------------------------------------------------
// calc_projects (empreendimentos) — only the reusable flow SHAPE is
// persisted here (see migration 064 + engine.ts). Simulations
// themselves never touch the DB: everything is computed locally.
// ------------------------------------------------------------

export interface CalcProjectWithComponents extends Omit<CalcProject, 'components'> {
  components: FlowComponentTemplate[];
}

function normalize(row: CalcProject): CalcProjectWithComponents {
  return {
    ...row,
    components: Array.isArray(row.components) ? (row.components as FlowComponentTemplate[]) : [],
  };
}

export async function listCalcProjects(db: DB): Promise<CalcProjectWithComponents[]> {
  const { data, error } = await db.from('calc_projects').select('*').order('name');
  if (error) throw error;
  return ((data ?? []) as CalcProject[]).map(normalize);
}

export interface CreateCalcProjectInput {
  accountId: string;
  userId: string;
  name: string;
  components: FlowComponentTemplate[];
}

export async function createCalcProject(
  db: DB,
  input: CreateCalcProjectInput,
): Promise<CalcProjectWithComponents> {
  const { data, error } = await db
    .from('calc_projects')
    .insert({
      account_id: input.accountId,
      user_id: input.userId,
      name: input.name,
      components: input.components,
    })
    .select()
    .single();
  if (error) throw error;
  return normalize(data as CalcProject);
}

export interface UpdateCalcProjectInput {
  id: string;
  name: string;
  components: FlowComponentTemplate[];
}

export async function updateCalcProject(
  db: DB,
  input: UpdateCalcProjectInput,
): Promise<CalcProjectWithComponents> {
  const { data, error } = await db
    .from('calc_projects')
    .update({ name: input.name, components: input.components })
    .eq('id', input.id)
    .select()
    .single();
  if (error) throw error;
  return normalize(data as CalcProject);
}

export async function deleteCalcProject(db: DB, id: string): Promise<void> {
  const { error } = await db.from('calc_projects').delete().eq('id', id);
  if (error) throw error;
}
