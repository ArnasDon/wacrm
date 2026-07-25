import { createLinearNodeDescriptor } from "../registry/factories";
import { setTagConfigSchema } from "../registry/schemas";

export const setTagNodeDescriptor = createLinearNodeDescriptor({
  id: "set_tag",
  label: "Tag contact",
  category: "logic",
  icon: "tag",
  configSchema: setTagConfigSchema,
  visible: true,
  form: { kind: "specialized", component: "set_tag" },
  defaultConfig: { mode: "add", tag_id: "", next_node_key: "" },
  ui: {
    color: "text-pink-400",
    blurb: "Adds or removes a contact tag",
    hue: { l: 0.65, c: 0.15, h: 350 },
  },
});
