import { createLinearNodeDescriptor } from "../registry/factories";
import {
  flowSendListConfigSchema,
  sendListConfigSchema,
} from "../registry/schemas";

export const sendListNodeDescriptor = createLinearNodeDescriptor({
  id: "send_list",
  label: "Send list",
  category: "messaging",
  icon: "list-plus",
  configSchema: sendListConfigSchema,
  flowConfigSchema: flowSendListConfigSchema,
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
  outgoingEdgeTargets: (config) => {
    if (typeof config.next_node_key === "string" && config.next_node_key) {
      return [{ target: config.next_node_key, field: "next_node_key" }];
    }
    if (!Array.isArray(config.sections)) return [];
    const edges: Array<{ target: string; field: string }> = [];
    config.sections.forEach((section, sectionIndex) => {
      if (
        typeof section !== "object" ||
        section === null ||
        !("rows" in section) ||
        !Array.isArray(section.rows)
      ) {
        return;
      }
      (section.rows as unknown[]).forEach((row, rowIndex) => {
        if (
          typeof row === "object" &&
          row !== null &&
          "next_node_key" in row &&
          typeof row.next_node_key === "string" &&
          row.next_node_key
        ) {
          edges.push({
            target: row.next_node_key,
            field: `sections.${sectionIndex}.rows.${rowIndex}.next_node_key`,
          });
        }
      });
    });
    return edges;
  },
  ui: {
    color: "text-indigo-400",
    blurb: "Sends a tappable list of options",
    hue: { l: 0.62, c: 0.15, h: 277 },
  },
});
