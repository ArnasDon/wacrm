// Shared automation builder payload types. Persistence lives in db/automations.ts.
export interface BuilderStepInput {
  id?: string;
  step_type: string;
  step_config: Record<string, unknown>;
  branches?: { yes?: BuilderStepInput[]; no?: BuilderStepInput[] };
  // Legacy flat form (from template seeds):
  branch?: 'yes' | 'no' | null;
  parent_index?: number | null;
}
export interface BuilderStepNode extends BuilderStepInput {
  id: string;
  branches: { yes: BuilderStepNode[]; no: BuilderStepNode[] };
}
