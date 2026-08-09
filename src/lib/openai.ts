import OpenAI from "openai";

/**
 * Any vision-capable model that supports strict JSON schema responses works
 * here. Override with OPENAI_MODEL to move to a newer one without a code change.
 *
 * gpt-5.4 was measured at ~6-8s per listing with clean output. gpt-5.5 is
 * slower (~26s) for no gain on this task; gpt-5.4-mini runs in ~3s but repeats
 * phrases across the title.
 */
export const MODEL = process.env.OPENAI_MODEL ?? "gpt-5.4";

let client: OpenAI | null = null;

export function getClient(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY tanimli degil. .env.local dosyasina anahtarinizi ekleyin.",
    );
  }
  client ??= new OpenAI();
  return client;
}
