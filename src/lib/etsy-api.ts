import { createHash, randomBytes } from "crypto";

/**
 * Etsy Open API v3 client.
 *
 * Auth is OAuth 2.0 with PKCE, which Etsy requires on every authorization
 * request. Access tokens last an hour and refresh tokens 90 days, so the
 * refresh token is the thing worth persisting; see etsy-tokens.ts.
 */

const OAUTH_CONNECT = "https://www.etsy.com/oauth/connect";
const OAUTH_TOKEN = "https://api.etsy.com/v3/public/oauth/token";
const API_BASE = "https://openapi.etsy.com/v3/application";

/** listings_w to create, shops_r to read the shop and its shipping profiles. */
const SCOPES = ["listings_w", "listings_r", "shops_r"];

export function keystring(): string {
  const value = process.env.ETSY_KEYSTRING;
  if (!value) {
    throw new Error("ETSY_KEYSTRING is not set. Add your Etsy app keystring to .env.local.");
  }
  return value;
}

/**
 * Since 9 February 2026 Etsy rejects API calls whose x-api-key is the keystring
 * alone; it has to carry the shared secret too. OAuth token requests are the
 * exception — those still take the bare keystring as client_id.
 * https://developer.etsy.com/documentation/essentials/authentication/
 */
export function apiKeyHeader(): string {
  const secret = process.env.ETSY_SHARED_SECRET;
  if (!secret) {
    throw new Error(
      "ETSY_SHARED_SECRET is not set. Etsy requires it alongside the keystring — add it to .env.local.",
    );
  }
  return `${keystring()}:${secret}`;
}

export function redirectUri(): string {
  return process.env.ETSY_REDIRECT_URI ?? "http://localhost:3000/api/etsy/callback";
}

export function isEtsyConfigured(): boolean {
  return Boolean(process.env.ETSY_KEYSTRING && process.env.ETSY_SHARED_SECRET);
}

/** PKCE verifier: 43-128 chars from the unreserved set Etsy specifies. */
export function createCodeVerifier(): string {
  return randomBytes(48).toString("base64url");
}

export function codeChallengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function authorizeUrl(state: string, verifier: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: keystring(),
    redirect_uri: redirectUri(),
    scope: SCOPES.join(" "),
    state,
    code_challenge: codeChallengeFor(verifier),
    code_challenge_method: "S256",
  });
  return `${OAUTH_CONNECT}?${params}`;
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/** Etsy returns errors as JSON or as plain text depending on the failure. */
async function readError(response: Response): Promise<string> {
  const body = await response.text();
  try {
    const parsed = JSON.parse(body);
    return parsed.error_description ?? parsed.error ?? body;
  } catch {
    return body.slice(0, 400);
  }
}

async function requestToken(body: Record<string, string>): Promise<TokenSet> {
  const response = await fetch(OAUTH_TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });

  if (!response.ok) {
    throw new Error(`Etsy rejected the token request (${response.status}): ${await readError(response)}`);
  }

  const token = (await response.json()) as TokenResponse;
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    // A minute of slack so a token that is about to lapse is refreshed first.
    expiresAt: Date.now() + (token.expires_in - 60) * 1000,
  };
}

export function exchangeCode(code: string, verifier: string): Promise<TokenSet> {
  return requestToken({
    grant_type: "authorization_code",
    client_id: keystring(),
    redirect_uri: redirectUri(),
    code,
    code_verifier: verifier,
  });
}

export function refreshTokens(refreshToken: string): Promise<TokenSet> {
  return requestToken({
    grant_type: "refresh_token",
    client_id: keystring(),
    refresh_token: refreshToken,
  });
}

/** Authenticated call against the v3 application API. */
export async function etsyFetch<T>(
  path: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "x-api-key": apiKeyHeader(),
      authorization: `Bearer ${accessToken}`,
      ...init.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`Etsy API ${path} failed (${response.status}): ${await readError(response)}`);
  }

  return (await response.json()) as T;
}

export interface EtsyShop {
  shopId: number;
  shopName: string;
}

export async function getShop(accessToken: string): Promise<EtsyShop> {
  const me = await etsyFetch<{ user_id: number; shop_id: number | null }>("/users/me", accessToken);

  if (!me.shop_id) {
    throw new Error("This Etsy account has no shop attached.");
  }

  const shop = await etsyFetch<{ shop_id: number; shop_name: string }>(
    `/shops/${me.shop_id}`,
    accessToken,
  );
  return { shopId: shop.shop_id, shopName: shop.shop_name };
}

export interface ShippingProfile {
  id: number;
  title: string;
}

export async function getShippingProfiles(
  accessToken: string,
  shopId: number,
): Promise<ShippingProfile[]> {
  const response = await etsyFetch<{
    results: { shipping_profile_id: number; title: string }[];
  }>(`/shops/${shopId}/shipping-profiles`, accessToken);

  return response.results.map((entry) => ({
    id: entry.shipping_profile_id,
    title: entry.title,
  }));
}

/**
 * Emoji in the description makes a draft created through the API uneditable in
 * Etsy's own listing editor — a long-standing bug on their side. The seller's
 * copy keeps whatever the model wrote; only what we send is stripped.
 */
export function stripEmoji(text: string): string {
  return text
    .replace(/[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}]/gu, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +$/gm, "");
}

export interface DraftListingInput {
  quantity: number;
  title: string;
  description: string;
  price: number;
  whoMade: "i_did" | "someone_else" | "collective";
  whenMade: string;
  taxonomyId: number;
  shippingProfileId?: number;
  tags: string[];
  materials: string[];
}

export interface CreatedListing {
  listingId: number;
  url: string;
}

/**
 * Creates the listing in DRAFT state — nothing goes live, and nothing is
 * charged, until the seller publishes it from Etsy.
 */
export async function createDraftListing(
  accessToken: string,
  shopId: number,
  input: DraftListingInput,
): Promise<CreatedListing> {
  const body: Record<string, unknown> = {
    quantity: input.quantity,
    title: input.title,
    description: stripEmoji(input.description),
    price: input.price,
    who_made: input.whoMade,
    when_made: input.whenMade,
    taxonomy_id: input.taxonomyId,
    tags: input.tags,
    materials: input.materials,
    // Physical goods; "download" would be a digital listing.
    type: "physical",
    is_supply: false,
    state: "draft",
  };

  if (input.shippingProfileId) {
    body.shipping_profile_id = input.shippingProfileId;
  }

  const created = await etsyFetch<{ listing_id: number; url?: string }>(
    `/shops/${shopId}/listings`,
    accessToken,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );

  return {
    listingId: created.listing_id,
    url: created.url ?? `https://www.etsy.com/your/shops/me/tools/listings/${created.listing_id}`,
  };
}
