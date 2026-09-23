import { supabaseAdmin } from './admin-client';

// ------------------------------------------------------------
// Builder payload → flat rows for automation_steps.
// Root steps arrive in order. A Condition step carries its children
// under `branches: { yes: [...], no: [...] }`. We walk the tree and
// assign stable UUIDs so parent_step_id references resolve in a
// single INSERT.
// ------------------------------------------------------------

export interface BuilderStepInput {
  id?: string;
  step_type: string;
  step_config: Record<string, unknown>;
  branches?: { yes?: BuilderStepInput[]; no?: BuilderStepInput[] };
  // Legacy flat form (from template seeds):
  branch?: 'yes' | 'no' | null;
  parent_index?: number | null;
}

interface InsertRow {
  id: string;
  automation_id: string;
  parent_step_id: string | null;
  branch: 'yes' | 'no' | null;
  step_type: string;
  step_config: Record<string, unknown>;
  position: number;
}

const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

export async function replaceSteps(
  automationId: string,
  input: BuilderStepInput[]
): Promise<string | null> {
  const admin = supabaseAdmin();
  const { error: delErr } = await admin
    .from('automation_steps')
    .delete()
    .eq('automation_id', automationId);
  if (delErr) return delErr.message;
  return insertSteps(automationId, input);
}

export async function insertSteps(
  automationId: string,
  input: BuilderStepInput[]
): Promise<string | null> {
  if (!input || input.length === 0) return null;

  const looksFlat = input.some(
    (s) => s.branch !== undefined || s.parent_index !== undefined
  );
  const tree = looksFlat ? seedsToTree(input) : input;

  const rows: InsertRow[] = [];
  function walk(
    steps: BuilderStepInput[],
    parentId: string | null,
    branch: 'yes' | 'no' | null
  ) {
    steps.forEach((s, idx) => {
      const id = s.id ?? uid();
      rows.push({
        id,
        automation_id: automationId,
        parent_step_id: parentId,
        branch,
        step_type: s.step_type,
        step_config: s.step_config ?? {},
        position: idx,
      });
      if (s.step_type === 'condition' && s.branches) {
        if (s.branches.yes) walk(s.branches.yes, id, 'yes');
        if (s.branches.no) walk(s.branches.no, id, 'no');
      }
    });
  }
  walk(tree, null, null);

  if (rows.length === 0) return null;
  const { error } = await supabaseAdmin().from('automation_steps').insert(rows);
  return error?.message ?? null;
}

function seedsToTree(seeds: BuilderStepInput[]): BuilderStepInput[] {
  const nodes: BuilderStepInput[] = seeds.map((s) => ({
    ...s,
    branches: { yes: [], no: [] },
  }));
  const roots: BuilderStepInput[] = [];
  nodes.forEach((n, i) => {
    const seed = seeds[i];
    if (seed.parent_index == null) {
      roots.push(n);
    } else {
      const parent = nodes[seed.parent_index];
      parent.branches = parent.branches ?? { yes: [], no: [] };
      const bucket = (seed.branch ?? 'yes') as 'yes' | 'no';
      (parent.branches[bucket] ??= []).push(n);
    }
  });
  return roots;
}

/**
 * Load the steps for an automation and rebuild the nested tree shape
 * the builder UI expects. One query, O(n) assembly.
 */
export interface BuilderStepNode extends BuilderStepInput {
  id: string;
  branches: { yes: BuilderStepNode[]; no: BuilderStepNode[] };
}

interface DbStep {
  id: string;
  parent_step_id: string | null;
  branch: 'yes' | 'no' | null;
  step_type: string;
  step_config: Record<string, unknown>;
  position: number;
}

export async function loadStepsTree(
  automationId: string
): Promise<BuilderStepNode[]> {
  const { data, error } = await supabaseAdmin()
    .from('automation_steps')
    .select('*')
    .eq('automation_id', automationId)
    .order('position', { ascending: true });

  if (error) throw new Error(error.message);
  const rows = (data ?? []) as DbStep[];

  const byId = new Map<string, BuilderStepNode>();
  for (const row of rows) {
    byId.set(row.id, {
      id: row.id,
      step_type: row.step_type,
      step_config: row.step_config ?? {},
      branches: { yes: [], no: [] },
    });
  }

  const roots: BuilderStepNode[] = [];
  for (const row of rows) {
    const node = byId.get(row.id)!;
    if (row.parent_step_id) {
      const parent = byId.get(row.parent_step_id);
      if (parent) {
        const bucket = (row.branch ?? 'yes') as 'yes' | 'no';
        parent.branches[bucket].push(node);
      }
    } else {
      roots.push(node);
    }
  }
  return roots;
}
