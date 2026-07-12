import OpenAI from "openai";
import type {
  AIResponse,
  AIIntent,
  AILeadScore,
} from "../types";
import type { AIContext } from "../context/builder";

const apiKey = process.env.OPENAI_API_KEY;

const client = apiKey
  ? new OpenAI({ apiKey })
  : null;

const modelName =
  process.env.OPENAI_MODEL ??
  "gpt-5-nano";

export async function generateChatGPTReply(
  context: AIContext
): Promise<AIResponse> {

  const message = context.message;

  if (!client) {
    return {
      reply: "OpenAI is not configured.",
      intent: "GENERAL_CHAT",
      confidence: 0,
      handoff: true,
      lead: {
        score: 0,
        grade: "COLD",
        reason: "OpenAI provider not configured",
        pipeline: "NEW",
        nextAction: "",
      },
    };
  }

  try {

    const response = await client.responses.create({
      model: modelName,
      input: [
        {
          role: "system",
          content:
            "You are Relaxio Spa's AI Sales & Booking Assistant. Reply naturally in short sentences. Convert enquiries into bookings. If the customer asks about appointments, pricing, massages, spa services or membership, guide them step by step.",
        },
        {
          role: "user",
          content: message,
        },
      ],
    });

    const reply =
      response.output_text?.trim() ||
      "Sorry, I couldn't generate a reply.";

    let intent: AIIntent = "GENERAL_CHAT";
    let handoff = false;

    const msg = message.toLowerCase();

    let lead: AILeadScore = {
  score: 40,
  grade: "WARM",
  reason: "General conversation",
  pipeline: "NEW",
  nextAction: "",
};

    if (
      msg.includes("book") ||
      msg.includes("booking") ||
      msg.includes("appointment") ||
      msg.includes("massage") ||
      msg.includes("spa")
    ) {
      intent = "BOOK_APPOINTMENT";

      lead = {
        score: 90,
        grade: "HOT",
        reason: "Booking intent detected",
        pipeline: "BOOKING",
        nextAction: "Ask preferred visit date",
      };
    } else if (
      msg.includes("price") ||
      msg.includes("pricing") ||
      msg.includes("cost") ||
      msg.includes("charge") ||
      msg.includes("rate")
    ) {
      intent = "PRICE_QUERY";

      lead = {
        score: 75,
        grade: "HOT",
        reason: "Pricing enquiry",
        pipeline: "QUALIFIED",
        nextAction: "Identify required service",
      };
    } else if (
      msg.includes("call me") ||
      msg.includes("follow up") ||
      msg.includes("later")
    ) {
      intent = "FOLLOWUP_REQUEST";

      lead = {
        score: 70,
        grade: "HOT",
        reason: "Customer requested follow-up",
        pipeline: "FOLLOW_UP",
        nextAction: "Schedule follow-up",
      };
    }

    return {
      reply,
      intent,
      confidence: 90,
      handoff,
      lead,
    };

  } catch (error) {

    console.error("OpenAI Error:", error);

    return {
      reply: "Sorry, I couldn't process your request right now.",
      intent: "GENERAL_CHAT",
      confidence: 0,
      handoff: true,
      lead: {
        score: 20,
        grade: "COLD",
        reason: "OpenAI request failed",
        pipeline: "NEW",
        nextAction: "Retry later",
      },
    };
  }
}