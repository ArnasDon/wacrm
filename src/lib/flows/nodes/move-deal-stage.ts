import { createLinearNodeDescriptor } from "../registry/factories";
import { moveDealStageConfigSchema } from "../registry/schemas";

export const moveDealStageNodeDescriptor = createLinearNodeDescriptor({
  id: "move_deal_stage",
  label: "Move deal stage",
  category: "data",
  icon: "workflow",
  configSchema: moveDealStageConfigSchema,
  runtimeKind: "legacy",
  runtimeHook: "legacy_automation_step",
  ui: {
    color: "text-lime-400",
    blurb: "Moves an existing deal to another stage",
    hue: { l: 0.68, c: 0.14, h: 125 },
  },
});
