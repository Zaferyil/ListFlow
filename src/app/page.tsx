"use client";

import { useEffect, useState } from "react";
import type { Listing, ListingWarning } from "@/lib/etsy";
import { DEFAULT_PRODUCT_ID, findProduct, PRODUCTS } from "@/lib/products";
import { ListingCard } from "./ListingCard";

type Tab = "design" | "niche" | "sheet";

interface SingleResult {
  listing: Listing;
  warnings: ListingWarning[];
}

interface BatchRow {
  row: number;
  niche: string;
  listing?: Listing;
  warnings?: ListingWarning[];
  error?: string;
}

/** Reads `error` out of a failed JSON response, falling back to the status text. */
async function errorFrom(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (typeof body?.error === "string") return body.error;
  } catch {
    // Non-JSON error body (e.g. a proxy timeout page) — fall through.
  }
  return `Request failed (${response.status}).`;
}

function Settings({
  productId,
  onProductChange,
  extraKeywords,
  onExtraKeywordsChange,
}: {
  productId: string;
  onProductChange: (value: string) => void;
  extraKeywords: string;
  onExtraKeywordsChange: (value: string) => void;
}) {
  const product = findProduct(productId);

  return (
    <div className="card">
      <div className="field">
        <label>Blank</label>
        <div className="choices">
          {PRODUCTS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="choice"
              aria-pressed={entry.id === productId}
              onClick={() => onProductChange(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <p className="hint">
          {product.composition} · {product.weight} · {product.fit}
          {product.colorCaveat ? ` — ${product.colorCaveat}` : ""}
        </p>
      </div>

      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="required-keywords">Extra required keywords (comma separated)</label>
        <input
          id="required-keywords"
          value={extraKeywords}
          onChange={(event) => onExtraKeywordsChange(event.target.value)}
          placeholder="e.g. oversized, bachelorette"
        />
        <p className="hint">
          {product.requiredKeywords.length > 0
            ? `"${product.requiredKeywords.join('", "')}" is already required for this blank. `
            : ""}
          Each term goes in the title, description and tags. The first 3-4 words of the title stay
          the buyer&apos;s search phrase.
        </p>
      </div>
    </div>
  );
}

interface TabProps {
  requiredKeywords: string[];
  productId: string;
}

function DesignTab({ requiredKeywords, productId }: TabProps) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [context, setContext] = useState("");
  const [result, setResult] = useState<SingleResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Object URLs leak unless revoked when the selection changes or unmounts.
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function submit() {
    if (!file) return;
    setLoading(true);
    setError(null);
    setResult(null);

    const form = new FormData();
    form.set("design", file);
    form.set("context", context);
    form.set("requiredKeywords", requiredKeywords.join(","));
    form.set("productId", productId);

    try {
      const response = await fetch("/api/analyze", { method: "POST", body: form });
      if (!response.ok) throw new Error(await errorFrom(response));
      setResult(await response.json());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unknown error.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="card">
        <div className="field">
          <label htmlFor="design">Design file (PNG, JPEG, WebP, GIF, SVG — max 8 MB)</label>
          <input
            id="design"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </div>

        {previewUrl && (
          // Local blob preview — next/image would need a configured loader for blob: URLs.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="Preview of the uploaded design" className="preview" />
        )}

        <div className="field" style={{ marginTop: "1rem" }}>
          <label htmlFor="design-context">Extra context (optional)</label>
          <textarea
            id="design-context"
            value={context}
            onChange={(event) => setContext(event.target.value)}
            placeholder="e.g. oversized boxy fit, sand and black colorways, gift for new moms"
          />
        </div>

        <button className="primary" onClick={submit} disabled={!file || loading}>
          {loading ? "Analyzing…" : "Generate listing"}
        </button>
      </div>

      {error && <div className="alert error">{error}</div>}
      {result && <ListingCard listing={result.listing} warnings={result.warnings} />}
    </>
  );
}

function NicheTab({ requiredKeywords, productId }: TabProps) {
  const [niche, setNiche] = useState("");
  const [context, setContext] = useState("");
  const [result, setResult] = useState<SingleResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ niche, context, requiredKeywords, productId }),
      });
      if (!response.ok) throw new Error(await errorFrom(response));
      setResult(await response.json());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unknown error.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="card">
        <div className="field">
          <label htmlFor="niche">Niche / shirt idea</label>
          <input
            id="niche"
            value={niche}
            onChange={(event) => setNiche(event.target.value)}
            placeholder="e.g. retro sunset graphic tee for summer"
          />
        </div>

        <div className="field">
          <label htmlFor="niche-context">Extra context (optional)</label>
          <textarea
            id="niche-context"
            value={context}
            onChange={(event) => setContext(event.target.value)}
            placeholder="Target buyer, shop style, fit…"
          />
        </div>

        <button className="primary" onClick={submit} disabled={niche.trim().length < 2 || loading}>
          {loading ? "Generating…" : "Generate listing"}
        </button>
      </div>

      {error && <div className="alert error">{error}</div>}
      {result && <ListingCard listing={result.listing} warnings={result.warnings} />}
    </>
  );
}

function SheetTab({ requiredKeywords, productId }: TabProps) {
  const [spreadsheetId, setSpreadsheetId] = useState("");
  const [range, setRange] = useState("Sheet1!A:B");
  const [limit, setLimit] = useState(5);
  const [writeBack, setWriteBack] = useState(false);
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [writeInfo, setWriteInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function preview() {
    setLoading(true);
    setError(null);
    setWriteInfo(null);
    try {
      const params = new URLSearchParams({ spreadsheetId, range });
      const response = await fetch(`/api/sheets?${params}`);
      if (!response.ok) throw new Error(await errorFrom(response));
      const body = await response.json();
      setRows(
        (body.niches as { row: number; niche: string }[]).map((entry) => ({
          row: entry.row,
          niche: entry.niche,
        })),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unknown error.");
    } finally {
      setLoading(false);
    }
  }

  async function generate() {
    setLoading(true);
    setError(null);
    setWriteInfo(null);
    try {
      const response = await fetch("/api/sheets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spreadsheetId, range, limit, writeBack, requiredKeywords, productId }),
      });
      if (!response.ok) throw new Error(await errorFrom(response));
      const body = await response.json();
      setRows(body.results as BatchRow[]);
      if (body.writeError) {
        setWriteInfo(`Could not write to the sheet: ${body.writeError}`);
      } else if (writeBack) {
        setWriteInfo(`Wrote ${body.writtenRows} rows to the sheet (columns C:E).`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unknown error.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="card">
        <div className="field">
          <label htmlFor="sheet-id">Google Sheet ID</label>
          <input
            id="sheet-id"
            value={spreadsheetId}
            onChange={(event) => setSpreadsheetId(event.target.value)}
            placeholder="docs.google.com/spreadsheets/d/<THIS-PART>/edit"
          />
        </div>

        <div className="row">
          <div className="field">
            <label htmlFor="sheet-range">Range</label>
            <input
              id="sheet-range"
              value={range}
              onChange={(event) => setRange(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="sheet-limit">How many niches</label>
            <input
              id="sheet-limit"
              type="number"
              min={1}
              max={50}
              value={limit}
              onChange={(event) => setLimit(Number(event.target.value))}
            />
          </div>
        </div>

        <label className="checkbox" style={{ marginBottom: "1rem" }}>
          <input
            type="checkbox"
            checked={writeBack}
            onChange={(event) => setWriteBack(event.target.checked)}
          />
          Write results back to the sheet (C: title, D: description, E: tags)
        </label>

        <div style={{ display: "flex", gap: "0.6rem" }}>
          <button className="ghost" onClick={preview} disabled={!spreadsheetId || loading}>
            Preview niches
          </button>
          <button className="primary" onClick={generate} disabled={!spreadsheetId || loading}>
            {loading ? "Working…" : "Generate batch"}
          </button>
        </div>

        <p style={{ fontSize: "0.8rem", color: "var(--muted)", marginBottom: 0 }}>
          Column A is the niche, column B (optional) is per-row context. Remember to share the
          sheet with your service account email.
        </p>
      </div>

      {error && <div className="alert error">{error}</div>}
      {writeInfo && <div className="alert warn">{writeInfo}</div>}

      {rows.map((entry) =>
        entry.listing ? (
          <ListingCard
            key={entry.row}
            listing={entry.listing}
            warnings={entry.warnings}
            heading={`Row ${entry.row} — ${entry.niche}`}
          />
        ) : (
          <div key={entry.row} className={entry.error ? "alert error" : "card"}>
            {entry.error ? `Row ${entry.row} — ${entry.niche}: ${entry.error}` : `Row ${entry.row} — ${entry.niche}`}
          </div>
        ),
      )}
    </>
  );
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("design");
  const [productId, setProductId] = useState(DEFAULT_PRODUCT_ID);
  const [extraKeywords, setExtraKeywords] = useState("");

  const requiredKeywords = extraKeywords
    .split(",")
    .map((keyword) => keyword.trim())
    .filter(Boolean)
    .slice(0, 5);

  return (
    <main className="page">
      <header>
        <h1>ListFlow</h1>
        <p>
          Upload a design or pull niches from a Google Sheet — ListFlow writes the Etsy title,
          description and 13 tags for your printed shirts.
        </p>
      </header>

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "design"} onClick={() => setTab("design")}>
          Design analysis
        </button>
        <button role="tab" aria-selected={tab === "niche"} onClick={() => setTab("niche")}>
          Single niche
        </button>
        <button role="tab" aria-selected={tab === "sheet"} onClick={() => setTab("sheet")}>
          Google Sheet
        </button>
      </div>

      <Settings
        productId={productId}
        onProductChange={setProductId}
        extraKeywords={extraKeywords}
        onExtraKeywordsChange={setExtraKeywords}
      />

      {tab === "design" && <DesignTab requiredKeywords={requiredKeywords} productId={productId} />}
      {tab === "niche" && <NicheTab requiredKeywords={requiredKeywords} productId={productId} />}
      {tab === "sheet" && <SheetTab requiredKeywords={requiredKeywords} productId={productId} />}
    </main>
  );
}
