/**
 * Starter flow templates.
 *
 * Three pre-canned flows users can clone with one click instead of
 * building from scratch. Each template is a plain JS object describing
 * the same shape `/api/flows` PUT accepts — name, trigger config,
 * entry_node_id, fallback_policy, nodes[] — keyed by a stable
 * `slug`.
 *
 * The clone path (`/api/flows` POST with `template_slug`) creates a
 * NEW flow_row + flow_nodes rows for the user. `node_key`s are kept
 * verbatim (they're stable strings, not UUIDs, so cloning never
 * needs to rewrite edge references).
 *
 * Choosing a single static module over a DB-backed gallery for v1
 * because: (a) the set is small and changes with code releases, not
 * data; (b) keeps templates portable across self-hosted instances
 * without migrations; (c) editing in source is the lowest-friction
 * way to add the next template.
 *
 * Customer-facing copy (name, description, message bodies, button/row
 * titles, keyword lists) lives in messages/*.json under
 * `Flows.templates.<slug>.*`, not here — mirrors how
 * src/lib/automations/templates.ts handles the same problem. Resolve
 * with `resolveFlowTemplate` / `resolveAllFlowTemplates`, passing a
 * translator scoped to that namespace
 * (`useTranslations('Flows.templates')` client-side,
 * `getTranslations({ namespace: 'Flows.templates' })` server-side) —
 * otherwise a template cloned under any locale would still send
 * English message text to customers.
 */

import type {
  CollectInputNodeConfig,
  ConditionNodeConfig,
  HandoffNodeConfig,
  KeywordTriggerConfig,
  SendButtonsNodeConfig,
  SendListNodeConfig,
  SendMessageNodeConfig,
  StartNodeConfig,
} from "./types";

export type FlowTemplateNodeType =
  | "start"
  | "send_message"
  | "send_buttons"
  | "send_list"
  | "collect_input"
  | "condition"
  | "set_tag"
  | "handoff"
  | "end";

export interface FlowTemplateNode {
  node_key: string;
  node_type: FlowTemplateNodeType;
  config:
    | StartNodeConfig
    | SendMessageNodeConfig
    | SendButtonsNodeConfig
    | SendListNodeConfig
    | CollectInputNodeConfig
    | ConditionNodeConfig
    | HandoffNodeConfig
    | Record<string, unknown>;
}

export interface FlowTemplate {
  slug: string;
  name: string;
  description: string;
  /** Used by the gallery to surface a relevant icon. lucide-react name. */
  icon: "MessageSquare" | "HelpCircle" | "UserPlus";
  trigger_type: "keyword" | "first_inbound_message" | "manual";
  trigger_config: KeywordTriggerConfig | Record<string, unknown>;
  entry_node_id: string;
  nodes: FlowTemplateNode[];
}

export type FlowTemplateSlug = "welcome_menu" | "faq_bot" | "lead_capture";

/** Shared shape between next-intl's client `useTranslations` result and
 *  server `getTranslations` result — both support this call signature,
 *  including `.raw`. */
type Translator = ((
  key: string,
  values?: Record<string, string | number | Date>
) => string) & {
  /** Bypasses ICU parsing — required for copy that carries the flow
   *  engine's own `{{vars.x}}` interpolation syntax, which a plain
   *  `t()` call would try (and fail) to parse as an ICU argument. */
  raw: (key: string) => string;
};

// ============================================================
// 1. Welcome menu — the example from the owner's brief
// ============================================================
function resolveWelcomeMenu(t: Translator): FlowTemplate {
  return {
    slug: "welcome_menu",
    name: t("welcome_menu.name"),
    description: t("welcome_menu.description"),
    icon: "MessageSquare",
    trigger_type: "keyword",
    trigger_config: {
      keywords: t("welcome_menu.keywords")
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean),
      match_type: "contains",
    },
    entry_node_id: "start",
    nodes: [
      {
        node_key: "start",
        node_type: "start",
        config: { next_node_key: "welcome" },
      },
      {
        node_key: "welcome",
        node_type: "send_buttons",
        config: {
          text: t("welcome_menu.welcomeText"),
          footer_text: t("welcome_menu.welcomeFooterText"),
          buttons: [
            {
              reply_id: "existing",
              title: t("welcome_menu.existingButtonTitle"),
              next_node_key: "existing_handoff",
            },
            {
              reply_id: "new",
              title: t("welcome_menu.newButtonTitle"),
              next_node_key: "new_handoff",
            },
          ],
        } as SendButtonsNodeConfig,
      },
      {
        node_key: "existing_handoff",
        node_type: "handoff",
        config: {
          note: t("welcome_menu.existingHandoffNote"),
        } as HandoffNodeConfig,
      },
      {
        node_key: "new_handoff",
        node_type: "handoff",
        config: {
          note: t("welcome_menu.newHandoffNote"),
        } as HandoffNodeConfig,
      },
    ],
  };
}

// ============================================================
// 2. FAQ bot — list-message answers, fully automated
// ============================================================
function resolveFaqBot(t: Translator): FlowTemplate {
  return {
    slug: "faq_bot",
    name: t("faq_bot.name"),
    description: t("faq_bot.description"),
    icon: "HelpCircle",
    trigger_type: "keyword",
    trigger_config: {
      keywords: t("faq_bot.keywords")
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean),
      match_type: "contains",
    },
    entry_node_id: "start",
    nodes: [
      {
        node_key: "start",
        node_type: "start",
        config: { next_node_key: "topics" },
      },
      {
        node_key: "topics",
        node_type: "send_list",
        config: {
          text: t("faq_bot.topicsText"),
          button_label: t("faq_bot.topicsButtonLabel"),
          sections: [
            {
              title: t("faq_bot.commonQuestionsTitle"),
              rows: [
                {
                  reply_id: "hours",
                  title: t("faq_bot.hoursRowTitle"),
                  next_node_key: "answer_hours",
                },
                {
                  reply_id: "pricing",
                  title: t("faq_bot.pricingRowTitle"),
                  next_node_key: "answer_pricing",
                },
                {
                  reply_id: "refunds",
                  title: t("faq_bot.refundsRowTitle"),
                  next_node_key: "answer_refunds",
                },
              ],
            },
            {
              title: t("faq_bot.otherSectionTitle"),
              rows: [
                {
                  reply_id: "human",
                  title: t("faq_bot.humanRowTitle"),
                  next_node_key: "human_handoff",
                },
              ],
            },
          ],
        } as SendListNodeConfig,
      },
      {
        node_key: "answer_hours",
        node_type: "send_message",
        config: {
          text: t("faq_bot.hoursAnswerText"),
          next_node_key: "end",
        } as SendMessageNodeConfig,
      },
      {
        node_key: "answer_pricing",
        node_type: "send_message",
        config: {
          text: t("faq_bot.pricingAnswerText"),
          next_node_key: "end",
        } as SendMessageNodeConfig,
      },
      {
        node_key: "answer_refunds",
        node_type: "send_message",
        config: {
          text: t("faq_bot.refundsAnswerText"),
          next_node_key: "end",
        } as SendMessageNodeConfig,
      },
      {
        node_key: "human_handoff",
        node_type: "handoff",
        config: {
          note: t("faq_bot.humanHandoffNote"),
        } as HandoffNodeConfig,
      },
      {
        node_key: "end",
        node_type: "end",
        config: {},
      },
    ],
  };
}

// ============================================================
// 3. Lead capture — collect_input chain, ends in a handoff
// ============================================================
function resolveLeadCapture(t: Translator): FlowTemplate {
  return {
    slug: "lead_capture",
    name: t("lead_capture.name"),
    description: t("lead_capture.description"),
    icon: "UserPlus",
    trigger_type: "first_inbound_message",
    trigger_config: {},
    entry_node_id: "start",
    nodes: [
      {
        node_key: "start",
        node_type: "start",
        config: { next_node_key: "intro" },
      },
      {
        node_key: "intro",
        node_type: "send_message",
        config: {
          text: t("lead_capture.introText"),
          next_node_key: "ask_name",
        } as SendMessageNodeConfig,
      },
      {
        node_key: "ask_name",
        node_type: "collect_input",
        config: {
          prompt_text: t("lead_capture.askNamePrompt"),
          var_key: "name",
          next_node_key: "ask_email",
        } as CollectInputNodeConfig,
      },
      {
        node_key: "ask_email",
        node_type: "collect_input",
        config: {
          prompt_text: t.raw("lead_capture.askEmailPrompt"),
          var_key: "email",
          next_node_key: "ask_company",
        } as CollectInputNodeConfig,
      },
      {
        node_key: "ask_company",
        node_type: "collect_input",
        config: {
          prompt_text: t("lead_capture.askCompanyPrompt"),
          var_key: "company",
          next_node_key: "handoff",
        } as CollectInputNodeConfig,
      },
      {
        node_key: "handoff",
        node_type: "handoff",
        config: {
          note: t.raw("lead_capture.handoffNote"),
        } as HandoffNodeConfig,
      },
    ],
  };
}

// ============================================================
// Registry
// ============================================================

const RESOLVERS: Record<FlowTemplateSlug, (t: Translator) => FlowTemplate> = {
  welcome_menu: resolveWelcomeMenu,
  faq_bot: resolveFaqBot,
  lead_capture: resolveLeadCapture,
};

export const FLOW_TEMPLATE_SLUGS = Object.keys(
  RESOLVERS
) as FlowTemplateSlug[];

export function resolveFlowTemplate(
  slug: FlowTemplateSlug,
  t: Translator
): FlowTemplate {
  return RESOLVERS[slug](t);
}

export function resolveAllFlowTemplates(t: Translator): FlowTemplate[] {
  return FLOW_TEMPLATE_SLUGS.map((slug) => resolveFlowTemplate(slug, t));
}

export function getFlowTemplate(
  slug: string,
  t: Translator
): FlowTemplate | null {
  if (!FLOW_TEMPLATE_SLUGS.includes(slug as FlowTemplateSlug)) return null;
  return resolveFlowTemplate(slug as FlowTemplateSlug, t);
}
