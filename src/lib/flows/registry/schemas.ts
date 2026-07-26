import { z } from "zod";

import { INTERACTIVE_LIMITS } from "@/lib/whatsapp/meta-api";

const requiredText = (message: string) => z.string().trim().min(1, message);
export const nextNodeKeySchema = requiredText("A next node is required.");

export const startConfigSchema = z.looseObject({
  next_node_key: nextNodeKeySchema,
});

export const sendMessageConfigSchema = z.looseObject({
  text: requiredText("Message text is required."),
  next_node_key: nextNodeKeySchema,
});

const buttonSchema = z.looseObject({
  reply_id: requiredText("Reply id is required."),
  title: requiredText("Button title is required.").max(
    INTERACTIVE_LIMITS.buttonTitleMaxLength,
    `Button title is over ${INTERACTIVE_LIMITS.buttonTitleMaxLength} chars (WhatsApp limit).`,
  ),
  next_node_key: nextNodeKeySchema,
});

export const flowSendButtonsConfigSchema = z
  .looseObject({
    text: requiredText("Message text is required."),
    header_text: z.string().optional(),
    footer_text: z.string().optional(),
    buttons: z
      .array(buttonSchema)
      .min(1, "at least one button is required.")
      .max(
        INTERACTIVE_LIMITS.maxButtons,
        `at most ${INTERACTIVE_LIMITS.maxButtons} buttons are allowed.`,
      ),
  })
  .superRefine((config, ctx) => {
    const seen = new Set<string>();
    config.buttons.forEach((button, index) => {
      if (seen.has(button.reply_id)) {
        ctx.addIssue({
          code: "custom",
          path: ["buttons", index, "reply_id"],
          message: `Duplicate button reply id "${button.reply_id}".`,
        });
      }
      seen.add(button.reply_id);
    });
  });

const listRowSchema = z.looseObject({
  reply_id: requiredText("Reply id is required."),
  title: requiredText("Row title is required.").max(
    INTERACTIVE_LIMITS.listRowTitleMaxLength,
    `Row title exceeds ${INTERACTIVE_LIMITS.listRowTitleMaxLength} chars.`,
  ),
  description: z
    .string()
    .max(INTERACTIVE_LIMITS.listRowDescriptionMaxLength)
    .optional(),
  next_node_key: nextNodeKeySchema,
});

export const flowSendListConfigSchema = z
  .looseObject({
    text: requiredText("Message text is required."),
    button_label: requiredText("Button label is required."),
    header_text: z.string().optional(),
    footer_text: z.string().optional(),
    sections: z
      .array(
        z.looseObject({
          title: z.string().optional(),
          rows: z.array(listRowSchema),
        }),
      )
      .min(1, "At least one section is required."),
  })
  .superRefine((config, ctx) => {
    const rows = config.sections.flatMap((section) => section.rows);
    if (rows.length < 1) {
      ctx.addIssue({
        code: "custom",
        path: ["sections"],
        message: "At least one list row is required.",
      });
    }
    if (rows.length > INTERACTIVE_LIMITS.maxListRowsTotal) {
      ctx.addIssue({
        code: "custom",
        path: ["sections"],
        message: `at most ${INTERACTIVE_LIMITS.maxListRowsTotal} list rows are allowed.`,
      });
    }
    const seen = new Set<string>();
    config.sections.forEach((section, sectionIndex) => {
      section.rows.forEach((row, rowIndex) => {
        if (seen.has(row.reply_id)) {
          ctx.addIssue({
            code: "custom",
            path: ["sections", sectionIndex, "rows", rowIndex, "reply_id"],
            message: `Duplicate list row id "${row.reply_id}".`,
          });
        }
        seen.add(row.reply_id);
      });
    });
  });

const legacyInteractiveButtonSchema = z.looseObject({
  id: requiredText("Button id is required."),
  title: requiredText("Button title is required.").max(
    INTERACTIVE_LIMITS.buttonTitleMaxLength,
  ),
});

const legacySendButtonsConfigSchema = z.looseObject({
  kind: z.literal("buttons"),
  body: requiredText("Message body is required."),
  header: z.string().optional(),
  footer: z.string().optional(),
  buttons: z
    .array(legacyInteractiveButtonSchema)
    .min(1)
    .max(INTERACTIVE_LIMITS.maxButtons),
  next_node_key: nextNodeKeySchema,
});

const legacyInteractiveListRowSchema = z.looseObject({
  id: requiredText("Row id is required."),
  title: requiredText("Row title is required.").max(
    INTERACTIVE_LIMITS.listRowTitleMaxLength,
  ),
  description: z
    .string()
    .max(INTERACTIVE_LIMITS.listRowDescriptionMaxLength)
    .optional(),
});

const legacySendListConfigSchema = z.looseObject({
  kind: z.literal("list"),
  body: requiredText("Message body is required."),
  header: z.string().optional(),
  footer: z.string().optional(),
  button_label: requiredText("Button label is required."),
  sections: z.array(
    z.looseObject({
      title: z.string().optional(),
      rows: z.array(legacyInteractiveListRowSchema).min(1),
    }),
  ),
  next_node_key: nextNodeKeySchema,
});

export const sendButtonsConfigSchema = z.union([
  flowSendButtonsConfigSchema,
  legacySendButtonsConfigSchema,
]);

export const sendListConfigSchema = z.union([
  flowSendListConfigSchema,
  legacySendListConfigSchema,
]);

export const sendMediaConfigSchema = z.looseObject({
  media_type: z.enum(["image", "video", "document"]),
  media_url: requiredText("A media file is required."),
  caption: z.string().max(INTERACTIVE_LIMITS.bodyMaxLength).optional(),
  filename: z.string().optional(),
  next_node_key: nextNodeKeySchema,
});

export const collectInputConfigSchema = z.looseObject({
  prompt_text: requiredText("A prompt is required."),
  var_key: requiredText("A variable key is required.").regex(
    /^[a-zA-Z_][a-zA-Z0-9_]*$/,
    "Variable key must start with a letter or underscore and contain only letters, numbers, and underscores.",
  ),
  validation: z.enum(["any", "email", "phone", "regex"]).optional(),
  regex: z.string().optional(),
  next_node_key: nextNodeKeySchema,
});

export const conditionConfigSchema = z.looseObject({
  subject: z.enum([
    "var",
    "tag",
    "contact_field",
    "tag_presence",
    "message_content",
    "time_of_day",
    "deal_stage",
  ]),
  subject_key: z.string().optional(),
  operand: z.string().optional(),
  operator: z.enum(["equals", "contains", "present", "absent"]).optional(),
  value: z.string().optional(),
  true_next: nextNodeKeySchema,
  false_next: nextNodeKeySchema,
});

export const flowConditionConfigSchema = z.looseObject({
  subject: z.enum(["var", "tag", "contact_field"]),
  subject_key: z.string().optional(),
  operator: z.enum(["equals", "contains", "present", "absent"]).optional(),
  value: z.string().optional(),
  true_next: nextNodeKeySchema,
  false_next: nextNodeKeySchema,
});

export const setTagConfigSchema = z.looseObject({
  mode: z.enum(["add", "remove"]),
  tag_id: requiredText("A tag is required."),
  next_node_key: nextNodeKeySchema,
});

export const handoffConfigSchema = z.looseObject({
  note: z.string().optional(),
  assign_to: z.string().optional(),
});

export const emptyConfigSchema = z.looseObject({});

export const linearLegacyConfigSchema = z.looseObject({
  next_node_key: nextNodeKeySchema,
});

export const sendTemplateConfigSchema = z.looseObject({
  template_name: requiredText("Template name is required."),
  language: z.string().optional(),
  variables: z.record(z.string(), z.string()).optional(),
  next_node_key: nextNodeKeySchema,
});

export const tagActionConfigSchema = z.looseObject({
  tag_id: requiredText("A tag is required."),
  next_node_key: nextNodeKeySchema,
});

export const assignConversationConfigSchema = z
  .looseObject({
    mode: z.enum(["specific", "round_robin"]),
    agent_id: z.string().optional(),
    next_node_key: nextNodeKeySchema,
  })
  .superRefine((config, ctx) => {
    if (config.mode === "specific" && !config.agent_id?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["agent_id"],
        message: "A specific assignment needs an agent.",
      });
    }
  });

export const updateContactFieldConfigSchema = z.looseObject({
  field: requiredText("A contact field is required."),
  value: z.unknown().refine(
    (value) => value !== undefined && value !== null && value !== "",
    "A contact field value is required.",
  ),
  next_node_key: nextNodeKeySchema,
});

export const createDealConfigSchema = z.looseObject({
  pipeline_id: requiredText("A pipeline is required."),
  stage_id: requiredText("A stage is required."),
  title: requiredText("A deal title is required."),
  value: z.number().optional(),
  next_node_key: nextNodeKeySchema,
});

export const moveDealStageConfigSchema = z.looseObject({
  pipeline_id: requiredText("A pipeline is required."),
  stage_id: requiredText("A stage is required."),
  next_node_key: nextNodeKeySchema,
});

export const waitConfigSchema = z.looseObject({
  amount: z.number().positive("Wait amount must be greater than zero."),
  unit: z.enum(["minutes", "hours", "days"]),
  next_node_key: nextNodeKeySchema,
});

export const webhookConfigSchema = z.looseObject({
  url: z
    .url("A valid webhook URL is required.")
    .refine(
      (value) => {
        try {
          return ["http:", "https:"].includes(new URL(value).protocol);
        } catch {
          return false;
        }
      },
      "Webhook URL must use HTTP or HTTPS.",
    ),
  headers: z.record(z.string(), z.string()).optional(),
  body_template: z.string().optional(),
  next_node_key: nextNodeKeySchema,
});

export const triggerConfigSchema = z.looseObject({
  next_node_key: nextNodeKeySchema,
});

export const keywordTriggerConfigSchema = z.looseObject({
  keywords: z
    .array(requiredText("Keywords cannot be blank."))
    .min(1, "Keyword triggers need at least one keyword."),
  match_type: z.enum(["exact", "contains"]).optional(),
  case_sensitive: z.boolean().optional(),
  next_node_key: nextNodeKeySchema,
});

export const tagTriggerConfigSchema = z.looseObject({
  tag_id: requiredText("A tag is required."),
  next_node_key: nextNodeKeySchema,
});

export const timeTriggerConfigSchema = z.looseObject({
  schedule: requiredText("A schedule is required."),
  timezone: z.string().optional(),
  next_node_key: nextNodeKeySchema,
});

export const interactiveReplyTriggerConfigSchema = z.looseObject({
  reply_ids: z.array(requiredText("Reply ids cannot be blank.")).min(1),
  next_node_key: nextNodeKeySchema,
});

export const dealStageTriggerConfigSchema = z.looseObject({
  pipeline_id: z.string().optional(),
  next_node_key: nextNodeKeySchema,
});
