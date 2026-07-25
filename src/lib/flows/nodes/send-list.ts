import { createLinearNodeDescriptor } from "../registry/factories";
import { sendListConfigSchema } from "../registry/schemas";

export const sendListNodeDescriptor = createLinearNodeDescriptor({
  id: "send_list",
  label: "Send list",
  category: "messaging",
  icon: "list-plus",
  configSchema: sendListConfigSchema,
  runtimeKind: "suspend",
  visible: true,
  form: { kind: "specialized", component: "send_list" },
  defaultConfig: {
    text: "",
    button_label: "View options",
    sections: [
      {
        title: "Options",
        rows: [
          {
            reply_id: "option_1",
            title: "Option 1",
            next_node_key: "",
          },
        ],
      },
    ],
  },
  outgoingEdges: (config) => {
    if (typeof config.next_node_key === "string" && config.next_node_key) {
      return [config.next_node_key];
    }
    if (!Array.isArray(config.sections)) return [];
    const edges: string[] = [];
    for (const section of config.sections) {
      if (
        typeof section !== "object" ||
        section === null ||
        !("rows" in section) ||
        !Array.isArray(section.rows)
      ) {
        continue;
      }
      for (const row of section.rows) {
        if (
          typeof row === "object" &&
          row !== null &&
          "next_node_key" in row &&
          typeof row.next_node_key === "string" &&
          row.next_node_key
        ) {
          edges.push(row.next_node_key);
        }
      }
    }
    return edges;
  },
  ui: {
    color: "text-indigo-400",
    blurb: "Sends a tappable list of options",
    hue: { l: 0.62, c: 0.15, h: 277 },
  },
});
