import { refreshTokens, type TokenSet } from "./etsy-api";
import { readJson, writeJson } from "./storage";

/**
 * Where the Etsy connection is kept between requests.
 *
 * One seller, one shop, one stored token set — see storage.ts for where the
 * bytes actually land, which differs between a local run and Netlify.
 */
const TOKEN_KEY = "etsy-tokens.json";

/**
 * A process-local cache. It saves a read per request, and is only ever
 * populated from storage, so a cold start simply reads again.
 */
let cached: TokenSet | null = null;

async function load(): Promise<TokenSet | null> {
  if (cached) return cached;
  cached = await readJson<TokenSet>(TOKEN_KEY);
  return cached;
}

async function save(tokens: TokenSet): Promise<void> {
  cached = tokens;
  await writeJson(TOKEN_KEY, tokens);
}

export async function storeTokens(tokens: TokenSet): Promise<void> {
  await save(tokens);
}

export async function isConnected(): Promise<boolean> {
  // A blank refresh token is what disconnect leaves behind, so a stored value
  // is not by itself a connection.
  return Boolean((await load())?.refreshToken);
}

export async function disconnect(): Promise<void> {
  await save({ accessToken: "", refreshToken: "", expiresAt: 0 });
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
