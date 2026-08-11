/**
 * A single shared password for the whole app.
 *
 * There is one seller, so accounts would be ceremony. What this has to stop is
 * a public URL letting a stranger spend the OpenAI credit or push drafts into
 * the Etsy shop.
 *
 * Runs on the edge as well as in Node — the middleware checks every request —
 * so it uses Web Crypto rather than node:crypto.
 */

export const SESSION_COOKIE = "listflow_session";

export function appPassword(): string | null {
  const value = process.env.APP_PASSWORD;
  return value && value.length > 0 ? value : null;
}

/**
 * The cookie value: a digest of the password, so the password itself is never
 * stored in the browser and a stolen cookie cannot be read back into one.
 */
export async function sessionToken(password: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`listflow-session:${password}`),
  );

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Compares in constant time, so a wrong guess reveals nothing by how long it took. */
export function matches(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let difference = 0;
  for (let i = 0; i < a.length; i += 1) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return difference === 0;
}
