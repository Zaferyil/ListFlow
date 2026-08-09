"use client";

import { useCallback, useEffect, useState } from "react";
import type { Listing } from "@/lib/etsy";

interface ShippingProfile {
  id: number;
  title: string;
}

interface Status {
  configured: boolean;
  connected: boolean;
  shop?: { shopId: number; shopName: string };
  shippingProfiles?: ShippingProfile[];
  error?: string;
}

interface Category {
  id: number;
  path: string;
}

/**
 * Publishing settings are per-blank — a youth tee and a hoodie sit in different
 * Etsy categories and often at different prices — and they persist locally so
 * they are entered once rather than on every listing.
 */
interface PublishSettings {
  taxonomyId: number | null;
  shippingProfileId: number | null;
  price: string;
  quantity: string;
  whoMade: "i_did" | "someone_else" | "collective";
  whenMade: string;
}

const DEFAULTS: PublishSettings = {
  taxonomyId: null,
  shippingProfileId: null,
  price: "24.99",
  quantity: "999",
  // Print-on-demand: the seller designs it, a partner prints it. See the note
  // in the UI — Etsy expects "someone_else" plus a declared production partner
  // when a third party manufactures.
  whoMade: "i_did",
  whenMade: "made_to_order",
};

function settingsKey(productId: string): string {
  return `listflow.etsy.${productId}`;
}

function loadSettings(productId: string): PublishSettings {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const stored = window.localStorage.getItem(settingsKey(productId));
    return stored ? { ...DEFAULTS, ...(JSON.parse(stored) as PublishSettings) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function EtsyPanel({ listing, productId }: { listing: Listing; productId: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [settings, setSettings] = useState<PublishSettings>(DEFAULTS);
  const [search, setSearch] = useState("");
  const [result, setResult] = useState<{ url: string; listingId: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Settings are per-blank, so switching blanks reloads that blank's saved values.
  useEffect(() => {
    setSettings(loadSettings(productId));
    setResult(null);
  }, [productId]);

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
          taxonomyId: settings.taxonomyId,
          shippingProfileId: settings.shippingProfileId ?? undefined,
          price: Number(settings.price),
          quantity: Number(settings.quantity),
          whoMade: settings.whoMade,
          whenMade: settings.whenMade,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status}).`);
      setResult(body.listing);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unknown error.");
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;

  if (!status.configured) {
    return (
      <div className="card">
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
  const ready = settings.taxonomyId !== null && Number(settings.price) > 0;

  return (
    <div className="card">
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

      <p className="hint">
        If a print partner manufactures for you, Etsy expects &quot;Another company or person&quot;
        with that partner declared in your shop settings.
      </p>

      <div className="actions" style={{ marginTop: "1rem" }}>
        <button className="primary" onClick={publish} disabled={!ready || busy}>
          {busy ? "Sending…" : "Send to Etsy as draft"}
        </button>
      </div>

      {!ready && <p className="hint">Pick a category and a price to enable sending.</p>}
      {error && <div className="alert error" style={{ marginTop: "1rem" }}>{error}</div>}
      {result && (
        <div className="alert info" style={{ marginTop: "1rem" }}>
          Draft created.{" "}
          <a href={result.url} target="_blank" rel="noreferrer">
            Open listing {result.listingId} on Etsy
          </a>{" "}
          — add your mockup images there, then publish.
        </div>
      )}
    </div>
  );
}
