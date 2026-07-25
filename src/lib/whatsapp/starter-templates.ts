/**
 * Curated Meta-style default message templates users can pick when
 * creating a new WhatsApp template. Shape matches TemplateFormData so
 * the editor can prefill 1:1.
 *
 * 50+ ready-to-use starters across Marketing + Utility topics.
 * Authentication must still be created in Meta WhatsApp Manager (OTP
 * shape) and synced.
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
  | "reminder"
  | "support"
  | "event"
  | "reengagement"
  | "alert";

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

type StarterInput = Omit<WhatsAppStarterTemplate, "source" | "form"> & {
  form: Partial<WhatsAppStarterTemplate["form"]> &
    Pick<
      WhatsAppStarterTemplate["form"],
      "name" | "category" | "body_text" | "body_samples"
    >;
};

function starter(partial: StarterInput): WhatsAppStarterTemplate {
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

function urlBtn(text: string, url: string, example?: string): TemplateButton {
  return example
    ? { type: "URL", text, url, example }
    : { type: "URL", text, url };
}

function qr(...labels: string[]): TemplateButton[] {
  return labels.map((text) => ({ type: "QUICK_REPLY" as const, text }));
}

/**
 * Default gallery — always available, no Meta connection required.
 * 54 ready-to-use templates across 13 topics.
 */
export const WHATSAPP_STARTER_TEMPLATES: WhatsAppStarterTemplate[] = [
  // ── Welcome (5) ──────────────────────────────────────────
  starter({
    id: "mkt_welcome_offer",
    label: "Welcome offer",
    description: "Greet new customers with a first-purchase offer.",
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
      buttons: [urlBtn("Shop now", "https://www.example.com/shop")],
    },
  }),
  starter({
    id: "mkt_welcome_series",
    label: "Welcome series intro",
    description: "Start an onboarding sequence for new subscribers.",
    topic: "welcome",
    form: {
      name: "welcome_series_intro",
      category: "Marketing",
      header_format: "text",
      header_content: "Glad you're here",
      body_text:
        "Hi {{1}}, welcome to {{2}}! Over the next few days we'll share tips to get the most from us.",
      body_samples: ["Alex", "VedMint"],
      buttons: [urlBtn("Get started", "https://www.example.com/start")],
    },
  }),
  starter({
    id: "mkt_new_customer_perk",
    label: "New customer perk",
    description: "Highlight a perk exclusive to first-time buyers.",
    topic: "welcome",
    form: {
      name: "new_customer_perk",
      category: "Marketing",
      body_text:
        "Hi {{1}}, as a new customer you get free {{2}} on your first order. Valid until {{3}}.",
      body_samples: ["Alex", "gift wrapping", "Sunday"],
      buttons: [urlBtn("Claim perk", "https://www.example.com/perk")],
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
      buttons: [urlBtn("Open account", "https://www.example.com/login")],
    },
  }),
  starter({
    id: "util_welcome_verify",
    label: "Verify your number",
    description: "Ask the user to confirm their WhatsApp number on file.",
    topic: "welcome",
    form: {
      name: "verify_whatsapp_number",
      category: "Utility",
      body_text:
        "Hi {{1}}, please confirm this WhatsApp number is correct for your {{2}} account.",
      body_samples: ["Alex", "customer"],
      buttons: qr("Yes, it's me", "Wrong number"),
    },
  }),

  // ── Promotions (6) ───────────────────────────────────────
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
        ...qr("Not now"),
        urlBtn("View deals", "https://www.example.com/deals"),
      ],
    },
  }),
  starter({
    id: "mkt_flash_sale",
    label: "Flash sale",
    description: "Short-window flash sale announcement.",
    topic: "promo",
    form: {
      name: "flash_sale",
      category: "Marketing",
      header_format: "text",
      header_content: "Flash sale",
      body_text:
        "Hi {{1}}, {{2}} off for the next {{3}} only. Shop before it ends!",
      body_samples: ["Alex", "40%", "6 hours"],
      footer_text: "While stocks last",
      buttons: [urlBtn("Shop flash sale", "https://www.example.com/flash")],
    },
  }),
  starter({
    id: "mkt_bundle_deal",
    label: "Bundle deal",
    description: "Promote a product bundle or combo offer.",
    topic: "promo",
    form: {
      name: "bundle_deal",
      category: "Marketing",
      body_text:
        "Hi {{1}}, save more with our {{2}} bundle — now {{3}}. Limited stock.",
      body_samples: ["Alex", "Starter Kit", "$49"],
      buttons: [urlBtn("View bundle", "https://www.example.com/bundle")],
    },
  }),
  starter({
    id: "mkt_referral_promo",
    label: "Referral reward",
    description: "Invite customers to refer friends for rewards.",
    topic: "promo",
    form: {
      name: "referral_reward",
      category: "Marketing",
      header_format: "text",
      header_content: "Share & earn",
      body_text:
        "Hi {{1}}, refer a friend and you both get {{2}}. Share your code {{3}}.",
      body_samples: ["Alex", "$10 credit", "FRIEND10"],
      buttons: [urlBtn("Share invite", "https://www.example.com/refer")],
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
      buttons: [urlBtn("View details", "https://www.example.com/pricing")],
    },
  }),
  starter({
    id: "util_coupon_applied",
    label: "Coupon applied",
    description: "Confirm a discount code was applied to an order.",
    topic: "promo",
    form: {
      name: "coupon_applied",
      category: "Utility",
      body_text:
        "Hi {{1}}, code {{2}} was applied. You saved {{3}} on order {{4}}.",
      body_samples: ["Alex", "SAVE20", "$12", "ORD-1042"],
      buttons: [urlBtn("View order", "https://www.example.com/orders")],
    },
  }),

  // ── Orders (6) ───────────────────────────────────────────
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
      buttons: [urlBtn("Complete order", "https://www.example.com/cart")],
    },
  }),
  starter({
    id: "mkt_reorder_nudge",
    label: "Reorder nudge",
    description: "Suggest reordering a frequently bought item.",
    topic: "order",
    form: {
      name: "reorder_nudge",
      category: "Marketing",
      body_text:
        "Hi {{1}}, running low on {{2}}? Reorder in one tap — last ordered {{3}}.",
      body_samples: ["Alex", "Vitamin C", "3 weeks ago"],
      buttons: [urlBtn("Reorder", "https://www.example.com/reorder")],
    },
  }),
  starter({
    id: "mkt_upsell_order",
    label: "Post-purchase upsell",
    description: "Offer a complementary product after checkout.",
    topic: "order",
    form: {
      name: "post_purchase_upsell",
      category: "Marketing",
      body_text:
        "Hi {{1}}, thanks for buying {{2}}. Add {{3}} for {{4}} more — exclusive today.",
      body_samples: ["Alex", "Starter pack", "Pro add-on", "$9"],
      buttons: [urlBtn("Add to order", "https://www.example.com/upsell")],
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
        urlBtn("View order", "https://www.example.com/orders/{{1}}", "1042"),
      ],
    },
  }),
  starter({
    id: "util_order_cancelled",
    label: "Order cancelled",
    description: "Confirm that an order was cancelled.",
    topic: "order",
    form: {
      name: "order_cancelled",
      category: "Utility",
      body_text:
        "Hi {{1}}, order {{2}} was cancelled. Refund of {{3}} will appear in {{4}} business days.",
      body_samples: ["Alex", "ORD-1042", "$49.00", "5-7"],
      buttons: [urlBtn("View status", "https://www.example.com/orders")],
    },
  }),
  starter({
    id: "util_order_ready",
    label: "Order ready for pickup",
    description: "Notify when an order is ready for store pickup.",
    topic: "order",
    form: {
      name: "order_ready_pickup",
      category: "Utility",
      header_format: "text",
      header_content: "Ready for pickup",
      body_text:
        "Hi {{1}}, order {{2}} is ready at {{3}}. Bring your ID / confirmation.",
      body_samples: ["Alex", "ORD-1042", "Downtown store"],
      buttons: qr("On my way", "Need help"),
    },
  }),

  // ── Shipping (5) ─────────────────────────────────────────
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
      buttons: [urlBtn("Shop now", "https://www.example.com/shop")],
    },
  }),
  starter({
    id: "mkt_express_shipping",
    label: "Express shipping promo",
    description: "Promote faster delivery as an upgrade.",
    topic: "shipping",
    form: {
      name: "express_shipping_promo",
      category: "Marketing",
      body_text:
        "Hi {{1}}, upgrade to express shipping for only {{2}} — arrive by {{3}}.",
      body_samples: ["Alex", "$4.99", "tomorrow"],
      buttons: [urlBtn("Upgrade shipping", "https://www.example.com/checkout")],
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
        urlBtn(
          "Track package",
          "https://www.example.com/track/{{1}}",
          "1Z999AA10123456784",
        ),
      ],
    },
  }),
  starter({
    id: "util_out_for_delivery",
    label: "Out for delivery",
    description: "Notify when a package is out for delivery.",
    topic: "shipping",
    form: {
      name: "out_for_delivery",
      category: "Utility",
      body_text:
        "Hi {{1}}, order {{2}} is out for delivery today. Expected by {{3}}.",
      body_samples: ["Alex", "ORD-1042", "8 PM"],
      buttons: [urlBtn("Track live", "https://www.example.com/track")],
    },
  }),
  starter({
    id: "util_delivered",
    label: "Delivered",
    description: "Confirm successful delivery.",
    topic: "shipping",
    form: {
      name: "order_delivered",
      category: "Utility",
      header_format: "text",
      header_content: "Delivered",
      body_text:
        "Hi {{1}}, order {{2}} was delivered on {{3}}. Enjoy! Reply if anything is missing.",
      body_samples: ["Alex", "ORD-1042", "25 Jul"],
      buttons: qr("All good", "Need help"),
    },
  }),

  // ── Appointments (5) ─────────────────────────────────────
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
      buttons: [urlBtn("Book now", "https://www.example.com/book")],
    },
  }),
  starter({
    id: "mkt_free_consultation",
    label: "Free consultation",
    description: "Offer a complimentary consult or demo.",
    topic: "appointment",
    form: {
      name: "free_consultation",
      category: "Marketing",
      body_text:
        "Hi {{1}}, book a free {{2}} consultation — no obligation. Next slots: {{3}}.",
      body_samples: ["Alex", "30-min", "Tue–Thu"],
      buttons: [urlBtn("Pick a slot", "https://www.example.com/consult")],
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
      buttons: qr("Yes", "Reschedule"),
    },
  }),
  starter({
    id: "util_appointment_confirmed",
    label: "Appointment confirmed",
    description: "Confirm a booked appointment.",
    topic: "appointment",
    form: {
      name: "appointment_confirmed",
      category: "Utility",
      body_text:
        "Hi {{1}}, your {{2}} is confirmed for {{3}} at {{4}}. See you then!",
      body_samples: ["Alex", "demo call", "28 Jul", "11:00 AM"],
      buttons: [
        urlBtn("Add to calendar", "https://www.example.com/calendar"),
        ...qr("Reschedule"),
      ],
    },
  }),
  starter({
    id: "util_appointment_cancelled",
    label: "Appointment cancelled",
    description: "Confirm an appointment was cancelled.",
    topic: "appointment",
    form: {
      name: "appointment_cancelled",
      category: "Utility",
      body_text:
        "Hi {{1}}, your {{2}} on {{3}} was cancelled. Book a new time whenever you're ready.",
      body_samples: ["Alex", "consultation", "25 Jul"],
      buttons: [urlBtn("Rebook", "https://www.example.com/book")],
    },
  }),

  // ── Payments (5) ─────────────────────────────────────────
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
      buttons: [urlBtn("See plans", "https://www.example.com/pricing")],
    },
  }),
  starter({
    id: "mkt_invoice_nudge",
    label: "Pay now offer",
    description: "Encourage early payment with a small incentive.",
    topic: "payment",
    form: {
      name: "pay_now_offer",
      category: "Marketing",
      body_text:
        "Hi {{1}}, pay invoice {{2}} by {{3}} and get {{4}} off your next bill.",
      body_samples: ["Alex", "INV-8891", "Friday", "5%"],
      buttons: [urlBtn("Pay now", "https://www.example.com/pay")],
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
        urlBtn(
          "View receipt",
          "https://www.example.com/receipts/{{1}}",
          "8891",
        ),
      ],
    },
  }),
  starter({
    id: "util_payment_due",
    label: "Payment due",
    description: "Remind about an upcoming or due invoice.",
    topic: "payment",
    form: {
      name: "payment_due",
      category: "Utility",
      body_text:
        "Hi {{1}}, invoice {{2}} for {{3}} is due on {{4}}. Pay securely below.",
      body_samples: ["Alex", "INV-8891", "$120.00", "31 Jul"],
      buttons: [urlBtn("Pay invoice", "https://www.example.com/pay")],
    },
  }),
  starter({
    id: "util_payment_failed",
    label: "Payment failed",
    description: "Notify that a payment attempt failed.",
    topic: "payment",
    form: {
      name: "payment_failed",
      category: "Utility",
      header_format: "text",
      header_content: "Action needed",
      body_text:
        "Hi {{1}}, we couldn't process {{2}} for {{3}}. Update your payment method to avoid interruption.",
      body_samples: ["Alex", "$49.00", "Business plan"],
      buttons: [urlBtn("Update payment", "https://www.example.com/billing")],
    },
  }),

  // ── Account (4) ──────────────────────────────────────────
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
      buttons: [urlBtn("Join now", "https://www.example.com/rewards")],
    },
  }),
  starter({
    id: "mkt_upgrade_plan",
    label: "Upgrade plan",
    description: "Invite users to upgrade to a higher plan.",
    topic: "account",
    form: {
      name: "upgrade_plan_offer",
      category: "Marketing",
      body_text:
        "Hi {{1}}, unlock {{2}} on {{3}} — upgrade today and save {{4}}.",
      body_samples: ["Alex", "priority support", "Business", "20%"],
      buttons: [urlBtn("Upgrade", "https://www.example.com/upgrade")],
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
      buttons: [urlBtn("Secure account", "https://www.example.com/security")],
    },
  }),
  starter({
    id: "util_password_reset",
    label: "Password reset link",
    description: "Share a secure link to reset a password.",
    topic: "account",
    form: {
      name: "password_reset_link",
      category: "Utility",
      body_text:
        "Hi {{1}}, use this link to reset your password. It expires in {{2}}.",
      body_samples: ["Alex", "30 minutes"],
      buttons: [urlBtn("Reset password", "https://www.example.com/reset")],
    },
  }),

  // ── Feedback (4) ─────────────────────────────────────────
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
      buttons: [urlBtn("Write review", "https://www.example.com/review")],
    },
  }),
  starter({
    id: "mkt_nps_survey",
    label: "NPS survey",
    description: "Ask how likely they are to recommend you.",
    topic: "feedback",
    form: {
      name: "nps_survey",
      category: "Marketing",
      body_text:
        "Hi {{1}}, how likely are you to recommend {{2}} to a friend? Tap to rate 0–10.",
      body_samples: ["Alex", "our service"],
      buttons: [urlBtn("Rate now", "https://www.example.com/nps")],
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
        urlBtn(
          "Leave feedback",
          "https://www.example.com/feedback/{{1}}",
          "1042",
        ),
      ],
    },
  }),
  starter({
    id: "util_support_csat",
    label: "Support CSAT",
    description: "Rate a support interaction after it's closed.",
    topic: "feedback",
    form: {
      name: "support_csat",
      category: "Utility",
      body_text:
        "Hi {{1}}, your ticket {{2}} is closed. How was the support experience?",
      body_samples: ["Alex", "#4821"],
      buttons: qr("Great", "Okay", "Needs work"),
    },
  }),

  // ── Reminders (4) ────────────────────────────────────────
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
      buttons: [urlBtn("Shop sale", "https://www.example.com/sale")],
    },
  }),
  starter({
    id: "mkt_wishlist_reminder",
    label: "Wishlist reminder",
    description: "Remind about items saved to a wishlist.",
    topic: "reminder",
    form: {
      name: "wishlist_reminder",
      category: "Marketing",
      body_text:
        "Hi {{1}}, {{2}} on your wishlist {{3}}. Grab it before it's gone.",
      body_samples: ["Alex", "Wireless earbuds", "is back in stock"],
      buttons: [urlBtn("View wishlist", "https://www.example.com/wishlist")],
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
      buttons: [urlBtn("Manage plan", "https://www.example.com/billing")],
    },
  }),
  starter({
    id: "util_document_reminder",
    label: "Document reminder",
    description: "Remind to submit a required document.",
    topic: "reminder",
    form: {
      name: "document_reminder",
      category: "Utility",
      body_text:
        "Hi {{1}}, please upload {{2}} by {{3}} so we can continue with {{4}}.",
      body_samples: ["Alex", "ID proof", "28 Jul", "your application"],
      buttons: [urlBtn("Upload now", "https://www.example.com/upload")],
    },
  }),

  // ── Support (4) ──────────────────────────────────────────
  starter({
    id: "mkt_priority_support",
    label: "Priority support offer",
    description: "Promote a premium or priority support plan.",
    topic: "support",
    form: {
      name: "priority_support_offer",
      category: "Marketing",
      body_text:
        "Hi {{1}}, get faster replies with {{2}} — from {{3}}/month. Upgrade anytime.",
      body_samples: ["Alex", "Priority Support", "$9"],
      buttons: [urlBtn("Upgrade support", "https://www.example.com/support")],
    },
  }),
  starter({
    id: "util_ticket_received",
    label: "Ticket received",
    description: "Acknowledge a new support request.",
    topic: "support",
    form: {
      name: "ticket_received",
      category: "Utility",
      body_text:
        "Hi {{1}}, we received your request {{2}}. Our team will reply within {{3}}.",
      body_samples: ["Alex", "#4821", "4 hours"],
      buttons: [urlBtn("View ticket", "https://www.example.com/tickets")],
    },
  }),
  starter({
    id: "util_ticket_resolved",
    label: "Ticket resolved",
    description: "Notify that a support ticket was resolved.",
    topic: "support",
    form: {
      name: "ticket_resolved",
      category: "Utility",
      header_format: "text",
      header_content: "Resolved",
      body_text:
        "Hi {{1}}, ticket {{2}} is marked resolved. Reply if you still need help.",
      body_samples: ["Alex", "#4821"],
      buttons: qr("All good", "Still need help"),
    },
  }),
  starter({
    id: "util_agent_reply_pending",
    label: "We're working on it",
    description: "Update the customer while support investigates.",
    topic: "support",
    form: {
      name: "support_in_progress",
      category: "Utility",
      body_text:
        "Hi {{1}}, we're still working on {{2}}. Next update by {{3}}. Thanks for your patience.",
      body_samples: ["Alex", "your request", "tomorrow 5 PM"],
      buttons: [urlBtn("View update", "https://www.example.com/tickets")],
    },
  }),

  // ── Events (3) ───────────────────────────────────────────
  starter({
    id: "mkt_webinar_invite",
    label: "Webinar invite",
    description: "Invite contacts to an upcoming webinar or live session.",
    topic: "event",
    form: {
      name: "webinar_invite",
      category: "Marketing",
      header_format: "text",
      header_content: "You're invited",
      body_text:
        "Hi {{1}}, join our live session on {{2}} — {{3}} at {{4}}. Seats are limited.",
      body_samples: ["Alex", "growth tips", "30 Jul", "6:00 PM"],
      buttons: [urlBtn("Reserve seat", "https://www.example.com/webinar")],
    },
  }),
  starter({
    id: "mkt_event_rsvp",
    label: "Event RSVP",
    description: "Ask for RSVP to an offline or online event.",
    topic: "event",
    form: {
      name: "event_rsvp",
      category: "Marketing",
      body_text:
        "Hi {{1}}, you're invited to {{2}} on {{3}}. Can you make it?",
      body_samples: ["Alex", "Customer Meetup", "2 Aug"],
      buttons: qr("Yes", "Maybe", "Can't attend"),
    },
  }),
  starter({
    id: "util_event_reminder",
    label: "Event reminder",
    description: "Remind registered guests about an event.",
    topic: "event",
    form: {
      name: "event_reminder",
      category: "Utility",
      body_text:
        "Hi {{1}}, reminder: {{2}} starts {{3}} at {{4}}. Here's your join link.",
      body_samples: ["Alex", "Webinar", "today", "6:00 PM"],
      buttons: [urlBtn("Join event", "https://www.example.com/join")],
    },
  }),

  // ── Re-engagement (3) ────────────────────────────────────
  starter({
    id: "mkt_we_miss_you",
    label: "We miss you",
    description: "Win back inactive customers with a soft offer.",
    topic: "reengagement",
    form: {
      name: "we_miss_you",
      category: "Marketing",
      header_format: "text",
      header_content: "Come back",
      body_text:
        "Hi {{1}}, it's been a while. Enjoy {{2}} off your next order with code {{3}}.",
      body_samples: ["Alex", "15%", "COMEBACK15"],
      footer_text: "Reply STOP to opt out",
      buttons: [urlBtn("Shop again", "https://www.example.com/shop")],
    },
  }),
  starter({
    id: "mkt_winback_exclusive",
    label: "Win-back exclusive",
    description: "Exclusive offer for lapsed customers.",
    topic: "reengagement",
    form: {
      name: "winback_exclusive",
      category: "Marketing",
      body_text:
        "Hi {{1}}, an exclusive {{2}} is waiting for you — expires {{3}}.",
      body_samples: ["Alex", "free gift with purchase", "this weekend"],
      buttons: [urlBtn("Claim offer", "https://www.example.com/winback")],
    },
  }),
  starter({
    id: "util_subscription_paused",
    label: "Subscription paused",
    description: "Confirm a subscription was paused.",
    topic: "reengagement",
    form: {
      name: "subscription_paused",
      category: "Utility",
      body_text:
        "Hi {{1}}, your {{2}} subscription is paused from {{3}}. Resume anytime below.",
      body_samples: ["Alex", "monthly box", "1 Aug"],
      buttons: [urlBtn("Resume", "https://www.example.com/subscription")],
    },
  }),

  // ── Alerts (4) ───────────────────────────────────────────
  starter({
    id: "mkt_back_in_stock",
    label: "Back in stock",
    description: "Alert waitlisted shoppers that an item is available.",
    topic: "alert",
    form: {
      name: "back_in_stock",
      category: "Marketing",
      header_format: "text",
      header_content: "Back in stock",
      body_text:
        "Hi {{1}}, {{2}} is back! Grab yours before it sells out again.",
      body_samples: ["Alex", "Pro Headphones"],
      buttons: [urlBtn("Buy now", "https://www.example.com/product")],
    },
  }),
  starter({
    id: "mkt_price_drop",
    label: "Price drop alert",
    description: "Notify when a watched item drops in price.",
    topic: "alert",
    form: {
      name: "price_drop_alert",
      category: "Marketing",
      body_text:
        "Hi {{1}}, great news — {{2}} is now {{3}} (was {{4}}). Limited time.",
      body_samples: ["Alex", "Desk Lamp", "$29", "$45"],
      buttons: [urlBtn("View deal", "https://www.example.com/deal")],
    },
  }),
  starter({
    id: "util_security_alert",
    label: "Security alert",
    description: "Alert about a new login or security event.",
    topic: "alert",
    form: {
      name: "security_alert",
      category: "Utility",
      header_format: "text",
      header_content: "Security notice",
      body_text:
        "Hi {{1}}, a new sign-in to your account was detected from {{2}} on {{3}}. Was this you?",
      body_samples: ["Alex", "Chrome · Mumbai", "25 Jul 9:12 PM"],
      buttons: qr("Yes, it was me", "Secure account"),
    },
  }),
  starter({
    id: "util_service_outage",
    label: "Service update",
    description: "Inform users about a temporary service issue.",
    topic: "alert",
    form: {
      name: "service_update",
      category: "Utility",
      body_text:
        "Hi {{1}}, we're experiencing {{2}}. We're working on a fix — ETA {{3}}.",
      body_samples: ["Alex", "slower than usual checkout", "2 hours"],
      buttons: [urlBtn("Status page", "https://www.example.com/status")],
    },
  }),
];

/** Total curated starters (for UI badges / docs). */
export const WHATSAPP_STARTER_TEMPLATE_COUNT =
  WHATSAPP_STARTER_TEMPLATES.length;

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
  support: "Support",
  event: "Events",
  reengagement: "Win-back",
  alert: "Alerts",
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
