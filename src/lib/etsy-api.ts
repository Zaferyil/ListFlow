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

/**
 * listings_w to create, shops_r to read the shop and its shipping profiles,
 * transactions_r to read what actually sold. A seller connected before
 * transactions_r was asked for holds a token without it and has to reconnect —
 * Etsy grants scopes at authorization, not per call.
 */
const SCOPES = ["listings_w", "listings_r", "shops_r", "transactions_r"];

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Etsy allows ten requests a second. Anything that makes several calls to
 * answer one question — the shop report reads listings and pages through
 * transactions — can brush that limit, and a 429 is a "wait a moment", not a
 * failure worth showing the seller. Retried with a widening gap, honouring
 * Retry-After when Etsy sends one. Safe on writes too: a rejected request was
 * never carried out.
 */
const RATE_LIMIT_RETRIES = 3;

/** Authenticated call against the v3 application API. */
export async function etsyFetch<T>(
  path: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        "x-api-key": apiKeyHeader(),
        authorization: `Bearer ${accessToken}`,
        ...init.headers,
      },
    });

    if (response.status === 429 && attempt < RATE_LIMIT_RETRIES) {
      const retryAfter = Number(response.headers.get("retry-after"));
      await sleep(
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 600,
      );
      continue;
    }

    if (!response.ok) {
      throw new Error(`Etsy API ${path} failed (${response.status}): ${await readError(response)}`);
    }

    return (await response.json()) as T;
  }
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
 * The shop's own listings, titles and tags only.
 *
 * Read so a new listing can be checked against what the shop already sells —
 * two listings chasing one phrase split the shop's placements rather than
 * doubling them. Draft listings count: they are what the seller is about to
 * publish, and catching the clash before it goes live is the point.
 */
export interface ShopListingSummary {
  listingId: number;
  title: string;
  description: string;
  tags: string[];
  favorites: number;
  /** Photos on the listing. Etsy search is a grid of these. */
  imageCount: number;
  /**
   * When the listing was first created, in epoch seconds. The original rather
   * than the current timestamp, which a renewal resets — what matters is how
   * long the listing has been trying, not when it last rolled over.
   */
  createdAt: number;
  /** When Etsy retires the listing unless it renews, in epoch seconds. */
  endsAt: number;
}

interface RawListing {
  listing_id: number;
  title: string;
  description?: string;
  tags?: string[];
  num_favorers?: number;
  images?: unknown[];
  original_creation_timestamp?: number;
  created_timestamp?: number;
  ending_timestamp?: number;
}

function toSummary(entry: RawListing): ShopListingSummary {
  return {
    listingId: entry.listing_id,
    title: entry.title,
    description: entry.description ?? "",
    tags: entry.tags ?? [],
    imageCount: entry.images?.length ?? 0,
    createdAt: entry.original_creation_timestamp ?? entry.created_timestamp ?? 0,
    endsAt: entry.ending_timestamp ?? 0,
    // Etsy exposes favourites per listing but not views: there is no view or
    // visit count anywhere in the v3 schema, so "most looked at" cannot be
    // answered from the API at all.
    favorites: entry.num_favorers ?? 0,
  };
}

/**
 * Every live listing in the shop.
 *
 * Etsy caps a page at a hundred, and reading only the first page quietly
 * limited the whole report to a shop's first hundred listings — the count, the
 * audit, the never-sold list, all of it, with nothing to say a shop had more.
 * Paged through instead, with the pacing the rate limit wants.
 */
export async function getShopListings(
  accessToken: string,
  shopId: number,
  max = 1000,
): Promise<ShopListingSummary[]> {
  const listings: ShopListingSummary[] = [];
  const pageSize = 100;

  for (let offset = 0; offset < max; offset += pageSize) {
    if (offset > 0) await sleep(250);

    // includes=Images brings the photos back with the listings, so counting
    // them costs nothing beyond the page already being fetched.
    const response = await etsyFetch<{ count: number; results: RawListing[] }>(
      `/shops/${shopId}/listings?limit=${pageSize}&offset=${offset}&state=active&includes=Images`,
      accessToken,
    );

    listings.push(...response.results.map(toSummary));
    if (response.results.length < pageSize || listings.length >= response.count) break;
  }

  return listings;
}

/**
 * One listing on its own. Rewriting a single listing should not cost a walk
 * through every page of the shop to find it.
 */
export async function getListing(
  accessToken: string,
  listingId: number,
): Promise<ShopListingSummary> {
  return toSummary(await etsyFetch<RawListing>(`/listings/${listingId}?includes=Images`, accessToken));
}

/** Etsy sends money as a minor-unit amount with the divisor to apply. */
function money(value: unknown): number {
  if (typeof value === "number") return value;
  if (value && typeof value === "object") {
    const amount = (value as { amount?: number }).amount;
    const divisor = (value as { divisor?: number }).divisor;
    if (typeof amount === "number" && typeof divisor === "number" && divisor !== 0) {
      return amount / divisor;
    }
  }
  return 0;
}

export interface ShopSale {
  listingId: number;
  title: string;
  quantity: number;
  /** Unit price in the shop's currency. */
  price: number;
  currency: string;
  /** Epoch seconds, as Etsy sends it. Zero when the order is unpaid. */
  paidAt: number;
}

/**
 * What the shop has actually sold, one row per line item.
 *
 * Paged rather than taken whole: a shop with years of orders would otherwise
 * pull thousands of rows to answer a question about which designs sell.
 */
export async function getShopSales(
  accessToken: string,
  shopId: number,
  max = 500,
): Promise<ShopSale[]> {
  const sales: ShopSale[] = [];
  const pageSize = 100;

  for (let offset = 0; offset < max; offset += pageSize) {
    // Paced rather than fired back to back: the retry above recovers from a
    // 429, but not tripping the limit at all is quicker than being told to
    // wait.
    if (offset > 0) await sleep(250);

    const response = await etsyFetch<{
      count: number;
      results: {
        listing_id: number;
        title: string;
        quantity: number;
        price?: unknown;
        paid_timestamp?: number | null;
      }[];
    }>(`/shops/${shopId}/transactions?limit=${pageSize}&offset=${offset}`, accessToken);

    for (const entry of response.results) {
      sales.push({
        listingId: entry.listing_id,
        title: entry.title,
        quantity: entry.quantity,
        price: money(entry.price),
        currency:
          (entry.price as { currency_code?: string } | undefined)?.currency_code ?? "USD",
        paidAt: entry.paid_timestamp ?? 0,
      });
    }

    if (response.results.length < pageSize || sales.length >= response.count) break;
  }

  return sales;
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
 * One of the structured fields a category offers — "Holiday", "Occasion",
 * "Room" — together with the values Etsy will accept for it.
 */
export interface TaxonomyProperty {
  id: number;
  /** Etsy's own name, e.g. "holiday". */
  name: string;
  /** What a seller sees in the listing form, e.g. "Holiday". */
  displayName: string;
  values: { id: number; name: string; scaleId?: number }[];
}

/**
 * The attributes available on a category.
 *
 * Attributes are not free text: each one is a numbered property whose values
 * are themselves numbered, and both sets differ per category. Sending a name
 * where Etsy expects an id is rejected, so anything we set has to be looked up
 * here first.
 */
export async function getTaxonomyProperties(
  accessToken: string,
  taxonomyId: number,
): Promise<TaxonomyProperty[]> {
  const response = await etsyFetch<{
    results: {
      property_id: number;
      name: string;
      display_name: string;
      supports_attributes: boolean;
      possible_values?: { value_id: number; name: string; scale_id?: number | null }[];
    }[];
  }>(`/seller-taxonomy/nodes/${taxonomyId}/properties`, accessToken);

  return response.results
    // Some properties exist only to drive variations; those are not attributes
    // and setting one here would collide with the size/colour menus.
    .filter((property) => property.supports_attributes)
    .map((property) => ({
      id: property.property_id,
      name: property.name,
      displayName: property.display_name || property.name,
      values: (property.possible_values ?? []).map((value) => ({
        id: value.value_id,
        name: value.name,
        scaleId: value.scale_id ?? undefined,
      })),
    }));
}

export interface AttributeMatch {
  propertyId: number;
  valueIds: number[];
  values: string[];
  scaleId?: number;
}

/** Ignores case, punctuation and spacing so "Two-Sided" matches "two sided". */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Turns generated "Holiday: Christmas" lines into the ids Etsy accepts.
 *
 * Anything without an exact match — a property this category does not offer, a
 * value Etsy does not list for it — is dropped rather than guessed at. A
 * listing missing an attribute simply ranks on the rest; a listing carrying an
 * invented one is wrong about the product, and attributes are the part of a
 * listing buyers filter on.
 */
export function matchAttributes(text: string, properties: TaxonomyProperty[]): AttributeMatch[] {
  const matches: AttributeMatch[] = [];
  const claimed = new Set<number>();

  for (const line of text.split("\n")) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;

    const wanted = normalize(line.slice(0, separator));
    const property = properties.find(
      (entry) => normalize(entry.displayName) === wanted || normalize(entry.name) === wanted,
    );
    // One line per property; a repeat is the model restating itself.
    if (!property || claimed.has(property.id)) continue;

    const valueIds: number[] = [];
    const values: string[] = [];
    let scaleId: number | undefined;

    for (const candidate of line.slice(separator + 1).split(",")) {
      const wantedValue = normalize(candidate);
      if (!wantedValue) continue;

      const value = property.values.find((entry) => normalize(entry.name) === wantedValue);
      if (!value) continue;

      valueIds.push(value.id);
      values.push(value.name);
      scaleId ??= value.scaleId;
    }

    if (valueIds.length === 0) continue;

    claimed.add(property.id);
    matches.push({ propertyId: property.id, valueIds, values, scaleId });
  }

  return matches;
}

/** Sets one attribute on a listing. */
export async function updateListingProperty(
  accessToken: string,
  shopId: number,
  listingId: number,
  attribute: AttributeMatch,
): Promise<void> {
  const body: Record<string, unknown> = {
    value_ids: attribute.valueIds,
    values: attribute.values,
  };
  if (attribute.scaleId !== undefined) {
    body.scale_id = attribute.scaleId;
  }

  await etsyFetch(
    `/shops/${shopId}/listings/${listingId}/properties/${attribute.propertyId}`,
    accessToken,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
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
// There is no third slot: Etsy deprecated property 515 and rejects any request
// carrying it ("Property id(s) 515 are deprecated"). A third axis has to be
// folded into one of these two — see the ornament defaults in the publish route,
// which combine shape and print into a single "Style" value.

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
  /** What the second menu is called on Etsy. Defaults to "Color". */
  colorLabel?: string;
  /**
   * Show the priced menu second rather than first. Etsy orders the two menus
   * by property id, so this is what decides which one the buyer meets first —
   * an ornament leads with its shape and prices the print side underneath.
   */
  pricedMenuSecond?: boolean;
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

  // Etsy shows the menus in the order they are listed on each product, not by
  // property id, so putting the priced menu second is a matter of listing the
  // plain one first.
  const pricedProperty = input.pricedMenuSecond ? COLOR_PROPERTY : SIZE_PROPERTY;
  const plainProperty = input.pricedMenuSecond ? SIZE_PROPERTY : COLOR_PROPERTY;

  for (const size of sizes) {
    for (const color of colorValues) {
      const priced = {
        property_id: pricedProperty,
        property_name: input.sizeLabel.trim() || "Size",
        value_ids: [],
        values: [size.name.trim()],
      };
      const plain =
        color === null
          ? null
          : {
              property_id: plainProperty,
              property_name: input.colorLabel?.trim() || "Color",
              value_ids: [],
              values: [color],
            };

      const propertyValues =
        plain === null
          ? [priced]
          : input.pricedMenuSecond
            ? [plain, priced]
            : [priced, plain];

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
      price_on_property: [pricedProperty],
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
  /** Set when the buyer supplies text the seller prints onto the product. */
  personalization?: { instructions: string; required: boolean };
}

/** Etsy's ceiling on the personalization box. */
const MAX_PERSONALIZATION_CHARS = 256;

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

  if (input.personalization) {
    body.is_personalizable = true;
    body.personalization_is_required = input.personalization.required;
    body.personalization_char_count_max = MAX_PERSONALIZATION_CHARS;
    body.personalization_instructions = input.personalization.instructions;
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

/**
 * Rewrites the words on a listing that is already live.
 *
 * Title, description and tags only. Category, price, variations and photos are
 * left alone: this exists to fix wording, and every field it does not send is
 * one it cannot break.
 */
export async function updateListingText(
  accessToken: string,
  shopId: number,
  listingId: number,
  text: { title: string; description: string; tags: string[] },
): Promise<void> {
  await etsyFetch(`/shops/${shopId}/listings/${listingId}`, accessToken, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: text.title,
      description: stripEmoji(text.description),
      tags: text.tags,
    }),
  });
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
