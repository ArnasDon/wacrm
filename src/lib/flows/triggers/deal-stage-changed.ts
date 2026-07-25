import { createTriggerNodeDescriptor } from "../registry/factories";
import { dealStageTriggerConfigSchema } from "../registry/schemas";

export const dealStageChangedTriggerDescriptor = createTriggerNodeDescriptor({
  id: "trigger_deal_stage_changed",
  label: "Deal stage changed",
  category: "trigger",
  icon: "workflow",
  configSchema: dealStageTriggerConfigSchema,
  ui: {
    color: "text-lime-400",
    blurb: "Starts when a deal changes stage",
    hue: { l: 0.68, c: 0.14, h: 125 },
  },
});
