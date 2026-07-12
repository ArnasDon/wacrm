import type {
  AIResponse,
  AILeadScore,
} from "./types";

const bookingLead: AILeadScore = {
  score: 90,
  grade: "HOT",
  reason: "Booking intent detected",
  pipeline: "BOOKING",
  nextAction: "Ask preferred visit date",
};

const pricingLead: AILeadScore = {
  score: 75,
  grade: "HOT",
  reason: "Customer asked about pricing",
  pipeline: "QUALIFIED",
  nextAction: "Identify required service",
};

const generalLead: AILeadScore = {
  score: 40,
  grade: "WARM",
  reason: "General enquiry",
  pipeline: "NEW",
  nextAction: "",
};

export function getRuleBasedReply(
message: string,
): AIResponse | null {

const msg = message.toLowerCase();

// Pricing

if (
msg.includes("price") ||
msg.includes("cost") ||
msg.includes("charges") ||
msg.includes("rate")
) {
return {
  reply:
    "Current offers availability ke hisab se rehti hain 😊 Aap kis service ke liye inquiry kar rahe hain?",
  intent: "PRICE_QUERY",
  confidence: 95,
  handoff: false,
  lead: pricingLead,
};
}

// Offer / Discount

if (
msg.includes("offer") ||
msg.includes("discount") ||
msg.includes("deal") ||
msg.includes("coupon")
) {
return {
reply:
"Current offers availability ke hisab se rehti hain 😊 Aap kis service ke liye inquiry kar rahe hain?",
intent: "PRICE_QUERY",
confidence: 95,
handoff: false,
};
}

// Location

if (
msg.includes("location") ||
msg.includes("address") ||
msg.includes("where")
) {
return {
  reply:
    "Hamari spa branch Vivek Khand-4, Gomti Nagar me near Brijwasi Bakery ke paas hai.",
  intent: "GENERAL_CHAT",
  confidence: 95,
  handoff: false,
  lead: generalLead,
};
}

// Map

if (
msg.includes("map") ||
msg.includes("google map")
) {
return {
reply:
"Yeh hamari Google Maps location hai 😊 https://maps.app.goo.gl/9oPBpap3J5PqabsU6",
intent: "GENERAL_CHAT",
confidence: 95,
handoff: false,
lead: generalLead,
};
}

// Timing

if (
msg.includes("timing") ||
msg.includes("open") ||
msg.includes("close")
) {
return {
reply:
"Hum daily 11 AM se 8 PM tak available hain 😊 Aap kis date par visit karna chahenge?",
intent: "BOOK_APPOINTMENT",
confidence: 95,
handoff: false,
lead: bookingLead,
};
}

// Couple Spa

if (
msg.includes("couple")
) {
return {
reply:
"Couple Spa hamari popular services me se ek hai ❤️ Aap kis date ke liye booking karna chahenge?",
intent: "BOOK_APPOINTMENT",
confidence: 95,
handoff: false,
lead: bookingLead,
};
}

// Therapist Preference

if (
msg.includes("thai therapist") ||
msg.includes("nepali therapist") ||
msg.includes("indian therapist") ||
msg.includes("female therapist")
) {
return {
reply:
"Availability date aur slot ke hisab se check ki jati hai 😊 Aap kis date par visit karna chahenge?",
intent: "BOOK_APPOINTMENT",
confidence: 95,
handoff: false,
lead: bookingLead,
};
}

// Massage Services

if (
msg.includes("thai") ||
msg.includes("swedish") ||
msg.includes("balinese") ||
msg.includes("aroma") ||
msg.includes("deep tissue") ||
msg.includes("massage")
) {
return {
  reply:
    "Bilkul 😊 Aap kis date ke liye appointment book karna chahenge?",
  intent: "BOOK_APPOINTMENT",
  confidence: 95,
  handoff: false,
  lead: bookingLead,
};
}

// Booking

if (
msg.includes("book") ||
msg.includes("booking") ||
msg.includes("appointment")
) {
return {
  reply:
    "Bilkul 😊 Aap kis date ke liye appointment book karna chahenge?",
  intent: "BOOK_APPOINTMENT",
  confidence: 95,
  handoff: false,
  lead: bookingLead,
};
}

return null;
}
