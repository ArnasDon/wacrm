import { z } from "zod";

import { assertAuthorableHttpUrl } from "@/lib/flows/http-authoring-url";
import { isSafeCollectInputRegex } from "@/lib/flows/runtime-primitives";
import {
  MAX_COMPOSITE_ITERATIONS,
  MAX_SUB_FLOW_DEPTH,
} from "@/lib/flows/composite-runtime";
import { INTERACTIVE_LIMITS } from "@/lib/whatsapp/meta-api";

const requiredText = (message: string) => z.string().trim().min(1, message);
export const nextNodeKeySchema = requiredText("A next node is required.");

export const NODE_EXECUTION_POLICY_LIMITS = {
  maxAttempts: 3,
  maxIntervalMs: 5_000,
  minTimeoutMs: 100,
  maxTimeoutMs: 15_000,
} as const;

function defaultValueMatchesType(type: string, value: unknown): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return !!value && typeof value === "object" && !Array.isArray(value);
    case "null":
      return value === null;
    default:
      return false;
  }
}

export const commonExecutionPolicySchema = z
  .looseObject({
    retry: z
      .strictObject({
        max_attempts: z
          .number()
          .int()
          .min(1)
          .max(NODE_EXECUTION_POLICY_LIMITS.maxAttempts),
        interval_ms: z
          .number()
          .int()
          .min(0)
          .max(NODE_EXECUTION_POLICY_LIMITS.maxIntervalMs),
        backoff: z.enum(["fixed", "exponential"]),
      })
      .optional(),
    on_error: z.enum(["fail_run", "default_value", "fail_branch"]).optional(),
    error_next_node_key: z.string().trim().min(1).optional(),
    timeout_ms: z
      .number()
      .int()
      .min(NODE_EXECUTION_POLICY_LIMITS.minTimeoutMs)
      .max(NODE_EXECUTION_POLICY_LIMITS.maxTimeoutMs)
      .optional(),
    default_value: z
      .strictObject({
        key: z
          .string()
          .trim()
          .min(1)
          .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
        type: z.enum([
          "string",
          "number",
          "boolean",
          "object",
          "array",
          "null",
        ]),
        value: z.unknown(),
      })
      .optional(),
  })
  .superRefine((config, ctx) => {
    if (config.on_error === "fail_branch" && !config.error_next_node_key) {
      ctx.addIssue({
        code: "custom",
        path: ["error_next_node_key"],
        message: "An error branch is required when on_error is fail_branch.",
      });
    } else if (
      config.on_error !== "fail_branch" &&
      config.error_next_node_key !== undefined
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["error_next_node_key"],
        message:
          "An error branch is only allowed when on_error is fail_branch.",
      });
    }
    if (config.on_error === "default_value" && !config.default_value) {
      ctx.addIssue({
        code: "custom",
        path: ["default_value"],
        message: "A typed default value is required.",
      });
    } else if (
      config.on_error !== "default_value" &&
      config.default_value !== undefined
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["default_value"],
        message: "A default value is only allowed for default_value handling.",
      });
    }
    if (
      config.default_value &&
      !defaultValueMatchesType(
        config.default_value.type,
        config.default_value.value,
      )
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["default_value", "value"],
        message: `Default value must match type ${config.default_value.type}.`,
      });
    }
  });

export function withCommonExecutionPolicy(
  schema: z.ZodType<Record<string, unknown>>,
): z.ZodType<Record<string, unknown>> {
  return schema.superRefine((config, ctx) => {
    const policy = commonExecutionPolicySchema.safeParse(config);
    if (policy.success) return;
    for (const issue of policy.error.issues) {
      ctx.addIssue({
        code: "custom",
        path: issue.path,
        message: issue.message,
      });
    }
  });
}

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

export const collectInputConfigSchema = z
  .looseObject({
    prompt_text: requiredText("A prompt is required."),
    var_key: requiredText("A variable key is required.").regex(
      /^[a-zA-Z_][a-zA-Z0-9_]*$/,
      "Variable key must start with a letter or underscore and contain only letters, numbers, and underscores.",
    ),
    validation: z.enum(["any", "email", "phone", "regex"]).optional(),
    regex: z.string().optional(),
    next_node_key: nextNodeKeySchema,
  })
  .superRefine((config, ctx) => {
    if (config.validation === "regex") {
      if (!config.regex || !isSafeCollectInputRegex(config.regex)) {
        ctx.addIssue({
          code: "custom",
          path: ["regex"],
          message:
            "Regex must use the linear subset: anchors, literals, escapes, and character classes only.",
        });
      }
    } else if (config.regex !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["regex"],
        message: "Regex is only allowed when validation is regex.",
      });
    }
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
  value: z
    .unknown()
    .refine(
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

export const MAX_WAIT_DURATION_MS = 365 * 24 * 60 * 60 * 1_000;

export const waitConfigSchema = z
  .looseObject({
    amount: z
      .number()
      .int("Wait amount must be a whole number.")
      .positive("Wait amount must be greater than zero."),
    unit: z.enum(["minutes", "hours", "days"]),
    next_node_key: nextNodeKeySchema,
  })
  .superRefine((config, ctx) => {
    const multiplier =
      config.unit === "minutes"
        ? 60_000
        : config.unit === "hours"
          ? 3_600_000
          : 86_400_000;
    if (config.amount * multiplier > MAX_WAIT_DURATION_MS) {
      ctx.addIssue({
        code: "custom",
        path: ["amount"],
        message: "Wait duration cannot exceed 365 days.",
      });
    }
  });

const variableKeySchema = requiredText("A variable key is required.").regex(
  /^[a-zA-Z_][a-zA-Z0-9_]*$/,
  "Variable key must start with a letter or underscore and contain only letters, numbers, and underscores.",
);

export const flowVariableTypeSchema = z.enum([
  "string",
  "number",
  "boolean",
  "json",
  "contact",
  "message",
]);

export const variableSetConfigSchema = z
  .looseObject({
    assignments: z
      .array(
        z.strictObject({
          key: variableKeySchema,
          type: flowVariableTypeSchema,
          value: z.unknown(),
        }),
      )
      .min(1, "At least one variable assignment is required."),
    next_node_key: nextNodeKeySchema,
  })
  .superRefine((config, ctx) => {
    const seen = new Set<string>();
    config.assignments.forEach((assignment, index) => {
      if (seen.has(assignment.key)) {
        ctx.addIssue({
          code: "custom",
          path: ["assignments", index, "key"],
          message: `Duplicate variable assignment "${assignment.key}".`,
        });
      }
      seen.add(assignment.key);
    });
  });

export const switchOperatorSchema = z.enum([
  "equals",
  "not_equals",
  "contains",
  "present",
  "absent",
  "greater_than",
  "greater_or_equal",
  "less_than",
  "less_or_equal",
]);

export const switchConfigSchema = z
  .looseObject({
    subject: z.enum(["var", "contact_field"]),
    subject_key: requiredText("A switch subject key is required."),
    cases: z
      .array(
        z.looseObject({
          id: requiredText("A case id is required.").regex(
            /^[a-zA-Z_][a-zA-Z0-9_-]*$/,
          ),
          label: requiredText("A case label is required."),
          operator: switchOperatorSchema,
          value: z.unknown().optional(),
          next: nextNodeKeySchema,
        }),
      )
      .min(1, "At least one switch case is required.")
      .max(20, "A switch supports at most 20 cases."),
    default_next: nextNodeKeySchema,
  })
  .superRefine((config, ctx) => {
    const seen = new Set<string>();
    config.cases.forEach((entry, index) => {
      if (seen.has(entry.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["cases", index, "id"],
          message: `Duplicate switch case id "${entry.id}".`,
        });
      }
      seen.add(entry.id);
      if (
        !["present", "absent"].includes(entry.operator) &&
        entry.value === undefined
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["cases", index, "value"],
          message: "This switch operator requires a comparison value.",
        });
      }
    });
  });

export const httpRequestConfigSchema = z.looseObject({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  url: requiredText("A URL is required.").superRefine((value, ctx) => {
    try {
      assertAuthorableHttpUrl(value);
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "Unsafe HTTP URL.",
      });
    }
  }),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
  response_var: variableKeySchema,
  next_node_key: nextNodeKeySchema,
});

const compositeBranchSchema = requiredText("A branch node is required.");
const compositeLimitSchema = z
  .number()
  .int()
  .min(1)
  .max(MAX_COMPOSITE_ITERATIONS);

export const eachConfigSchema = z.looseObject({
  array_variable: variableKeySchema,
  item_variable: variableKeySchema,
  index_variable: variableKeySchema.optional(),
  max_iterations: compositeLimitSchema,
  body_next: compositeBranchSchema,
  done_next: compositeBranchSchema,
});

export const loopConfigSchema = z
  .looseObject({
    subject: z.enum(["var", "contact_field"]),
    subject_key: requiredText("A loop subject key is required."),
    operator: switchOperatorSchema,
    value: z.unknown().optional(),
    max_iterations: compositeLimitSchema,
    body_next: compositeBranchSchema,
    done_next: compositeBranchSchema,
  })
  .superRefine((config, ctx) => {
    if (
      [
        "greater_than",
        "greater_or_equal",
        "less_than",
        "less_or_equal",
      ].includes(config.operator) &&
      (typeof config.value !== "number" || !Number.isFinite(config.value))
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: "Numeric loop operators require a finite number.",
      });
    }
    if (
      !["present", "absent"].includes(config.operator) &&
      config.value === undefined
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: "This loop operator requires a comparison value.",
      });
    }
  });

const subFlowMappingSchema = z.strictObject({
  parent_key: variableKeySchema,
  child_key: variableKeySchema,
});

export const subFlowConfigSchema = z
  .looseObject({
    flow_id: requiredText("A child flow is required."),
    flow_version_id: z.string().uuid().optional(),
    input_mapping: z.array(subFlowMappingSchema).max(50).default([]),
    output_mapping: z.array(subFlowMappingSchema).max(50).default([]),
    max_depth: z.number().int().min(1).max(MAX_SUB_FLOW_DEPTH).default(8),
    next_node_key: nextNodeKeySchema,
  })
  .superRefine((config, ctx) => {
    for (const key of ["input_mapping", "output_mapping"] as const) {
      const seen = new Set<string>();
      config[key].forEach((entry, index) => {
        const destination =
          key === "input_mapping" ? entry.child_key : entry.parent_key;
        if (seen.has(destination)) {
          ctx.addIssue({
            code: "custom",
            path: [key, index],
            message: `Duplicate mapped destination "${destination}".`,
          });
        }
        seen.add(destination);
      });
    }
  });

export const pinnedSubFlowConfigSchema = subFlowConfigSchema.and(
  z.looseObject({
    flow_version_id: z.string().uuid(),
    child_entry_node_key: requiredText("A pinned child entry is required."),
  }),
);

export const aiReplyConfigSchema = z.looseObject({
  system_prompt: z.string().max(4_000).optional(),
  prompt: requiredText("An AI prompt is required.").max(8_000),
  input_variables: z.array(variableKeySchema).max(25).default([]),
  output_variable: variableKeySchema,
  max_tokens: z.number().int().min(1).max(1_024).default(256),
  next_node_key: nextNodeKeySchema,
});

export const webhookConfigSchema = z.looseObject({
  url: z.url("A valid webhook URL is required.").refine((value) => {
    try {
      return ["http:", "https:"].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }, "Webhook URL must use HTTP or HTTPS."),
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
