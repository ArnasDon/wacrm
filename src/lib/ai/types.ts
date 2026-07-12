export type AIIntent =
  | "BOOK_APPOINTMENT"
  | "PRICE_QUERY"
  | "SERVICE_QUERY"
  | "MEMBERSHIP_QUERY"
  | "FOLLOWUP_REQUEST"
  | "REFUND_REQUEST"
  | "THERAPIST_PHOTO_REQUEST"
  | "HUMAN_SUPPORT"
  | "GENERAL_CHAT";

export interface AILeadScore {
  score: number;

  grade:
    | "COLD"
    | "WARM"
    | "HOT"
    | "QUALIFIED";

  reason: string;

  pipeline:
    | "NEW"
    | "QUALIFIED"
    | "BOOKING"
    | "FOLLOW_UP"
    | "LOST";

  nextAction: string;
}

export interface AIResponse {
  reply: string;

  intent: AIIntent;

  confidence: number;

  handoff: boolean;

  lead?: AILeadScore;
}