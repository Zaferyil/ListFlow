"use client";

import { useState } from "react";
import type { Listing, ListingWarning } from "@/lib/etsy";
import { DEFAULT_PRODUCT_ID, findProduct, PRODUCTS } from "@/lib/products";
import { DropZone } from "./DropZone";
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
}: {
  productId: string;
  onProductChange: (value: string) => void;
}) {
  const product = findProduct(productId);

  return (
    <div className="card">
      <div className="field" style={{ marginBottom: 0 }}>
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
        {product.requiredKeywords.length > 0 && (
          <p className="hint">
            &quot;{product.requiredKeywords.join('", "')}&quot; is required in the title, description
            and tags for this blank.
          </p>
        )}
      </div>
    </div>
  );
}

interface TabProps {
  productId: string;
}

function DesignTab({ productId }: TabProps) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<SingleResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!file) return;
    setLoading(true);
    setError(null);
    setResult(null);

    const form = new FormData();
    form.set("design", file);
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
        <DropZone file={file} onFileChange={setFile} />

        <button className="primary" onClick={submit} disabled={!file || loading}>
          {loading ? "Analyzing…" : "Generate listing"}
        </button>
      </div>

      {error && <div className="alert error">{error}</div>}
      {result && <ListingCard listing={result.listing} warnings={result.warnings} />}
    </>
  );
}

function NicheTab({ productId }: TabProps) {
  const [niche, setNiche] = useState("");
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
        body: JSON.stringify({ niche, productId }),
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

        <button className="primary" onClick={submit} disabled={niche.trim().length < 2 || loading}>
          {loading ? "Generating…" : "Generate listing"}
        </button>
      </div>

      {error && <div className="alert error">{error}</div>}
      {result && <ListingCard listing={result.listing} warnings={result.warnings} />}
    </>
  );
}

interface LayoutInfo {
  sheetName: string;
  fromHeaders: boolean;
  niche: string;
  status: string | null;
  title: string;
  description: string;
  tags: string;
}

function LayoutSummary({ layout, pending, skipped }: { layout: LayoutInfo; pending: number; skipped?: number }) {
  return (
    <div className="alert info">
      <strong>{pending} row{pending === 1 ? "" : "s"} marked New</strong>
      {typeof skipped === "number" && skipped > 0 ? ` · ${skipped} already done` : ""}
      <br />
      Reading niche from <code>{layout.niche}</code>
      {layout.status ? (
        <>
          , status from <code>{layout.status}</code>
        </>
      ) : (
        <> · no status column found, so every row counts as New</>
      )}
      . Writing title to <code>{layout.title}</code>, description to <code>{layout.description}</code>,
      tags to <code>{layout.tags}</code>.
      {!layout.fromHeaders && " No header row recognised — columns assumed left to right."}
    </div>
  );
}

function SheetTab({ productId }: TabProps) {
  const [spreadsheetId, setSpreadsheetId] = useState("");
  const [sheetName, setSheetName] = useState("Nis Listesi");
  const [limit, setLimit] = useState(5);
  const [writeBack, setWriteBack] = useState(true);
  const [layout, setLayout] = useState<LayoutInfo | null>(null);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [skipped, setSkipped] = useState<number | undefined>(undefined);
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [writeInfo, setWriteInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function preview() {
    setLoading(true);
    setError(null);
    setWriteInfo(null);
    setRows([]);
    try {
      const params = new URLSearchParams({ spreadsheetId, sheetName });
      const response = await fetch(`/api/sheets?${params}`);
      if (!response.ok) throw new Error(await errorFrom(response));
      const body = await response.json();
      setLayout(body.layout as LayoutInfo);
      setPendingCount((body.pending as unknown[]).length);
      setSkipped(body.skipped as number);
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
        body: JSON.stringify({
          spreadsheetId,
          sheetName,
          limit,
          writeBack,
          productId,
        }),
      });
      if (!response.ok) throw new Error(await errorFrom(response));
      const body = await response.json();
      setRows(body.results as BatchRow[]);
      setLayout(body.layout as LayoutInfo);
      setPendingCount(null);

      if (body.writeError) {
        setWriteInfo(`Could not write to the sheet: ${body.writeError}`);
      } else if (writeBack) {
        const remaining = body.remaining as number;
        setWriteInfo(
          `Wrote ${body.writtenRows} rows and marked them Done.` +
            (remaining > 0 ? ` ${remaining} still marked New — run again to continue.` : ""),
        );
      } else {
        setWriteInfo("Dry run — the sheet was not touched.");
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
          <label htmlFor="sheet-id">Google Sheet URL or ID</label>
          <input
            id="sheet-id"
            value={spreadsheetId}
            onChange={(event) => setSpreadsheetId(event.target.value)}
            placeholder="Paste the sheet URL, or just the ID"
          />
        </div>

        <div className="row">
          <div className="field">
            <label htmlFor="sheet-name">Tab name</label>
            <input
              id="sheet-name"
              value={sheetName}
              onChange={(event) => setSheetName(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="sheet-limit">Max rows per run</label>
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
          Write results back and set Status to Done
        </label>

        <div style={{ display: "flex", gap: "0.6rem" }}>
          <button className="ghost" onClick={preview} disabled={!spreadsheetId || loading}>
            Check sheet
          </button>
          <button className="primary" onClick={generate} disabled={!spreadsheetId || loading}>
            {loading ? "Working…" : "Generate New rows"}
          </button>
        </div>

        <p className="hint" style={{ marginBottom: 0 }}>
          Only rows whose Status is <code>New</code> (or blank) are processed; they are set to{" "}
          <code>Done</code> afterwards. Columns are matched by header name. Share the sheet with your
          service account as an <strong>Editor</strong> — Viewer is not enough to write back.
        </p>
      </div>

      {error && <div className="alert error">{error}</div>}
      {writeInfo && <div className="alert warn">{writeInfo}</div>}
      {layout && pendingCount !== null && (
        <LayoutSummary layout={layout} pending={pendingCount} skipped={skipped} />
      )}

      {rows.map((entry) =>
        entry.listing ? (
          <ListingCard
            key={entry.row}
            listing={entry.listing}
            warnings={entry.warnings}
            heading={`Row ${entry.row} — ${entry.niche}`}
          />
        ) : (
          <div key={entry.row} className="alert error">
            {`Row ${entry.row} — ${entry.niche}: ${entry.error}`}
          </div>
        ),
      )}
    </>
  );
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("design");
  const [productId, setProductId] = useState(DEFAULT_PRODUCT_ID);

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

      <Settings productId={productId} onProductChange={setProductId} />

      {tab === "design" && <DesignTab productId={productId} />}
      {tab === "niche" && <NicheTab productId={productId} />}
      {tab === "sheet" && <SheetTab productId={productId} />}
    </main>
  );
}
