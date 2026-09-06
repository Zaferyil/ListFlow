"use client";

import { useState, type ReactNode } from "react";
import type { Listing, ListingWarning } from "@/lib/etsy";
import { DEFAULT_PRODUCT_ID, findProduct, PRODUCTS } from "@/lib/products";
import { DropZone } from "./DropZone";
import { EtsyPanel } from "./EtsyPanel";
import { ListingCard } from "./ListingCard";
import { FOR_ANALYSIS, prepareForUpload } from "./shrink";

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

/** A numbered stage of the flow: circle, heading, then its own content. */
function Step({
  number,
  title,
  description,
  children,
}: {
  number: number;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="step">
      <div className="step-number" aria-hidden="true">
        {number}
      </div>
      <div className="step-heading">
        <h2>
          <span className="visually-hidden">{`Step ${number}: `}</span>
          {title}
        </h2>
        <p>{description}</p>
      </div>
      <div className="step-body">{children}</div>
    </section>
  );
}

function BlankPicker({
  productId,
  onProductChange,
  ornamentQuantity,
  onOrnamentQuantityChange,
}: {
  productId: string;
  onProductChange: (value: string) => void;
  ornamentQuantity: number;
  onOrnamentQuantityChange: (value: number) => void;
}) {
  const product = findProduct(productId);

  // Separate garments from ornaments
  const garments = PRODUCTS.filter((p) => !p.garment.includes("ornament"));
  const ornaments = PRODUCTS.filter((p) => p.garment.includes("ornament"));

  const isOrnament = product.garment.includes("ornament");

  return (
    <div className="card">
      {garments.length > 0 && (
        <>
          <p style={{ marginTop: 0, fontWeight: 600, fontSize: "0.9rem", color: "#666" }}>
            Garments
          </p>
          <div className="choices">
            {garments.map((entry) => (
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
        </>
      )}

      {ornaments.length > 0 && (
        <>
          <p style={{ marginTop: "1.5rem", marginBottom: "0.5rem", fontWeight: 600, fontSize: "0.9rem", color: "#666" }}>
            Ornaments
          </p>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            {ornaments.slice(0, 1).map((entry) => (
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

          {isOrnament && (
            <div className="field" style={{ marginTop: "1rem" }}>
              <label htmlFor="ornament-qty">Quantity per variation (1-12)</label>
              <select
                id="ornament-qty"
                value={ornamentQuantity}
                onChange={(event) => onOrnamentQuantityChange(Number(event.target.value))}
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((num) => (
                  <option key={num} value={num}>
                    {num}
                  </option>
                ))}
              </select>
            </div>
          )}
        </>
      )}

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
  );
}

interface TabProps {
  productId: string;
}

interface DesignTabProps extends TabProps {
  ornamentQuantity: number;
}

function DesignTab({ productId, ornamentQuantity }: DesignTabProps) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<SingleResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!file) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const form = new FormData();
      // Sent at screen size, not print size — see shrinkForUpload.
      form.set("design", await prepareForUpload(file, FOR_ANALYSIS));
      form.set("productId", productId);

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
      <Step number={2} title="Design" description="Drop the artwork that goes on the garment.">
        <div className="card">
          <DropZone file={file} onFileChange={setFile} />
        </div>
      </Step>

      <Step number={3} title="Generate" description="Title, description and 13 tags, ready to paste.">
        <div className="card">
          <button className="primary" onClick={submit} disabled={!file || loading}>
            {loading ? "Analyzing…" : "Generate listing"}
          </button>
        </div>

        {error && <div className="alert error" style={{ marginTop: "1rem" }}>{error}</div>}
        {result && (
          <div style={{ marginTop: "1rem" }}>
            <ListingCard listing={result.listing} warnings={result.warnings} />
          </div>
        )}
      </Step>

      <EtsyStep listing={result?.listing ?? null} productId={productId} ornamentQuantity={ornamentQuantity} />
    </>
  );
}

/** Step 4: connecting the shop is one-time setup, so it shows before a listing exists too. */
function EtsyStep({
  listing,
  productId,
  ornamentQuantity,
}: {
  listing: Listing | null;
  productId: string;
  ornamentQuantity: number;
}) {
  return (
    <Step
      number={4}
      title="Send to Etsy"
      description="Creates a draft in your shop — nothing goes live until you publish it."
    >
      <EtsyPanel
        listing={listing}
        productId={productId}
        catalogColors={(findProduct(productId).colors ?? []).join("\n")}
        ornamentQuantity={ornamentQuantity}
      />
    </Step>
  );
}

interface NicheTabProps extends TabProps {
  ornamentQuantity: number;
}

function NicheTab({ productId, ornamentQuantity }: NicheTabProps) {
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
      <Step number={2} title="Niche" description="Describe the shirt idea in a few words.">
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
        </div>
      </Step>

      <Step number={3} title="Generate" description="Title, description and 13 tags, ready to paste.">
        <div className="card">
          <button className="primary" onClick={submit} disabled={niche.trim().length < 2 || loading}>
            {loading ? "Generating…" : "Generate listing"}
          </button>
        </div>

        {error && <div className="alert error" style={{ marginTop: "1rem" }}>{error}</div>}
        {result && (
          <div style={{ marginTop: "1rem" }}>
            <ListingCard listing={result.listing} warnings={result.warnings} />
          </div>
        )}
      </Step>

      <EtsyStep listing={result?.listing ?? null} productId={productId} ornamentQuantity={ornamentQuantity} />
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

function LayoutSummary({
  layout,
  pending,
  skipped,
}: {
  layout: LayoutInfo;
  pending: number;
  skipped?: number;
}) {
  return (
    <div className="alert info">
      <strong>
        {pending} row{pending === 1 ? "" : "s"} marked New
      </strong>
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
      . Writing title to <code>{layout.title}</code>, description to{" "}
      <code>{layout.description}</code>, tags to <code>{layout.tags}</code>.
      {!layout.fromHeaders && " No header row recognised — columns assumed left to right."}
    </div>
  );
}

interface SheetTabProps extends TabProps {
  ornamentQuantity: number;
}

function SheetTab({ productId, ornamentQuantity }: SheetTabProps) {
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

  /**
   * Walks the sheet a row at a time.
   *
   * The server used to generate the whole batch in one request, which no
   * serverless host will sit through — Netlify's free plan cuts a function off
   * at ten seconds and one listing already takes six to eight. Asking row by
   * row also means results appear as they land instead of after a long
   * silence.
   */
  async function generate() {
    setLoading(true);
    setError(null);
    setWriteInfo(null);
    setRows([]);
    setPendingCount(null);

    const seen = new Set<number>();
    let failures = 0;

    try {
      for (let done = 0; done < limit; done += 1) {
        const response = await fetch("/api/sheets", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ spreadsheetId, sheetName, limit: 1, writeBack, productId }),
        });

        // 404 is "nothing left marked New", which is the normal way to finish.
        if (response.status === 404 && done > 0) break;
        if (!response.ok) throw new Error(await errorFrom(response));

        const body = await response.json();
        const batch = body.results as BatchRow[];
        setLayout(body.layout as LayoutInfo);

        // A dry run leaves rows New, and a failed row keeps its status too, so
        // the same row would come back forever. Stopping on a repeat is what
        // makes the loop terminate in both cases.
        if (batch.some((entry) => seen.has(entry.row))) break;
        batch.forEach((entry) => seen.add(entry.row));

        setRows((current) => [...current, ...batch]);

        if (body.writeError) {
          setWriteInfo(`Could not write to the sheet: ${body.writeError}`);
          break;
        }

        failures += batch.filter((entry) => entry.error).length;
        if (failures >= 2) {
          setWriteInfo("Stopped after two rows failed — fix those, then run again.");
          break;
        }

        if ((body.remaining as number) <= 0) break;
      }

      if (!writeBack) {
        setWriteInfo("Dry run — the sheet was not touched.");
      } else if (seen.size > 0) {
        setWriteInfo(`Wrote ${seen.size} row${seen.size === 1 ? "" : "s"} and marked them Done.`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unknown error.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Step number={2} title="Sheet" description="Point ListFlow at the tab holding your niches.">
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

          <label className="checkbox">
            <input
              type="checkbox"
              checked={writeBack}
              onChange={(event) => setWriteBack(event.target.checked)}
            />
            Write results back and set Status to Done
          </label>

          <p className="hint">
            Only rows whose Status is <code>New</code> (or blank) are processed. Share the sheet with
            your service account as an <strong>Editor</strong> — Viewer cannot write back.
          </p>
        </div>
      </Step>

      <Step
        number={3}
        title="Generate"
        description="Check the column mapping first, then run the batch."
      >
        <div className="card">
          <div className="actions">
            <button className="ghost" onClick={preview} disabled={!spreadsheetId || loading}>
              Check sheet
            </button>
            <button className="primary" onClick={generate} disabled={!spreadsheetId || loading}>
              {loading ? `Working… ${rows.length} done` : "Generate New rows"}
            </button>
          </div>
        </div>

        <div style={{ marginTop: "1rem" }}>
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
        </div>
      </Step>
    </>
  );
}

// A short label as well, so all three tabs fit a phone without the last one
// being clipped mid-word.
const TABS: { id: Tab; label: string; short: string }[] = [
  { id: "design", label: "Design analysis", short: "Design" },
  { id: "niche", label: "Single niche", short: "Niche" },
  { id: "sheet", label: "Google Sheet", short: "Sheet" },
];

export default function Home() {
  const [tab, setTab] = useState<Tab>("design");
  const [productId, setProductId] = useState(DEFAULT_PRODUCT_ID);
  const [ornamentQuantity, setOrnamentQuantity] = useState(1);

  return (
    <>
      <header className="app-header">
        <div className="app-header-inner">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path
                d="M8.5 3 5 4.8 3 8.5l3 1.8V21h12v-10.7l3-1.8-2-3.7L15.5 3a3.5 3.5 0 0 1-7 0Z"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="brand-text">
            <strong>ListFlow</strong>
            <span>Etsy listings for print-on-demand shirts</span>
          </span>
        </div>
      </header>

      <main className="page">
        <div className="hero">
          <h1>Etsy listings in seconds ✨</h1>
          <p>
            Pick a blank, add a design or a niche, and ListFlow writes the title, description and 13
            tags.
          </p>
        </div>

        <div className="tabs" role="tablist" aria-label="Input mode">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              role="tab"
              aria-selected={tab === entry.id}
              onClick={() => setTab(entry.id)}
            >
              <span className="tab-full">{entry.label}</span>
              <span className="tab-short">{entry.short}</span>
            </button>
          ))}
        </div>

        <Step
          number={1}
          title="Blank"
          description="Its real fabric specs go into every listing you generate."
        >
          <BlankPicker
            productId={productId}
            onProductChange={setProductId}
            ornamentQuantity={ornamentQuantity}
            onOrnamentQuantityChange={setOrnamentQuantity}
          />
        </Step>

        {tab === "design" && <DesignTab productId={productId} ornamentQuantity={ornamentQuantity} />}
        {tab === "niche" && <NicheTab productId={productId} ornamentQuantity={ornamentQuantity} />}
        {tab === "sheet" && <SheetTab productId={productId} ornamentQuantity={ornamentQuantity} />}
      </main>
    </>
  );
}
