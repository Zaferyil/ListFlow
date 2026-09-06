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

/**
 * Where Etsy sends the seller back. Derived from the address the request came
 * in on, so the same build serves several Netlify sites — each seller runs
 * their own site with their own Etsy app — without a per-site variable. Etsy
 * still matches it exactly, so this address has to be registered as a callback
 * URL on that seller's Etsy app.
 */
export function redirectUri(origin?: string): string {
  if (process.env.ETSY_REDIRECT_URI) return process.env.ETSY_REDIRECT_URI;
  return `${origin ?? "http://localhost:3000"}/api/etsy/callback`;
}

/**
 * The address the browser actually used.
 *
 * `request.url` is the server's own view of it, which behind Netlify's proxy is
 * an internal address — not something Etsy would accept as a callback. The
 * forwarded headers carry the public one.
 */
export function originOf(request: Request): string {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return new URL(request.url).origin;

  const proto =
    request.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
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

export function authorizeUrl(state: string, verifier: string, origin?: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: keystring(),
    redirect_uri: redirectUri(origin),
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

export function exchangeCode(code: string, verifier: string, origin?: string): Promise<TokenSet> {
  return requestToken({
    grant_type: "authorization_code",
    client_id: keystring(),
    // Must be byte-identical to the one sent at authorize time.
    redirect_uri: redirectUri(origin),
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

export interface ProcessingProfile {
  id: number;
  label: string;
  readinessState: string;
}

/**
 * Etsy now requires every physical listing to be linked to a processing profile
 * ("readiness state"), which carries the shop's processing time. They are
 * created in the shop's settings; this only reads them.
 * https://developers.etsy.com/documentation/tutorials/migration
 */
export async function getProcessingProfiles(
  accessToken: string,
  shopId: number,
): Promise<ProcessingProfile[]> {
  const response = await etsyFetch<{
    results: {
      readiness_state_id: number;
      readiness_state: string;
      min_processing_time?: number;
      max_processing_time?: number;
      processing_time_unit?: string;
    }[];
  }>(`/shops/${shopId}/readiness-state-definitions`, accessToken);

  return response.results.map((entry) => {
    const state = entry.readiness_state === "ready_to_ship" ? "Ready to ship" : "Made to order";
    const unit = entry.processing_time_unit ?? "days";
    const span =
      entry.min_processing_time && entry.max_processing_time
        ? ` — ${entry.min_processing_time}-${entry.max_processing_time} ${unit}`
        : "";

    return { id: entry.readiness_state_id, label: `${state}${span}`, readinessState: entry.readiness_state };
  });
}

/**
 * Etsy's two custom variation slots. Print-on-demand colourways ("Blue Jean",
 * "Pepper", "Sand") are not in Etsy's fixed colour list, and blank size runs
 * vary by garment, so free text on the custom properties fits this shop where
 * the taxonomy's own value lists would not.
 * https://developer.etsy.com/documentation/tutorials/third-variation
 */
const SIZE_PROPERTY = 513;
const COLOR_PROPERTY = 514;

/** Etsy caps a single variation at 70 values. */
export const MAX_VARIATION_VALUES = 70;

export interface SizeVariation {
  name: string;
  price: number;
}

export interface VariationInput {
  /**
   * What the first menu is called on Etsy. These blanks are sold as one listing
   * covering several garments, so the values read "Short Sleeve / S" and the
   * menu is named "Size and Style" rather than "Size".
   */
  sizeLabel: string;
  sizes: SizeVariation[];
  colors: string[];
  quantity: number;
  readinessStateId: number;
}

interface InventoryProduct {
  sku: string;
  property_values: {
    property_id: number;
    property_name: string;
    value_ids: number[];
    values: string[];
  }[];
  offerings: {
    price: number;
    quantity: number;
    is_enabled: boolean;
    readiness_state_id: number;
  }[];
}

/**
 * Replaces a listing's inventory with one product per size/colour pair.
 *
 * Price hangs off size alone (price_on_property), which is what Etsy allows —
 * one property drives price — and matches how these blanks are actually
 * priced: the same colour costs more in 2XL.
 */
export async function updateListingInventory(
  accessToken: string,
  listingId: number,
  input: VariationInput,
): Promise<void> {
  const sizes = input.sizes.filter((size) => size.name.trim() && size.price > 0);
  const colors = input.colors.map((color) => color.trim()).filter(Boolean);

  if (sizes.length === 0) {
    throw new Error("Add at least one size before sending variations.");
  }
  if (sizes.length > MAX_VARIATION_VALUES || colors.length > MAX_VARIATION_VALUES) {
    throw new Error(`Etsy allows at most ${MAX_VARIATION_VALUES} values per variation.`);
  }

  // No colours means a single-axis listing rather than an empty second axis.
  const colorValues = colors.length > 0 ? colors : [null];
  const products: InventoryProduct[] = [];

  for (const size of sizes) {
    for (const color of colorValues) {
      const propertyValues = [
        {
          property_id: SIZE_PROPERTY,
          property_name: input.sizeLabel.trim() || "Size",
          value_ids: [],
          values: [size.name.trim()],
        },
      ];

      if (color !== null) {
        propertyValues.push({
          property_id: COLOR_PROPERTY,
          property_name: "Color",
          value_ids: [],
          values: [color],
        });
      }

      products.push({
        sku: "",
        property_values: propertyValues,
        offerings: [
          {
            price: size.price,
            quantity: input.quantity,
            is_enabled: true,
            readiness_state_id: input.readinessStateId,
          },
        ],
      });
    }
  }

  await etsyFetch(`/listings/${listingId}/inventory`, accessToken, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      products,
      price_on_property: [SIZE_PROPERTY],
      quantity_on_property: [],
      sku_on_property: [],
      readiness_state_on_property: [],
    }),
  });
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

/**
 * Etsy's materials field takes letters, numbers and spaces only, so the
 * catalogue's readable values ("100% ring-spun cotton") are rejected outright.
 * The hyphen goes, and "%" becomes "percent" rather than vanishing — "100
 * cotton" reads like a typo. As with the emoji strip, only what is sent
 * changes; the listing shown to the seller keeps the original wording.
 */
export function cleanMaterials(materials: string[]): string[] {
  const cleaned = materials.map((material) =>
    material
      .replace(/%/g, " percent ")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 45)
      .trim(),
  );

  return [...new Set(cleaned.filter(Boolean))];
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
  readinessStateId: number;
  tags: string[];
  materials: string[];
  /** Shipping weight for the item */
  itemWeight?: number;
  /** Unit of shipping weight: "oz", "g", "lb" */
  weightUnit?: "oz" | "g" | "lb";
  /** Item length in dimensionsUnit */
  itemLength?: number;
  /** Item width in dimensionsUnit */
  itemWidth?: number;
  /** Item height in dimensionsUnit */
  itemHeight?: number;
  /** Unit of dimensions: "in" or "cm" */
  dimensionsUnit?: "in" | "cm";
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
    readiness_state_id: input.readinessStateId,
    tags: input.tags,
    materials: cleanMaterials(input.materials),
    // Physical goods; "download" would be a digital listing.
    type: "physical",
    is_supply: false,
    state: "draft",
  };

  if (input.shippingProfileId) {
    body.shipping_profile_id = input.shippingProfileId;
  }

  // Add shipping dimensions if provided (required for physical goods on some categories)
  if (input.itemWeight !== undefined && input.weightUnit) {
    body.item_weight = input.itemWeight;
    body.item_weight_unit = input.weightUnit;
  }

  if (
    input.itemLength !== undefined &&
    input.itemWidth !== undefined &&
    input.itemHeight !== undefined &&
    input.dimensionsUnit
  ) {
    body.item_length = input.itemLength;
    body.item_width = input.itemWidth;
    body.item_height = input.itemHeight;
    body.item_dimensions_unit = input.dimensionsUnit;
  }

  const created = await etsyFetch<{ listing_id: number; url?: string }>(
    // legacy=false selects the listing flow that accepts readiness_state_id.
    `/shops/${shopId}/listings?legacy=false`,
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

/** Etsy's ceiling on listing photos. */
export const MAX_LISTING_IMAGES = 20;

/**
 * Adds one photo to a listing. Rank is the position in the gallery, starting
 * at 1 — Etsy shows rank 1 as the thumbnail buyers see in search.
 */
export async function uploadListingImage(
  accessToken: string,
  shopId: number,
  listingId: number,
  file: { name: string; type: string; bytes: Buffer },
  rank: number,
): Promise<void> {
  const form = new FormData();
  form.set("image", new Blob([new Uint8Array(file.bytes)], { type: file.type }), file.name);
  form.set("rank", String(rank));

  // No content-type header here on purpose: fetch has to set the multipart
  // boundary itself.
  await etsyFetch(`/shops/${shopId}/listings/${listingId}/images`, accessToken, {
    method: "POST",
    body: form,
  });
}
