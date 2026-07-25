import { createLinearNodeDescriptor } from "../registry/factories";
import { sendButtonsConfigSchema } from "../registry/schemas";

export const sendButtonsNodeDescriptor = createLinearNodeDescriptor({
  id: "send_buttons",
  label: "Send buttons",
  category: "messaging",
  icon: "list-checks",
  configSchema: sendButtonsConfigSchema,
  runtimeKind: "suspend",
  visible: true,
  form: { kind: "specialized", component: "send_buttons" },
  defaultConfig: {
    text: "",
    buttons: [{ reply_id: "option_1", title: "Option 1", next_node_key: "" }],
  },
  outgoingEdges: (config) =>
    typeof config.next_node_key === "string" && config.next_node_key
      ? [config.next_node_key]
      : Array.isArray(config.buttons)
      ? config.buttons
          .map((button) =>
            typeof button === "object" &&
            button !== null &&
            "next_node_key" in button &&
            typeof button.next_node_key === "string"
              ? button.next_node_key
              : null,
          )
          .filter((key): key is string => key !== null && key.length > 0)
      : [],
  ui: {
    color: "text-primary",
    blurb: "Sends quick-reply buttons",
    hue: { l: 0.62, c: 0.16, h: 254 },
  },
});
