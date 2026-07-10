import OpenAI from "openai";
import type { AIResponse } from "../types";

const apiKey = process.env.OPENAI_API_KEY;

const client = apiKey
  ? new OpenAI({ apiKey })
  : null;

export async function generateChatGPTReply(
  message: string
): Promise<AIResponse> {

  if (!client) {
    return {
      reply: "OpenAI is not configured.",
      intent: "GENERAL_CHAT",
      confidence: 0,
      handoff: true,
    };
  }

  try {
    const response = await client.responses.create({
      model: "gpt-5.5",
      input: [
        {
          role: "system",
          content:
            "You are Relaxio Spa's AI assistant. Reply briefly, naturally, and help customers book appointments.",
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

    return {
      reply,
      intent: "GENERAL_CHAT",
      confidence: 0.9,
      handoff: false,
    };

  } catch (error) {
    console.error("OpenAI Error:", error);

    return {
      reply:
        "Sorry, I couldn't process your request right now.",
      intent: "GENERAL_CHAT",
      confidence: 0,
      handoff: true,
    };
  }
}