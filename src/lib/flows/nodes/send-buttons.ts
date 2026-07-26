import { createLinearNodeDescriptor } from "../registry/factories";
import {
  flowSendButtonsConfigSchema,
  sendButtonsConfigSchema,
} from "../registry/schemas";

export const sendButtonsNodeDescriptor = createLinearNodeDescriptor({
  id: "send_buttons",
  label: "Send buttons",
  category: "messaging",
  icon: "list-checks",
  configSchema: sendButtonsConfigSchema,
  flowConfigSchema: flowSendButtonsConfigSchema,
  runtimeKind: "suspend",
  supportsDefaultValue: false,
  outputs: [
    {
      id: "button",
      label: "Button",
      type: "control",
      cardinality: "one",
      required: true,
      handlePrefix: "button:",
    },
  ],
  visible: true,
  form: { kind: "specialized", component: "send_buttons" },
  defaultConfig: {
    text: "",
    buttons: [{ reply_id: "option_1", title: "Option 1", next_node_key: "" }],
  },
  outgoingEdgeTargets: (config) =>
    typeof config.next_node_key === "string" && config.next_node_key
      ? [{ target: config.next_node_key, field: "next_node_key" }]
      : Array.isArray(config.buttons)
      ? config.buttons
          .flatMap((button, index) =>
            typeof button === "object" &&
            button !== null &&
            "next_node_key" in button &&
            typeof button.next_node_key === "string" &&
            button.next_node_key
              ? [
                  {
                    target: button.next_node_key,
                    field: `buttons.${index}.next_node_key`,
                  },
                ]
              : [],
          )
      : [],
  ui: {
    color: "text-primary",
    blurb: "Sends quick-reply buttons",
    hue: { l: 0.62, c: 0.16, h: 254 },
  },
});
