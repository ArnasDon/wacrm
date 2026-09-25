import { describe, expect, it } from "vitest";
import { canTranscribe, filenameFor, transcriptionModel } from "./speech-formats";

const provider = (preset: string, kind = "openai_compatible") =>
  ({ preset, kind }) as Parameters<typeof canTranscribe>[0];

describe("which providers can hear", () => {
  it("accepts the ones that serve /audio/transcriptions", () => {
    expect(canTranscribe(provider("groq"))).toBe(true);
    expect(canTranscribe(provider("openai"))).toBe(true);
  });

  it("rejects chat-only providers, so a voice note isn't sent nowhere", () => {
    expect(canTranscribe(provider("nvidia"))).toBe(false);
    expect(canTranscribe(provider("kimi"))).toBe(false);
    expect(canTranscribe(provider("ollama"))).toBe(false);
    expect(canTranscribe(provider("openai", "anthropic"))).toBe(false);
    expect(canTranscribe(provider("gemini", "gemini"))).toBe(false);
  });

  it("picks each provider's own Whisper model", () => {
    expect(transcriptionModel({ preset: "groq" })).toBe("whisper-large-v3-turbo");
    expect(transcriptionModel({ preset: "openai" })).toBe("whisper-1");
  });
});

describe("filenameFor", () => {
  // The APIs sniff the extension, and WhatsApp voice notes arrive as
  // ogg/opus — send them as .bin and the request is rejected.
  it("maps WhatsApp's audio types to an extension the API accepts", () => {
    expect(filenameFor("audio/ogg; codecs=opus")).toBe("voice.ogg");
    expect(filenameFor("audio/mpeg")).toBe("voice.mp3");
    expect(filenameFor("audio/mp4")).toBe("voice.m4a");
    expect(filenameFor("audio/wav")).toBe("voice.wav");
    expect(filenameFor("audio/webm")).toBe("voice.webm");
  });

  it("falls back to ogg when WhatsApp says nothing", () => {
    expect(filenameFor(null)).toBe("voice.ogg");
    expect(filenameFor("application/octet-stream")).toBe("voice.ogg");
  });
});
