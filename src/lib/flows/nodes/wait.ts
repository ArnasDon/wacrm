import { createLinearNodeDescriptor } from "../registry/factories";
import { waitConfigSchema } from "../registry/schemas";

export const waitNodeDescriptor = createLinearNodeDescriptor({
  id: "wait",
  label: "Wait",
  category: "flow",
  icon: "clock",
  configSchema: waitConfigSchema,
  runtimeKind: "legacy",
  runtimeHook: "legacy_automation_step",
  ui: {
    color: "text-orange-400",
    blurb: "Pauses execution for a duration",
    hue: { l: 0.67, c: 0.15, h: 55 },
  },
});
