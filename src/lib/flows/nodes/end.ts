import { createTerminalNodeDescriptor } from "../registry/factories";
import { emptyConfigSchema } from "../registry/schemas";

export const endNodeDescriptor = createTerminalNodeDescriptor({
  id: "end",
  label: "End",
  category: "flow",
  icon: "flag",
  configSchema: emptyConfigSchema,
  visible: true,
  form: { kind: "fields", fields: [], help: "This node ends the flow." },
  defaultConfig: {},
  ui: {
    color: "text-muted-foreground",
    blurb: "Ends the flow",
    hue: { l: 0.55, c: 0.01, h: 260 },
  },
});
