import { COMPANY_NAME } from "@/lib/brand";

export type DocLink = {
  label: string;
  href: string;
  external?: boolean;
};

export type DocStep = {
  title: string;
  body: string;
  links?: DocLink[];
};

export type DocFeature = {
  id: string;
  title: string;
  href: string;
  summary: string;
  capabilities: string[];
  howToUse: string[];
  roleNote?: string;
  badge?: "Beta" | "Admin+" | "Owner only" | "Business+";
};

export type DocSection = {
  id: string;
  title: string;
};

export const DOC_PAGES = [
  {
    href: "/docs/getting-started",
    slug: "getting-started",
    label: "Getting Started",
    description: "Setup steps, features, settings, and roles",
  },
  {
    href: "/docs/whatsapp-setup",
    slug: "whatsapp-setup",
    label: "WhatsApp Setup",
    description: "Meta credentials, webhooks, and templates",
  },
  {
    href: "/docs/email-marketing",
    slug: "email-marketing",
    label: "Email Marketing",
    description: "BYO SMTP, CSV lists, starter templates & campaigns (Business+)",
  },
  {
    href: "/docs/troubleshooting",
    slug: "troubleshooting",
    label: "Troubleshooting",
    description: "Common issues and fixes",
  },
] as const;

export const GETTING_STARTED_SECTIONS: DocSection[] = [
  { id: "overview", title: "Overview" },
  { id: "implementation-plan", title: "Implementation Plan" },
  { id: "auth-team", title: "Auth & Team" },
  { id: "dashboard-features", title: "Dashboard Features" },
  { id: "settings", title: "Settings Guide" },
  { id: "cron-jobs", title: "Background Tasks" },
  { id: "roles", title: "Roles & Permissions" },
];

/** @deprecated Use GETTING_STARTED_SECTIONS — kept for any stale imports */
export const DOC_SECTIONS = GETTING_STARTED_SECTIONS;

export const IMPLEMENTATION_STEPS: DocStep[] = [
  {
    title: "Create your account",
    body:
      "Sign up at /signup with name, email, and password. Verify your email before signing in. The first user becomes the account owner.",
    links: [
      { label: "Sign Up", href: "/signup" },
      { label: "Log In", href: "/login" },
    ],
  },
  {
    title: "Create a Meta Business App",
    body:
      "Go to developers.facebook.com → My Apps → Create App → choose Business type. Add the WhatsApp product and link your WhatsApp Business Account (WABA).",
    links: [
      {
        label: "Meta for Developers",
        href: "https://developers.facebook.com",
        external: true,
      },
      { label: "WhatsApp Setup guide", href: "/docs/whatsapp-setup" },
    ],
  },
  {
    title: "Collect WhatsApp API credentials",
    body:
      "From WhatsApp → API Setup copy Phone Number ID and WABA ID. Generate a permanent System User access token in Business Settings → System Users.",
    links: [
      { label: "WhatsApp Setup guide", href: "/docs/whatsapp-setup" },
      { label: "WhatsApp Config", href: "/whatsapp/config" },
    ],
  },
  {
    title: `Save credentials in ${COMPANY_NAME}`,
    body:
      "Open Settings → WhatsApp Config. Enter Phone Number ID, WABA ID, permanent access token, webhook verify token, and the 6-digit two-step verification PIN. Click Save — the app verifies with Meta, encrypts tokens, registers the number, and subscribes the WABA.",
    links: [
      { label: "WhatsApp Setup guide", href: "/docs/whatsapp-setup" },
      { label: "WhatsApp Config", href: "/whatsapp/config" },
    ],
  },
  {
    title: "Configure Meta webhooks",
    body:
      "In Meta → WhatsApp → Configuration → Webhook, paste the callback URL from WhatsApp Config, use the same verify token as in the app, subscribe to the messages field, and set API version to v25.0.",
    links: [
      { label: "WhatsApp Setup guide", href: "/docs/whatsapp-setup" },
      { label: "WhatsApp Config", href: "/whatsapp/config" },
    ],
  },
  {
    title: "Add Meta App Secret",
    body:
      "Save your Meta App Secret in Settings → App Secret. Without this, inbound webhook POSTs fail HMAC verification.",
    links: [{ label: "App Secret", href: "/whatsapp/app-secret" }],
  },
  {
    title: "Verify the connection",
    body:
      "Use Test API Connection and Verify with Meta in WhatsApp Config. Confirm registered_at is set — without registration Meta silently drops inbound events.",
    links: [{ label: "WhatsApp Config", href: "/whatsapp/config" }],
  },
  {
    title: "Create and sync message templates",
    body:
      "Create templates in Settings → Templates or sync approved templates from Meta. Templates must be approved before broadcasts and template automations can use them.",
    links: [{ label: "Templates", href: "/whatsapp/templates" }],
  },
  {
    title: "Invite your team",
    body:
      "Go to Settings → Team to invite admins, agents, or viewers. Each member shares the account WhatsApp number and inbox.",
    links: [{ label: "Team", href: "/settings?tab=members" }],
  },
  {
    title: `Start using ${COMPANY_NAME}`,
    body:
      "Import contacts, configure pipelines, set up automations, and start handling conversations from the Inbox.",
    links: [
      { label: "Inbox", href: "/inbox" },
      { label: "Contacts", href: "/contacts" },
      { label: "Automations", href: "/automations" },
    ],
  },
];

export const DASHBOARD_FEATURES: DocFeature[] = [
  {
    id: "dashboard",
    title: "Dashboard",
    href: "/dashboard",
    summary: "Real-time analytics home with metrics, charts, and quick actions.",
    capabilities: [
      "Active conversations, new contacts today, open deals value, messages sent",
      "Day-over-day deltas on all metric cards",
      "Conversations volume chart (7 / 30 / 90 days)",
      "Pipeline donut chart by stage",
      "Response time summary",
      "Cross-module activity feed",
      "My Leads panel for assigned contacts",
    ],
    howToUse: [
      "Open Dashboard from the sidebar to see account health at a glance.",
      "Use Quick Actions to jump to Contacts, Pipelines, New Broadcast, or New Automation.",
      "Review the activity feed for recent conversations, deals, broadcasts, and automations.",
    ],
  },
  {
    id: "inbox",
    title: "Inbox",
    href: "/inbox",
    summary: "Shared WhatsApp inbox for your whole team on one business number.",
    capabilities: [
      "Real-time message sync via WebSocket",
      "Conversation list with status (open / pending / closed)",
      "Assignment filters: all, mine, unassigned, by agent",
      "Send text, media, templates, reactions, and quoted replies",
      "Contact sidebar: tags, deals, notes, lead assignment",
      "Start Flow manually from contact sidebar",
      "WhatsApp connection health indicator",
    ],
    howToUse: [
      "Select a conversation from the left panel to open the thread.",
      "Use filters at the top to find unassigned or your assigned conversations.",
      "Type in the composer to reply, or pick an approved template from the template picker.",
      "Open the right sidebar to add tags, notes, deals, or assign the conversation.",
      "Deep link: /inbox?c=<conversation_id> or /inbox?assign=mine",
    ],
  },
  {
    id: "contacts",
    title: "Contacts",
    href: "/contacts",
    summary: "CRM contact database with tags, custom fields, and CSV import.",
    capabilities: [
      "Paginated contact table with search",
      "Create and edit contacts with tags and custom fields",
      "CSV import with phone deduplication",
      "Bulk select and bulk assign to team members (admin+)",
      "Assignment filters: all / assigned to me / unassigned",
      "Contact detail view with conversation history",
    ],
    howToUse: [
      "Click New Contact to add a lead manually.",
      "Use Import CSV to bulk-load contacts (phone is required).",
      "Select multiple rows and use bulk assign to distribute leads.",
      "Click a contact row to open the full detail view.",
    ],
    roleNote: "Agents can edit contacts. Admins can assign and delete.",
  },
  {
    id: "pipelines",
    title: "Pipelines",
    href: "/pipelines",
    summary: "Kanban sales pipelines with deals linked to contacts.",
    capabilities: [
      "Multiple pipelines with customizable stages",
      "Drag-and-drop deals between stages",
      "Deals linked to contacts with assignee and value",
      "Pipeline analytics widget",
      "Pipeline settings: rename, reorder, add/delete stages (admin+)",
      "Auto-seeds default pipeline on first visit",
    ],
    howToUse: [
      "Drag deal cards between columns to update stage.",
      "Click + on a column to create a new deal.",
      "Open Pipeline Settings (gear) to rename stages or add new ones.",
      "Link deals to contacts from the deal form or contact sidebar in Inbox.",
    ],
    roleNote: "Admins manage pipeline structure. Agents create and move deals.",
  },
  {
    id: "broadcasts",
    title: "Broadcasts",
    href: "/broadcasts",
    summary: "Send Meta-approved template messages to segmented audiences.",
    capabilities: [
      "4-step wizard: template → audience → variables → send",
      "Audience by all contacts, tags, custom fields, or CSV",
      "Exclude contacts by tag",
      "Per-recipient variable substitution",
      "Delivery and read tracking per recipient",
      "Draft, sending, and completed statuses with live polling",
    ],
    howToUse: [
      "Go to Broadcasts → New Broadcast.",
      "Pick an approved template from Settings → Templates first if none exist.",
      "Define audience (e.g. tag = VIP) and map template variables.",
      "Send immediately or save as draft.",
      "Open a broadcast detail page to track delivery and read rates.",
    ],
  },
  {
    id: "email-marketing",
    title: "Email Marketing",
    href: "/email",
    summary:
      "Bring your own SMTP, grow email lists, pick starter templates, and send campaigns — separate from WhatsApp broadcasts.",
    capabilities: [
      "Business & Enterprise plans only (not on Starter)",
      "Per-account SMTP (Brevo, Gmail, SES, and others) with test send",
      "Email lists with CSV file upload or paste, plus public subscribe forms",
      "Ready-made starter templates (welcome, promo, event, and more)",
      "Merge tags: {{name}}, {{email}}, {{unsubscribe_url}}",
      "Campaign wizard: list → compose → send or schedule",
      "Delivery stats (sent / failed / skipped) from your SMTP",
      "One-click unsubscribe on every campaign email",
    ],
    howToUse: [
      "Upgrade to Business or Enterprise if needed (Billing → Upgrade plan).",
      "Connect SMTP under Email → SMTP; verify and send a test email.",
      "Create a list, upload a CSV file or paste rows, or share the subscribe URL.",
      "Email → Templates → choose a starter, edit, and save.",
      "Email → Campaigns → New campaign, then send or schedule. Full guide: /docs/email-marketing.",
    ],
    roleNote:
      "Available on Business and Enterprise. Admins configure SMTP and send; agents can view lists and campaigns.",
    badge: "Business+",
  },
  {
    id: "automations",
    title: "Automations",
    href: "/automations",
    summary: "No-code automation builder triggered by WhatsApp events and schedules.",
    capabilities: [
      "Triggers: new message, first inbound, keyword, new contact, assignment, tag added, time-based",
      "Steps: send message/template, tags, assign, update field, create deal, wait, condition, webhook, close conversation",
      "Visual builder with yes/no branches",
      "Starter templates: Welcome, Out of Office, Lead Qualifier, Follow-up",
      "Toggle active/paused, duplicate, view execution logs",
    ],
    howToUse: [
      "Click New Automation or pick a starter template.",
      "Choose a trigger and configure conditions.",
      "Add steps in the visual builder — use Wait for delayed follow-ups.",
      "Activate when validation passes (broken configs cannot go live).",
      "View logs at /automations/[id]/logs for debugging.",
    ],
    roleNote: "Wait steps need background processing — see Background Tasks section.",
  },
  {
    id: "flows",
    title: "Flows",
    href: "/flows",
    summary: "Interactive multi-step conversation flows with buttons and lists.",
    capabilities: [
      "Triggers: keyword, first inbound message, manual start from Inbox",
      "Nodes: send message, buttons, list, media, collect input, condition, set tag, handoff, end",
      "Visual flow editor with drag-and-drop",
      "Run history with expandable event timeline",
      "Suppresses automations when a flow handles the message",
    ],
    howToUse: [
      "Create a flow from blank or a template on the Flows page.",
      "Build the conversation path in the visual editor.",
      "Set trigger keywords or use manual start from Inbox contact sidebar.",
      "Activate the flow when ready.",
      "Review runs at /flows/[id]/runs.",
    ],
    roleNote: "Timeouts need background processing — see Background Tasks section.",
  },
  {
    id: "settings",
    title: "Settings",
    href: "/settings",
    summary: "Account configuration: profile, WhatsApp, templates, tags, team, and appearance.",
    capabilities: [
      "Profile, password, avatar, sessions, leave team",
      "WhatsApp API credentials and registration",
      "Meta App Secret for webhook verification",
      "Message template manager with Meta sync",
      "Tag manager with colors",
      "Team invites and role management",
      "Theme accent color picker",
    ],
    howToUse: [
      "Use the tabs at the top to switch between settings sections.",
      "Admins configure WhatsApp and templates; email SMTP is under Email → SMTP. Agents have read-only access to config.",
      "Owners can optionally set personal WhatsApp credentials.",
    ],
    badge: "Admin+",
  },
  {
    id: "team",
    title: "Team",
    href: "/settings?tab=members",
    summary: "Invite teammates and manage roles across the shared account.",
    capabilities: [
      "Invite admin, agent, or viewer roles",
      "Change roles inline, remove members, revoke pending invites",
      "Owner row is protected from role changes",
      "Shared WhatsApp number and inbox for all members",
    ],
    howToUse: [
      "Open Team from the sidebar or Settings → Team tab.",
      "Click Invite Member, enter email and role.",
      "Share the invite link — recipient signs up or logs in to accept.",
    ],
    badge: "Admin+",
  },
];

export const SETTINGS_TABS: {
  tab: string;
  label: string;
  href: string;
  description: string;
  who: string;
}[] = [
  {
    tab: "profile",
    label: "Profile",
    href: "/settings?tab=profile",
    description: "Name, email, avatar, password, active sessions, leave team.",
    who: "All users",
  },
  {
    tab: "whatsapp",
    label: "WhatsApp Config",
    href: "/whatsapp/config",
    description:
      "Phone Number ID, WABA ID, access token, verify token, PIN, test connection, verify registration.",
    who: "Admin+ edit, Agent/Viewer read-only",
  },
  {
    tab: "app-secret",
    label: "App Secret",
    href: "/whatsapp/app-secret",
    description: "Meta App Secret for webhook HMAC signature verification.",
    who: "Admin+",
  },
  {
    tab: "templates",
    label: "Templates",
    href: "/whatsapp/templates",
    description:
      "Create, submit, sync, edit, and delete WhatsApp message templates. Marketing and Utility supported.",
    who: "Admin+",
  },
  {
    tab: "tags",
    label: "Tags",
    href: "/settings?tab=tags",
    description: "Account-wide tags with colors for contacts and audience segmentation.",
    who: "Admin+",
  },
  {
    tab: "appearance",
    label: "Appearance",
    href: "/settings?tab=appearance",
    description: "Dark theme accent color stored in localStorage.",
    who: "All users",
  },
  {
    tab: "members",
    label: "Team",
    href: "/settings?tab=members",
    description: "Roster, invitations, role changes, pending invite management.",
    who: "Admin+",
  },
];

export const ROLE_MATRIX: {
  role: string;
  capabilities: string;
}[] = [
  {
    role: "Viewer",
    capabilities: "Read-only access to inbox, contacts, pipelines, broadcasts, email, automations, and flows.",
  },
  {
    role: "Agent",
    capabilities:
      "Send WhatsApp messages, create/edit contacts and deals, run broadcasts, view email lists/campaigns, build automations and flows.",
  },
  {
    role: "Admin",
    capabilities:
      "Everything Agent can do, plus manage team, edit WhatsApp config, templates, tags, and pipeline structure.",
  },
  {
    role: "Owner",
    capabilities:
      "Everything Admin can do, plus delete account, transfer ownership, and optional personal WhatsApp credentials.",
  },
];

export const META_WEBHOOK_FIELDS = [
  "Callback URL: copy from WhatsApp Config in Settings",
  "Verify token: same string as in Settings → WhatsApp Config",
  "Subscribe to: messages",
  "API version: v25.0",
];

export const CRON_JOBS = [
  {
    endpoint: "Automation wait steps",
    schedule: "Every 1 minute",
    purpose:
      "Automations with Wait steps resume on the next run. Without this, delayed follow-ups stay paused.",
  },
  {
    endpoint: "Flow timeouts",
    schedule: "Every 1 minute",
    purpose:
      "Flows with input timeouts and scheduled events need periodic processing.",
  },
  {
    endpoint: "Broadcast batches",
    schedule: "As needed",
    purpose:
      "Large broadcasts are sent in batches. High-volume sends may need a scheduled processor.",
  },
  {
    endpoint: "GET /api/email/campaigns/cron",
    schedule: "Every 1–5 minutes (optional)",
    purpose:
      "Resumes stalled email campaigns and starts scheduled sends. Same secret as broadcast cron (BROADCAST_CRON_SECRET / ENCRYPTION_KEY).",
  },
];
