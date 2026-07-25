/**
 * Curated Meta-style default message templates users can pick when
 * creating a new WhatsApp template. Shape matches TemplateFormData so
 * the editor can prefill 1:1.
 *
 * At least one simple ready-to-use template per topic for BOTH
 * Marketing and Utility. Authentication must still be created in Meta
 * WhatsApp Manager (OTP shape) and synced.
 */

import type { TemplateButton } from "@/types";

export type StarterTopic =
  | "welcome"
  | "promo"
  | "order"
  | "shipping"
  | "appointment"
  | "payment"
  | "account"
  | "feedback"
  | "reminder";

export interface WhatsAppStarterTemplate {
  id: string;
  label: string;
  description: string;
  topic: StarterTopic;
  /** Shown as "Meta library" vs "VedMint starter". */
  source: "vedmint" | "meta";
  /** Optional official Meta library_template_name when sourced from Meta. */
  library_template_name?: string;
  form: {
    name: string;
    category: "Marketing" | "Utility";
    language: string;
    header_format: "none" | "text" | "image" | "video" | "document";
    header_content: string;
    header_media_url: string;
    header_handle: string;
    header_sample: string;
    body_text: string;
    body_samples: string[];
    footer_text: string;
    buttons: TemplateButton[];
  };
}

function starter(
  partial: Omit<WhatsAppStarterTemplate, "source" | "form"> & {
    form: Partial<WhatsAppStarterTemplate["form"]> &
      Pick<
        WhatsAppStarterTemplate["form"],
        "name" | "category" | "body_text" | "body_samples"
      >;
  },
): WhatsAppStarterTemplate {
  return {
    id: partial.id,
    label: partial.label,
    description: partial.description,
    topic: partial.topic,
    source: "vedmint",
    form: {
      language: "en_US",
      header_format: "none",
      header_content: "",
      header_media_url: "",
      header_handle: "",
      header_sample: "",
      footer_text: "",
      buttons: [],
      ...partial.form,
    },
  };
}

/**
 * Default gallery — always available, no Meta connection required.
 * Coverage: every StarterTopic has ≥1 Marketing + ≥1 Utility template.
 */
export const WHATSAPP_STARTER_TEMPLATES: WhatsAppStarterTemplate[] = [
  // ── Welcome ──────────────────────────────────────────────
  starter({
    id: "mkt_welcome_offer",
    label: "Welcome offer",
    description: "Greet new customers with a simple first-purchase offer.",
    topic: "welcome",
    form: {
      name: "welcome_offer",
      category: "Marketing",
      header_format: "text",
      header_content: "Welcome!",
      body_text:
        "Hi {{1}}, thanks for joining us. Enjoy {{2}} off your first order with code {{3}}.",
      body_samples: ["Alex", "10%", "WELCOME10"],
      footer_text: "Reply STOP to opt out",
      buttons: [
        {
          type: "URL",
          text: "Shop now",
          url: "https://www.example.com/shop",
        },
      ],
    },
  }),
  starter({
    id: "util_welcome_account",
    label: "Account created",
    description: "Confirm a new account was set up successfully.",
    topic: "welcome",
    form: {
      name: "account_created",
      category: "Utility",
      header_format: "text",
      header_content: "You're all set",
      body_text:
        "Hi {{1}}, your account was created successfully. You can sign in anytime with {{2}}.",
      body_samples: ["Alex", "alex@example.com"],
      buttons: [
        {
          type: "URL",
          text: "Open account",
          url: "https://www.example.com/login",
        },
      ],
    },
  }),

  // ── Promotions ───────────────────────────────────────────
  starter({
    id: "mkt_seasonal_promo",
    label: "Seasonal promo",
    description: "Announce a limited-time sale.",
    topic: "promo",
    form: {
      name: "seasonal_promo",
      category: "Marketing",
      header_format: "text",
      header_content: "{{1}} sale",
      header_sample: "Summer",
      body_text:
        "Hi {{1}}, get {{2}} off everything until {{3}}. Tap below to shop.",
      body_samples: ["Alex", "25%", "Sunday"],
      buttons: [
        { type: "QUICK_REPLY", text: "Not now" },
        {
          type: "URL",
          text: "View deals",
          url: "https://www.example.com/deals",
        },
      ],
    },
  }),
  starter({
    id: "util_price_update",
    label: "Price update",
    description: "Notify about a confirmed price change on an item.",
    topic: "promo",
    form: {
      name: "price_update",
      category: "Utility",
      body_text:
        "Hi {{1}}, the price for {{2}} is now {{3}} as requested. Reply if you need help.",
      body_samples: ["Alex", "Annual plan", "$39/mo"],
      buttons: [
        {
          type: "URL",
          text: "View details",
          url: "https://www.example.com/pricing",
        },
      ],
    },
  }),

  // ── Orders ───────────────────────────────────────────────
  starter({
    id: "mkt_abandoned_cart",
    label: "Abandoned cart",
    description: "Remind shoppers to finish checkout.",
    topic: "order",
    form: {
      name: "abandoned_cart",
      category: "Marketing",
      header_format: "text",
      header_content: "Still interested?",
      body_text:
        "Hi {{1}}, you left {{2}} in your cart. Complete your order before it sells out.",
      body_samples: ["Alex", "2 items"],
      buttons: [
        {
          type: "URL",
          text: "Complete order",
          url: "https://www.example.com/cart",
        },
      ],
    },
  }),
  starter({
    id: "util_order_confirmation",
    label: "Order confirmation",
    description: "Confirm an order after checkout.",
    topic: "order",
    form: {
      name: "order_confirmation",
      category: "Utility",
      header_format: "text",
      header_content: "Order confirmed",
      body_text:
        "Hi {{1}}, we received order {{2}} for {{3}}. We'll notify you when it ships.",
      body_samples: ["Alex", "ORD-1042", "$49.00"],
      footer_text: "Need help? Reply to this chat",
      buttons: [
        {
          type: "URL",
          text: "View order",
          url: "https://www.example.com/orders/{{1}}",
          example: "1042",
        },
      ],
    },
  }),

  // ── Shipping ─────────────────────────────────────────────
  starter({
    id: "mkt_free_shipping",
    label: "Free shipping offer",
    description: "Promote free shipping on the next order.",
    topic: "shipping",
    form: {
      name: "free_shipping_offer",
      category: "Marketing",
      body_text:
        "Hi {{1}}, enjoy free shipping on orders over {{2}} until {{3}}. Shop now!",
      body_samples: ["Alex", "$50", "Friday"],
      buttons: [
        {
          type: "URL",
          text: "Shop now",
          url: "https://www.example.com/shop",
        },
      ],
    },
  }),
  starter({
    id: "util_shipping_update",
    label: "Shipping update",
    description: "Share tracking info when a package ships.",
    topic: "shipping",
    form: {
      name: "shipping_update",
      category: "Utility",
      header_format: "text",
      header_content: "On the way",
      body_text:
        "Hi {{1}}, order {{2}} shipped via {{3}}. Tracking: {{4}}.",
      body_samples: ["Alex", "ORD-1042", "FedEx", "1Z999AA10123456784"],
      buttons: [
        {
          type: "URL",
          text: "Track package",
          url: "https://www.example.com/track/{{1}}",
          example: "1Z999AA10123456784",
        },
      ],
    },
  }),

  // ── Appointments ─────────────────────────────────────────
  starter({
    id: "mkt_book_appointment",
    label: "Book appointment",
    description: "Invite customers to schedule a visit or call.",
    topic: "appointment",
    form: {
      name: "book_appointment",
      category: "Marketing",
      header_format: "text",
      header_content: "Book with us",
      body_text:
        "Hi {{1}}, slots are open for {{2}}. Book a free session before {{3}}.",
      body_samples: ["Alex", "consultations", "this week"],
      buttons: [
        {
          type: "URL",
          text: "Book now",
          url: "https://www.example.com/book",
        },
      ],
    },
  }),
  starter({
    id: "util_appointment_reminder",
    label: "Appointment reminder",
    description: "Remind customers of an upcoming appointment.",
    topic: "appointment",
    form: {
      name: "appointment_reminder",
      category: "Utility",
      header_format: "text",
      header_content: "Reminder",
      body_text:
        "Hi {{1}}, reminder for your {{2}} on {{3}} at {{4}}. Reply YES to confirm.",
      body_samples: ["Alex", "consultation", "25 Jul", "3:00 PM"],
      buttons: [
        { type: "QUICK_REPLY", text: "Yes" },
        { type: "QUICK_REPLY", text: "Reschedule" },
      ],
    },
  }),

  // ── Payments ─────────────────────────────────────────────
  starter({
    id: "mkt_payment_offer",
    label: "Easy pay offer",
    description: "Promote an easy-payment or EMI option.",
    topic: "payment",
    form: {
      name: "easy_pay_offer",
      category: "Marketing",
      body_text:
        "Hi {{1}}, pay for {{2}} in easy installments from {{3}}/month. Limited time.",
      body_samples: ["Alex", "Business plan", "$19"],
      buttons: [
        {
          type: "URL",
          text: "See plans",
          url: "https://www.example.com/pricing",
        },
      ],
    },
  }),
  starter({
    id: "util_payment_receipt",
    label: "Payment receipt",
    description: "Send a simple payment confirmation.",
    topic: "payment",
    form: {
      name: "payment_receipt",
      category: "Utility",
      header_format: "text",
      header_content: "Payment received",
      body_text:
        "Hi {{1}}, we received {{2}} for invoice {{3}} on {{4}}. Thank you!",
      body_samples: ["Alex", "$120.00", "INV-8891", "24 Jul"],
      buttons: [
        {
          type: "URL",
          text: "View receipt",
          url: "https://www.example.com/receipts/{{1}}",
          example: "8891",
        },
      ],
    },
  }),

  // ── Account ──────────────────────────────────────────────
  starter({
    id: "mkt_loyalty_invite",
    label: "Loyalty invite",
    description: "Invite customers to join a rewards program.",
    topic: "account",
    form: {
      name: "loyalty_invite",
      category: "Marketing",
      header_format: "text",
      header_content: "Join rewards",
      body_text:
        "Hi {{1}}, join {{2}} Rewards and earn points on every purchase. Sign up free today.",
      body_samples: ["Alex", "VedMint"],
      buttons: [
        {
          type: "URL",
          text: "Join now",
          url: "https://www.example.com/rewards",
        },
      ],
    },
  }),
  starter({
    id: "util_account_update",
    label: "Account update",
    description: "Notify about an important account change.",
    topic: "account",
    form: {
      name: "account_update",
      category: "Utility",
      header_format: "text",
      header_content: "Account update",
      body_text:
        "Hi {{1}}, your {{2}} was updated successfully. If this wasn't you, secure your account.",
      body_samples: ["Alex", "password"],
      buttons: [
        {
          type: "URL",
          text: "Secure account",
          url: "https://www.example.com/security",
        },
      ],
    },
  }),

  // ── Feedback ─────────────────────────────────────────────
  starter({
    id: "mkt_review_request",
    label: "Leave a review",
    description: "Ask happy customers to leave a public review.",
    topic: "feedback",
    form: {
      name: "leave_a_review",
      category: "Marketing",
      body_text:
        "Hi {{1}}, loved {{2}}? A quick review helps others choose us. Thanks!",
      body_samples: ["Alex", "your visit"],
      buttons: [
        {
          type: "URL",
          text: "Write review",
          url: "https://www.example.com/review",
        },
      ],
    },
  }),
  starter({
    id: "util_feedback_request",
    label: "Feedback request",
    description: "Ask for feedback after a completed order.",
    topic: "feedback",
    form: {
      name: "feedback_request",
      category: "Utility",
      body_text:
        "Hi {{1}}, thanks for order {{2}}. How was your experience? Tap below to rate us.",
      body_samples: ["Alex", "ORD-1042"],
      buttons: [
        {
          type: "URL",
          text: "Leave feedback",
          url: "https://www.example.com/feedback/{{1}}",
          example: "1042",
        },
      ],
    },
  }),

  // ── Reminders ────────────────────────────────────────────
  starter({
    id: "mkt_sale_reminder",
    label: "Sale reminder",
    description: "Last-chance reminder before a sale ends.",
    topic: "reminder",
    form: {
      name: "sale_reminder",
      category: "Marketing",
      header_format: "text",
      header_content: "Ends soon",
      body_text:
        "Hi {{1}}, {{2}} ends {{3}}. Don't miss {{4}} off — shop before it's gone.",
      body_samples: ["Alex", "Summer Sale", "tonight", "25%"],
      buttons: [
        {
          type: "URL",
          text: "Shop sale",
          url: "https://www.example.com/sale",
        },
      ],
    },
  }),
  starter({
    id: "util_renewal_reminder",
    label: "Renewal reminder",
    description: "Remind customers about an upcoming renewal.",
    topic: "reminder",
    form: {
      name: "renewal_reminder",
      category: "Utility",
      body_text:
        "Hi {{1}}, your {{2}} plan renews on {{3}} for {{4}}. Manage billing anytime below.",
      body_samples: ["Alex", "Business", "1 Aug", "$49/mo"],
      buttons: [
        {
          type: "URL",
          text: "Manage plan",
          url: "https://www.example.com/billing",
        },
      ],
    },
  }),
];

export const STARTER_TOPIC_LABELS: Record<StarterTopic | "all", string> = {
  all: "All",
  welcome: "Welcome",
  promo: "Promotions",
  order: "Orders",
  shipping: "Shipping",
  appointment: "Appointments",
  payment: "Payments",
  account: "Account",
  feedback: "Feedback",
  reminder: "Reminders",
};

/** Topics that have at least one starter in the given Meta category. */
export function topicsForCategory(
  category: "Marketing" | "Utility" | null | undefined,
): StarterTopic[] {
  const topics = new Set<StarterTopic>();
  for (const t of WHATSAPP_STARTER_TEMPLATES) {
    if (!category || t.form.category === category) {
      topics.add(t.topic);
    }
  }
  return (Object.keys(STARTER_TOPIC_LABELS) as Array<StarterTopic | "all">)
    .filter((k): k is StarterTopic => k !== "all" && topics.has(k));
}
