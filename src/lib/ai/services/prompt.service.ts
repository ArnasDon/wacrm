import type {
  PromptRequest,
  PromptResponse,
} from "./prompt.types";

const DEFAULT_PROMPT = `
You are Relaxio Spa AI.

Reply naturally.

Reply briefly.

Help customers book appointments.

Always ask one question at a time.
`;

export async function getSystemPrompt(
  request: PromptRequest,
): Promise<PromptResponse> {

  return {

    prompt: DEFAULT_PROMPT,

    version: 1,

  };

}