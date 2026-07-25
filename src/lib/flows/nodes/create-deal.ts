import { createLinearNodeDescriptor } from "../registry/factories";
import { createDealConfigSchema } from "../registry/schemas";

export const createDealNodeDescriptor = createLinearNodeDescriptor({
  id: "create_deal",
  label: "Create deal",
  category: "data",
  icon: "badge-plus",
  configSchema: createDealConfigSchema,
  runtimeKind: "legacy",
  runtimeHook: "legacy_automation_step",
  ui: {
    color: "text-emerald-400",
    blurb: "Creates a deal in a pipeline",
    hue: { l: 0.62, c: 0.13, h: 150 },
  },
});
