import Anthropic from "@anthropic-ai/sdk";

export const MODEL = process.env.LISTFLOW_MODEL ?? "claude-opus-5";

let client: Anthropic | null = null;

export function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY tanimli degil. .env.local dosyasina anahtarinizi ekleyin.",
    );
  }
  client ??= new Anthropic();
  return client;
}
