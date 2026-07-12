export type LeadGrade =
  | "COLD"
  | "WARM"
  | "HOT"
  | "QUALIFIED";

export interface LeadScore {

  accountId: string;

  contactId: string;

  conversationId?: string;

  score: number;

  grade: LeadGrade;

  reason: string;

  pipeline: string;

  nextAction: string;

  confidence?: number;

  intent?: string;

  updatedBy: "AI" | "MANUAL" | "SYSTEM";

}