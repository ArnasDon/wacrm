import { createLinearNodeDescriptor } from "../registry/factories";
import { sendTemplateConfigSchema } from "../registry/schemas";

export const sendTemplateNodeDescriptor = createLinearNodeDescriptor({
  id: "send_template",
  label: "Send template",
  category: "messaging",
  icon: "message-square-code",
  configSchema: sendTemplateConfigSchema,
  runtimeKind: "legacy",
  runtimeHook: "legacy_automation_step",
  ui: {
    color: "text-violet-400",
    blurb: "Sends an approved WhatsApp template",
    hue: { l: 0.62, c: 0.17, h: 300 },
  },
});
