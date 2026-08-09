import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { refreshTokens, type TokenSet } from "./etsy-api";

/**
 * Where the Etsy connection is kept between requests.
 *
 * A file under .data/ is right for running this on your own machine: one
 * seller, one shop, survives restarts, and never leaves the disk. It does NOT
 * survive on a serverless host — Vercel gives each invocation a fresh, empty
 * filesystem, so a deploy there needs this swapped for a real store (Vercel KV
 * or similar). Everything else talks to load/save, so that swap is local.
 */
const TOKEN_FILE = join(process.cwd(), ".data", "etsy-tokens.json");

let cached: TokenSet | null = null;

async function load(): Promise<TokenSet | null> {
  if (cached) return cached;
  try {
    cached = JSON.parse(await readFile(TOKEN_FILE, "utf8")) as TokenSet;
    return cached;
  } catch {
    // No file yet, or unreadable — treat both as "not connected".
    return null;
  }
}

async function save(tokens: TokenSet): Promise<void> {
  cached = tokens;
  await mkdir(dirname(TOKEN_FILE), { recursive: true });
  await writeFile(TOKEN_FILE, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

export async function storeTokens(tokens: TokenSet): Promise<void> {
  await save(tokens);
}

export async function isConnected(): Promise<boolean> {
  // A blank refresh token is what disconnect leaves behind, so the file
  // existing is not by itself a connection.
  return Boolean((await load())?.refreshToken);
}

export async function disconnect(): Promise<void> {
  await save({ accessToken: "", refreshToken: "", expiresAt: 0 }).catch(() => undefined);
}

/**
 * Returns a usable access token, refreshing first when the current one has
 * expired. Throws when there is no connection, so callers can prompt for one.
 */
export async function getAccessToken(): Promise<string> {
  const tokens = await load();

  if (!tokens?.refreshToken) {
    throw new Error("Not connected to Etsy. Use Connect to Etsy first.");
  }

  if (Date.now() < tokens.expiresAt && tokens.accessToken) {
    return tokens.accessToken;
  }

  try {
    const refreshed = await refreshTokens(tokens.refreshToken);
    await save(refreshed);
    return refreshed.accessToken;
  } catch (error) {
    // A refresh token is good for 90 days; past that the seller has to
    // reauthorise, and saying so beats a raw OAuth error.
    throw new Error(
      `Etsy connection expired — connect again. (${error instanceof Error ? error.message : "refresh failed"})`,
    );
  }
}
