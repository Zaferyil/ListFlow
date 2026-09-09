"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import type { Listing } from "@/lib/etsy";
import { findProduct, isOrnament as productIsOrnament } from "@/lib/products";
import { FileDrop } from "./FileDrop";
import { FOR_ETSY, prepareForUpload } from "./shrink";

interface TemplateReply {
  images?: TemplateImage[];
  /** What this request wrote, which the listing may not yet reflect. */
  saved?: TemplateImage[];
  error?: string;
}

/** How many template photos a blank may keep. All of them go on the listing. */
const MAX_TEMPLATES = 15;

/** Keeps the arranged order, adding anything the listing has not caught up
 *  with — a photo written a moment ago is not always in it yet. */
function merged(listed: TemplateImage[], saved: TemplateImage[]): TemplateImage[] {
  const known = new Set(listed.map((image) => image.name));
  return [...listed, ...saved.filter((image) => !known.has(image.name))];
}

/**
 * A request the platform cuts short comes back with no body at all, and
 * response.json() then throws "Unexpected end of JSON input" — which says
 * nothing about what went wrong. Reading it as null lets the caller report the
 * status code instead.
 */
async function readJson(response: Response): Promise<TemplateReply | null> {
  try {
    return (await response.json()) as TemplateReply;
  } catch {
    return null;
  }
}

interface ShippingProfile {
  id: number;
  title: string;
}

interface ProcessingProfile {
  id: number;
  label: string;
}

interface Status {
  configured: boolean;
  connected: boolean;
  shop?: { shopId: number; shopName: string };
  shippingProfiles?: ShippingProfile[];
  processingProfiles?: ProcessingProfile[];
  error?: string;
}

interface Category {
  id: number;
  path: string;
}

interface PublishResult {
  listing: { url: string; listingId: number };
  variations?: boolean;
  /** How many offerings were actually sent — the panel's own count does not
   *  cover the ornament defaults, which are built server-side. */
  variationCount?: number;
  variationError?: string;
  /** How many Etsy attributes were matched to real ids and set. */
  attributesSet?: number;
  attributeError?: string;
  uploaded?: number;
  imageError?: string;
}

interface TemplateImage {
  name: string;
  size: number;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Publishing settings are per-blank — a youth tee and a hoodie sit in different
 * Etsy categories and often at different prices — and they persist locally so
 * they are entered once rather than on every listing.
 */
interface PublishSettings {
  taxonomyId: number | null;
  shippingProfileId: number | null;
  readinessStateId: number | null;
  price: string;
  quantity: string;
  whoMade: "i_did" | "someone_else" | "collective";
  whenMade: string;
  variationsOn: boolean;
  /** Name of the first variation menu on Etsy. */
  sizeLabel: string;
  /** One "size = price" per line, so a size run can be pasted or edited whole. */
  sizesText: string;
  /** Name of the second variation menu. Ornaments name it for the shape. */
  colorLabel: string;
  /** One colour per line. */
  colorsText: string;
  /** Which ornament layout these values were saved under; see ORNAMENT_LAYOUT. */
  ornamentLayout?: number;
}

const DEFAULTS: PublishSettings = {
  taxonomyId: null,
  shippingProfileId: null,
  readinessStateId: null,
  price: "24.99",
  quantity: "999",
  // Print-on-demand: the seller designs it, a partner prints it. See the note
  // in the UI — Etsy expects "someone_else" plus a declared production partner
  // when a third party manufactures.
  whoMade: "i_did",
  whenMade: "made_to_order",
  variationsOn: false,
  sizeLabel: "Size and Style",
  sizesText: [
    "Short Sleeve / S = 47.99",
    "Short Sleeve / M = 47.99",
    "Short Sleeve / L = 47.99",
    "Short Sleeve / XL = 47.99",
    "Short Sleeve / 2XL = 49.91",
    "Short Sleeve / 3XL = 51.83",
    "Long Sleeve / S = 52.79",
    "Long Sleeve / M = 52.79",
    "Long Sleeve / L = 52.79",
    "Long Sleeve / XL = 52.79",
    "Long Sleeve / 2XL = 54.71",
    "Long Sleeve / 3XL = 56.63",
    "Youth / S = 38.39",
    "Youth / M = 38.39",
    "Youth / L = 38.39",
    "Youth / XL = 38.39",
  ].join("\n"),
  colorLabel: "Color",
  colorsText: "",
};

/**
 * An ornament varies on shape and on print side, which is exactly the two menus
 * Etsy allows (see etsy-api.ts). Price follows the print side — two-sided costs
 * more whatever the shape — so that is the priced list, shown second.
 */
const ORNAMENT_DEFAULTS: Pick<
  PublishSettings,
  "sizeLabel" | "sizesText" | "colorLabel" | "colorsText"
> = {
  colorLabel: "Ornament Styles",
  colorsText: ["Heart Ornament", "Round Ornament"].join("\n"),
  sizeLabel: "Print Option",
  sizesText: ["One-Sided = 16.99", "Two-Sided = 19.99"].join("\n"),
};

/**
 * Bumped whenever the ornament menus change shape. A blank saved under an
 * earlier layout holds values that mean something different now — the styles
 * used to be one combined priced list — so it is reseeded rather than read as
 * though it were current. Everything else the seller saved is kept.
 */
const ORNAMENT_LAYOUT = 2;

/**
 * "2XL = 26.99" per line. Etsy lets price vary on one property only, and for
 * these blanks that property is size — the same colour costs more in 2XL.
 */
function parseSizes(text: string): { name: string; price: number }[] {
  return text
    .split("\n")
    .map((line) => {
      const [name, price] = line.split("=");
      return { name: (name ?? "").trim(), price: Number((price ?? "").trim()) };
    })
    .filter((size) => size.name && size.price > 0);
}

function parseColors(text: string): string[] {
  const colors = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return [...new Set(colors)];
}

function settingsKey(productId: string): string {
  return `listflow.etsy.${productId}`;
}

/**
 * Saved settings win; the catalogue's colourways only prefill a blank the
 * seller has not set up yet, so editing the list is never undone by a reload.
 */
function loadSettings(productId: string, catalogColors: string): PublishSettings {
  const isOrnament = productIsOrnament(findProduct(productId));
  const fallback = {
    ...DEFAULTS,
    colorsText: catalogColors,
    ...(isOrnament ? ORNAMENT_DEFAULTS : {}),
  };
  if (typeof window === "undefined") return fallback;

  try {
    const stored = window.localStorage.getItem(settingsKey(productId));
    if (!stored) return fallback;

    const settings = { ...fallback, ...(JSON.parse(stored) as PublishSettings) };
    // Category, profiles and price are still the seller's; only the menus,
    // whose values no longer mean what they did, go back to the defaults.
    return isOrnament && settings.ornamentLayout !== ORNAMENT_LAYOUT
      ? { ...settings, ...ORNAMENT_DEFAULTS, ornamentLayout: ORNAMENT_LAYOUT }
      : settings;
  } catch {
    return fallback;
  }
}

/**
 * `listing` is null until one has been generated. The panel still renders then,
 * so the shop can be connected before or after generating — connecting reloads
 * the page, and a step that only appeared alongside a listing would vanish at
 * exactly the moment it had something to report.
 */
export function EtsyPanel({
  listing,
  productId,
  catalogColors,
}: {
  listing: Listing | null;
  productId: string;
  /** Newline-separated, so the effect below compares by value and does not
   * reset the seller's edits on every render. */
  catalogColors: string;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [settings, setSettings] = useState<PublishSettings>(DEFAULTS);
  const [search, setSearch] = useState("");
  const [result, setResult] = useState<PublishResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [callbackNote, setCallbackNote] = useState<string | null>(null);
  const [templates, setTemplates] = useState<TemplateImage[]>([]);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

  // The OAuth callback reports back through ?etsy=…; show it here rather than
  // leaving the seller to read it out of the address bar.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const message = params.get("etsy");
    if (!message) return;

    setCallbackNote(message);
    params.delete("etsy");
    const query = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (query ? `?${query}` : ""));
  }, []);

  // Settings are per-blank, so switching blanks reloads that blank's saved values.
  useEffect(() => {
    setSettings(loadSettings(productId, catalogColors));
    setResult(null);
  }, [productId, catalogColors]);

  // Template photos belong to the blank, so they reload with it.
  useEffect(() => {
    setTemplateError(null);
    setSelected([]);
    fetch(`/api/etsy/templates?productId=${encodeURIComponent(productId)}`)
      .then((response) => response.json())
      .then((body) => setTemplates(body.images ?? []))
      .catch(() => setTemplates([]));
  }, [productId]);

  async function addTemplates(files: File[]) {
    if (files.length === 0) return;
    setUploading(true);
    setTemplateError(null);

    try {
      // One photo per request: several mockups together overrun the size limit
      // Netlify puts on a function's request body, and the failure comes back
      // as an empty response rather than something worth showing.
      for (const file of files) {
        const form = new FormData();
        form.append("images", await prepareForUpload(file, FOR_ETSY));

        const response = await fetch(
          `/api/etsy/templates?productId=${encodeURIComponent(productId)}`,
          { method: "POST", body: form },
        );

        const body = await readJson(response);
        if (!response.ok) {
          throw new Error(body?.error ?? `${file.name} was not saved (${response.status}).`);
        }
        // Applied as each one lands, so a failure halfway still leaves the
        // photos that did upload on screen.
        setTemplates(merged(body?.images ?? [], body?.saved ?? []));
      }
    } catch (caught) {
      setTemplateError(caught instanceof Error ? caught.message : "Unknown error.");
    } finally {
      setUploading(false);
    }
  }

  /** Persists the arrangement, showing it immediately so dragging feels direct. */
  async function reorder(from: number, to: number) {
    if (from === to || to < 0 || to >= templates.length) return;

    const next = [...templates];
    next.splice(to, 0, ...next.splice(from, 1));
    setTemplates(next);

    const response = await fetch(
      `/api/etsy/templates?productId=${encodeURIComponent(productId)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order: next.map((image) => image.name) }),
      },
    );
    const body = await response.json();
    if (body.images) setTemplates(body.images);
  }

  async function removeSelected() {
    if (selected.length === 0) return;

    const params = new URLSearchParams({ productId });
    for (const name of selected) params.append("file", name);

    const response = await fetch(`/api/etsy/templates?${params}`, { method: "DELETE" });
    const body = await response.json();
    setTemplates(body.images ?? []);
    setSelected([]);
  }

  const product = findProduct(productId);
  const isOrnament = productIsOrnament(product);

  const update = useCallback(
    (patch: Partial<PublishSettings>) => {
      setSettings((current) => {
        const next = { ...current, ...patch };
        window.localStorage.setItem(settingsKey(productId), JSON.stringify(next));
        return next;
      });
    },
    [productId],
  );

  useEffect(() => {
    fetch("/api/etsy/status")
      .then((response) => response.json())
      .then(setStatus)
      .catch(() => setStatus({ configured: false, connected: false }));
  }, []);

  useEffect(() => {
    if (!status?.connected) return;
    fetch("/api/etsy/taxonomy")
      .then((response) => response.json())
      .then((body) => setCategories(body.categories ?? []))
      .catch(() => setCategories([]));
  }, [status?.connected]);

  async function publish() {
    if (!listing) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/etsy/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: listing.title,
          description: listing.description,
          tags: listing.tags,
          materials: listing.materials,
          attributes: listing.attributes || undefined,
          taxonomyId: settings.taxonomyId,
          shippingProfileId: settings.shippingProfileId ?? undefined,
          readinessStateId: settings.readinessStateId,
          price: Number(settings.price),
          quantity: Number(settings.quantity),
          whoMade: settings.whoMade,
          whenMade: settings.whenMade,
          productId,
          // An ornament always varies, on the two menus edited above. Sending
          // nothing here would leave the server to fall back to its own
          // built-in lists, which would quietly ignore the seller's prices.
          variations: isOrnament
            ? {
                sizeLabel: settings.sizeLabel,
                sizes: parseSizes(settings.sizesText),
                colors: parseColors(settings.colorsText),
                colorLabel: settings.colorLabel,
                pricedMenuSecond: true,
              }
            : settings.variationsOn
              ? {
                  sizeLabel: settings.sizeLabel,
                  sizes: parseSizes(settings.sizesText),
                  colors: parseColors(settings.colorsText),
                }
              : undefined,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status}).`);
      setResult(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unknown error.");
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;

  const note = callbackNote ? (
    callbackNote.startsWith("error:") ? (
      <div className="alert error">{callbackNote.slice("error:".length)}</div>
    ) : (
      <div className="alert info">Connected to Etsy.</div>
    )
  ) : null;

  if (!status.configured) {
    return (
      <div className="card">
        {note}
        <p className="hint" style={{ margin: 0 }}>
          Add <code>ETSY_KEYSTRING</code> to <code>.env.local</code> to send listings straight to
          your shop.
        </p>
      </div>
    );
  }

  if (!status.connected) {
    return (
      <div className="card">
        {note}
        {status.error && <div className="alert error">{status.error}</div>}
        <a className="primary" href="/api/etsy/connect">
          Connect to Etsy
        </a>
        <p className="hint">
          Opens Etsy so you can authorise this app for your shop. Listings are created as drafts —
          nothing goes live until you publish it yourself.
        </p>
      </div>
    );
  }

  const visibleCategories = search.trim()
    ? categories.filter((entry) => entry.path.toLowerCase().includes(search.trim().toLowerCase()))
    : categories;
  const processingProfiles = status.processingProfiles ?? [];
  const sizeCount = parseSizes(settings.sizesText).length;
  const colorCount = parseColors(settings.colorsText).length;
  const offeringCount = sizeCount * Math.max(colorCount, 1);
  // A missing decimal point turns 49.99 into 4999 and reaches Etsy silently.
  // Anything far above the rest of the run is almost certainly that typo.
  const outliers = (() => {
    const sizes = parseSizes(settings.sizesText);
    if (sizes.length < 2) return [];
    const cheapest = Math.min(...sizes.map((size) => size.price));
    return sizes.filter((size) => size.price > cheapest * 5);
  })();
  const ready =
    listing !== null &&
    settings.taxonomyId !== null &&
    settings.readinessStateId !== null &&
    Number(settings.price) > 0 &&
    // Both editors send variations, so both have to be filled in before Etsy
    // will take them.
    (!(settings.variationsOn || isOrnament) ||
      (sizeCount > 0 && settings.sizeLabel.trim().length > 0));

  return (
    <div className="card">
      {note}
      <p className="hint" style={{ marginTop: 0 }}>
        Connected to <strong>{status.shop?.shopName}</strong>.{" "}
        <button
          type="button"
          className="linklike"
          onClick={async () => {
            await fetch("/api/etsy/status", { method: "DELETE" });
            setStatus({ configured: true, connected: false });
          }}
        >
          Disconnect
        </button>
      </p>

      <div className="field">
        <label htmlFor="etsy-category">Etsy category</label>
        <input
          id="etsy-category"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search categories, e.g. t-shirt"
        />
        <select
          value={settings.taxonomyId ?? ""}
          onChange={(event) => update({ taxonomyId: Number(event.target.value) || null })}
          style={{ marginTop: "0.5rem" }}
        >
          <option value="">Choose a category…</option>
          {visibleCategories.slice(0, 200).map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.path}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="etsy-shipping">Shipping profile</label>
        <select
          id="etsy-shipping"
          value={settings.shippingProfileId ?? ""}
          onChange={(event) => update({ shippingProfileId: Number(event.target.value) || null })}
        >
          <option value="">None — set it in Etsy before publishing</option>
          {(status.shippingProfiles ?? []).map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.title}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="etsy-processing">Processing profile</label>
        <select
          id="etsy-processing"
          value={settings.readinessStateId ?? ""}
          onChange={(event) => update({ readinessStateId: Number(event.target.value) || null })}
        >
          <option value="">Choose a processing profile…</option>
          {processingProfiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.label}
            </option>
          ))}
        </select>
        {processingProfiles.length === 0 && (
          <p className="hint">
            Etsy requires one on every physical listing. Create a processing profile in your Etsy
            shop settings, then reload this page.
          </p>
        )}
      </div>

      <div className="row">
        <div className="field">
          <label htmlFor="etsy-price">Price (USD)</label>
          <input
            id="etsy-price"
            value={settings.price}
            onChange={(event) => update({ price: event.target.value })}
            inputMode="decimal"
          />
        </div>
        <div className="field">
          <label htmlFor="etsy-quantity">Quantity</label>
          <input
            id="etsy-quantity"
            value={settings.quantity}
            onChange={(event) => update({ quantity: event.target.value })}
            inputMode="numeric"
          />
        </div>
      </div>

      <div className="row">
        <div className="field">
          <label htmlFor="etsy-who">Who made it</label>
          <select
            id="etsy-who"
            value={settings.whoMade}
            onChange={(event) => update({ whoMade: event.target.value as PublishSettings["whoMade"] })}
          >
            <option value="i_did">I did</option>
            <option value="collective">A member of my shop</option>
            <option value="someone_else">Another company or person</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="etsy-when">When made</label>
          <select
            id="etsy-when"
            value={settings.whenMade}
            onChange={(event) => update({ whenMade: event.target.value })}
          >
            <option value="made_to_order">Made to order</option>
            <option value="2020_2025">2020 - 2025</option>
            <option value="2026_2026">2026</option>
          </select>
        </div>
      </div>

      {!isOrnament && (
        <>
          <div className="field">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={settings.variationsOn}
                onChange={(event) => update({ variationsOn: event.target.checked })}
              />
              Add size and colour variations
            </label>
          </div>
        </>
      )}

      {!isOrnament && settings.variationsOn && (
        <>
          <div className="field">
            <label htmlFor="etsy-size-label">Name of the first menu</label>
            <input
              id="etsy-size-label"
              value={settings.sizeLabel}
              onChange={(event) => update({ sizeLabel: event.target.value })}
              placeholder="Size and Style"
            />
          </div>

          <div className="row">
            <div className="field">
              <label htmlFor="etsy-sizes">Values and prices</label>
              <textarea
                id="etsy-sizes"
                rows={7}
                value={settings.sizesText}
                onChange={(event) => update({ sizesText: event.target.value })}
                placeholder={"Short Sleeve / S = 47.99\nLong Sleeve / S = 52.79"}
              />
            </div>
            <div className="field">
              <label htmlFor="etsy-colors">Colours</label>
              <textarea
                id="etsy-colors"
                rows={7}
                value={settings.colorsText}
                onChange={(event) => update({ colorsText: event.target.value })}
                placeholder={"Black\nWhite\nSand\nBlue Jean"}
              />
            </div>
          </div>
          {outliers.length > 0 && (
            <div className="alert warn">
              {outliers.map((size) => `${size.name} = ${size.price}`).join(", ")} —{" "}
              {outliers.length === 1 ? "this price is" : "these prices are"} far above the rest of
              the run. Check for a missing decimal point before sending.
            </div>
          )}
          <p className="hint">
            One per line, as <code>name = price</code>. The name is what the buyer picks, so it
            can carry the garment too — <code>Short Sleeve / 2XL</code>. Etsy lets price vary on one
            variation only, so it follows size — every colour of a 2XL costs the same.{" "}
            {sizeCount > 0
              ? `${offeringCount} combination${offeringCount === 1 ? "" : "s"} — ${sizeCount} size${sizeCount === 1 ? "" : "s"}${colorCount > 0 ? ` × ${colorCount} colour${colorCount === 1 ? "" : "s"}` : ", no colours"}.`
              : "No sizes recognised yet."}
          </p>
        </>
      )}

      {isOrnament && (
        <>
          <div className="row">
            <div className="field">
              <label htmlFor="etsy-ornament-shape-label">Name of the first menu</label>
              <input
                id="etsy-ornament-shape-label"
                value={settings.colorLabel}
                onChange={(event) => update({ colorLabel: event.target.value })}
                placeholder="Ornament Styles"
              />
            </div>
            <div className="field">
              <label htmlFor="etsy-ornament-print-label">Name of the second menu</label>
              <input
                id="etsy-ornament-print-label"
                value={settings.sizeLabel}
                onChange={(event) => update({ sizeLabel: event.target.value })}
                placeholder="Print Option"
              />
            </div>
          </div>

          <div className="row">
            <div className="field">
              <label htmlFor="etsy-ornament-shapes">Styles</label>
              <textarea
                id="etsy-ornament-shapes"
                rows={5}
                value={settings.colorsText}
                onChange={(event) => update({ colorsText: event.target.value })}
                placeholder={"Heart Ornament\nRound Ornament"}
              />
            </div>
            <div className="field">
              <label htmlFor="etsy-ornament-prints">Print options and prices</label>
              <textarea
                id="etsy-ornament-prints"
                rows={5}
                value={settings.sizesText}
                onChange={(event) => update({ sizesText: event.target.value })}
                placeholder={"One-Sided = 16.99\nTwo-Sided = 19.99"}
              />
            </div>
          </div>

          {outliers.length > 0 && (
            <div className="alert warn">
              {outliers.map((size) => `${size.name} = ${size.price}`).join(", ")} —{" "}
              {outliers.length === 1 ? "this price is" : "these prices are"} far above the rest of
              the run. Check for a missing decimal point before sending.
            </div>
          )}

          <p className="hint">
            One per line, and saved for this blank — rename a menu, add a style, change a price
            whenever you like. Etsy lets price vary on one menu only, so it follows the print
            option: a two-sided heart and a two-sided round cost the same. Buyers pick how many they
            want with Etsy&apos;s own quantity box, so there is no menu for it here.{" "}
            {sizeCount > 0
              ? `${offeringCount} combination${offeringCount === 1 ? "" : "s"} — ${colorCount} style${colorCount === 1 ? "" : "s"} × ${sizeCount} print option${sizeCount === 1 ? "" : "s"}.`
              : "No print options recognised yet."}
          </p>
        </>
      )}

      <div className="field">
        <label htmlFor="etsy-templates">Template photos</label>
        <FileDrop
          id="etsy-templates"
          accept="image/png,image/jpeg,image/gif"
          label={
            uploading
              ? "Uploading…"
              : templates.length >= MAX_TEMPLATES
                ? `${MAX_TEMPLATES} photos already added`
                : "Drop your template photos here"
          }
          hint={
            templates.length >= MAX_TEMPLATES
              ? `Remove one to add another — this blank keeps ${MAX_TEMPLATES}.`
              : `or click to browse — PNG, JPEG, GIF · ${MAX_TEMPLATES - templates.length} slot${MAX_TEMPLATES - templates.length === 1 ? "" : "s"} left`
          }
          disabled={uploading || templates.length >= MAX_TEMPLATES}
          onFiles={(files) => void addTemplates(files)}
        />
        {templates.length > 0 && (
          // Five to a column, then a new column beside it — ten photos stacked
          // vertically pushed the send button off the screen.
          <ul
            className="templates"
            style={{ "--rows": Math.min(templates.length, 5) } as CSSProperties}
          >
            {templates.map((image, index) => (
              <li
                key={image.name}
                draggable
                role="checkbox"
                aria-checked={selected.includes(image.name)}
                tabIndex={0}
                className={`${draggingIndex === index ? "dragging" : ""}${selected.includes(image.name) ? " selected" : ""}`}
                onClick={() =>
                  setSelected((current) =>
                    current.includes(image.name)
                      ? current.filter((name) => name !== image.name)
                      : [...current, image.name],
                  )
                }
                onKeyDown={(event) => {
                  if (event.key === " " || event.key === "Enter") {
                    event.preventDefault();
                    setSelected((current) =>
                      current.includes(image.name)
                        ? current.filter((name) => name !== image.name)
                        : [...current, image.name],
                    );
                  }
                  // Reordering is dragging, which a keyboard cannot do; alt +
                  // arrow keeps it reachable without buttons in every row.
                  if (event.altKey && event.key === "ArrowUp") {
                    event.preventDefault();
                    void reorder(index, index - 1);
                  }
                  if (event.altKey && event.key === "ArrowDown") {
                    event.preventDefault();
                    void reorder(index, index + 1);
                  }
                }}
                onDragStart={(event) => {
                  setDraggingIndex(index);
                  event.dataTransfer.effectAllowed = "move";
                  // Firefox starts no drag at all without payload.
                  event.dataTransfer.setData("text/plain", image.name);
                }}
                onDragEnd={() => setDraggingIndex(null)}
                onDragOver={(event) => {
                  if (draggingIndex === null) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }}
                onDrop={(event) => {
                  if (draggingIndex === null) return;
                  event.preventDefault();
                  event.stopPropagation();
                  void reorder(draggingIndex, index);
                  setDraggingIndex(null);
                }}
              >
                <span className="grip" aria-hidden="true">
                  ⠿
                </span>
                <img
                  src={`/api/etsy/templates?productId=${encodeURIComponent(productId)}&file=${encodeURIComponent(image.name)}`}
                  alt=""
                />
                <span>
                  <strong title={image.name}>
                    {index + 1}. {image.name}
                  </strong>
                  {formatSize(image.size)}
                </span>

              </li>
            ))}
          </ul>
        )}
        {templates.length > 0 && (
          <div className="actions" style={{ marginTop: "0.75rem" }}>
            <button
              type="button"
              className="ghost"
              disabled={selected.length === 0}
              onClick={removeSelected}
            >
              {selected.length === 0
                ? "Select photos to remove"
                : `Remove ${selected.length} selected`}
            </button>
            {selected.length > 0 && (
              <button type="button" className="ghost" onClick={() => setSelected([])}>
                Clear selection
              </button>
            )}
          </div>
        )}
        {templateError && <div className="alert error">{templateError}</div>}
        <p className="hint">
          Added to every listing for this blank — size chart, care card, colour chart. Uploaded top
          to bottom; drag a row to rearrange it. Click rows to select them, then
          remove them together. The top one becomes the search thumbnail on Etsy.
        </p>
      </div>

      <p className="hint">
        If a print partner manufactures for you, Etsy expects &quot;Another company or person&quot;
        with that partner declared in your shop settings.
      </p>

      <div className="actions" style={{ marginTop: "1rem" }}>
        <button className="primary" onClick={publish} disabled={!ready || busy}>
          {busy ? "Sending…" : "Send to Etsy as draft"}
        </button>
      </div>

      {!ready && (
        <p className="hint">
          {listing
            ? "Pick a category, a processing profile and a price to enable sending."
            : "Generate a listing in step 3 first — your settings above are saved."}
        </p>
      )}
      {error && <div className="alert error" style={{ marginTop: "1rem" }}>{error}</div>}
      {result && (
        <>
          <div className="alert info" style={{ marginTop: "1rem" }}>
            Draft created
            {result.variations ? ` with ${result.variationCount ?? offeringCount} variations` : ""}
            {result.attributesSet ? `, ${result.attributesSet} attributes` : ""}
            {result.uploaded ? ` and ${result.uploaded} photos` : ""}.{" "}
            <a href={result.listing.url} target="_blank" rel="noreferrer">
              Open listing {result.listing.listingId} on Etsy
            </a>{" "}
            — add your mockup images there, then publish.
          </div>
          {result.variationError && (
            <div className="alert warn">
              The draft was created but the variations were not added: {result.variationError}
            </div>
          )}
          {result.attributeError && (
            <div className="alert warn">
              Some attributes were not set: {result.attributeError}
            </div>
          )}
          {result.imageError && <div className="alert warn">{result.imageError}</div>}
        </>
      )}
    </div>
  );
}
