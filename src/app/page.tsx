"use client";

import { useEffect, useState } from "react";
import type { Listing, ListingWarning } from "@/lib/etsy";
import { ListingCard } from "./ListingCard";

type Tab = "design" | "niche" | "sheet";
type Language = "tr" | "en";

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
  return `Istek basarisiz (${response.status}).`;
}

function LanguageSelect({
  value,
  onChange,
}: {
  value: Language;
  onChange: (value: Language) => void;
}) {
  return (
    <div className="field">
      <label htmlFor="language">Listing dili</label>
      <select
        id="language"
        value={value}
        onChange={(event) => onChange(event.target.value as Language)}
      >
        <option value="en">Ingilizce (onerilen — Etsy alicilari)</option>
        <option value="tr">Turkce metin + Ingilizce etiketler</option>
      </select>
    </div>
  );
}

function DesignTab({ language }: { language: Language }) {
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
    form.set("language", language);

    try {
      const response = await fetch("/api/analyze", { method: "POST", body: form });
      if (!response.ok) throw new Error(await errorFrom(response));
      setResult(await response.json());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Bilinmeyen hata.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="card">
        <div className="field">
          <label htmlFor="design">Tasarim dosyasi (PNG, JPEG, WebP, GIF — max 8 MB)</label>
          <input
            id="design"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </div>

        {previewUrl && (
          // Local blob preview — next/image would need a configured loader for blob: URLs.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="Yuklenen tasarimin onizlemesi" className="preview" />
        )}

        <div className="field" style={{ marginTop: "1rem" }}>
          <label htmlFor="design-context">Ek baglam (opsiyonel)</label>
          <textarea
            id="design-context"
            value={context}
            onChange={(event) => setContext(event.target.value)}
            placeholder="Orn: dijital indirilebilir poster, 24x36 inch, minimalist ev dekoru magazasi"
          />
        </div>

        <button className="primary" onClick={submit} disabled={!file || loading}>
          {loading ? "Analiz ediliyor…" : "Listing uret"}
        </button>
      </div>

      {error && <div className="alert error">{error}</div>}
      {result && <ListingCard listing={result.listing} warnings={result.warnings} />}
    </>
  );
}

function NicheTab({ language }: { language: Language }) {
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
        body: JSON.stringify({ niche, context, language }),
      });
      if (!response.ok) throw new Error(await errorFrom(response));
      setResult(await response.json());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Bilinmeyen hata.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="card">
        <div className="field">
          <label htmlFor="niche">Nis / urun fikri</label>
          <input
            id="niche"
            value={niche}
            onChange={(event) => setNiche(event.target.value)}
            placeholder="Orn: boho pampas grass wall art printable"
          />
        </div>

        <div className="field">
          <label htmlFor="niche-context">Ek baglam (opsiyonel)</label>
          <textarea
            id="niche-context"
            value={context}
            onChange={(event) => setContext(event.target.value)}
            placeholder="Hedef kitle, magaza tarzi, urun formati…"
          />
        </div>

        <button className="primary" onClick={submit} disabled={niche.trim().length < 2 || loading}>
          {loading ? "Uretiliyor…" : "Listing uret"}
        </button>
      </div>

      {error && <div className="alert error">{error}</div>}
      {result && <ListingCard listing={result.listing} warnings={result.warnings} />}
    </>
  );
}

function SheetTab({ language }: { language: Language }) {
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
      setError(caught instanceof Error ? caught.message : "Bilinmeyen hata.");
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
        body: JSON.stringify({ spreadsheetId, range, language, limit, writeBack }),
      });
      if (!response.ok) throw new Error(await errorFrom(response));
      const body = await response.json();
      setRows(body.results as BatchRow[]);
      if (body.writeError) {
        setWriteInfo(`Sheet'e yazilamadi: ${body.writeError}`);
      } else if (writeBack) {
        setWriteInfo(`${body.writtenRows} satir sheet'e yazildi (C:E sutunlari).`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Bilinmeyen hata.");
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
            placeholder="docs.google.com/spreadsheets/d/<BU-KISIM>/edit"
          />
        </div>

        <div className="row">
          <div className="field">
            <label htmlFor="sheet-range">Aralik</label>
            <input
              id="sheet-range"
              value={range}
              onChange={(event) => setRange(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="sheet-limit">Kac nis islensin</label>
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
          Sonuclari sheet&apos;e geri yaz (C: baslik, D: aciklama, E: etiketler)
        </label>

        <div style={{ display: "flex", gap: "0.6rem" }}>
          <button className="ghost" onClick={preview} disabled={!spreadsheetId || loading}>
            Nisleri onizle
          </button>
          <button className="primary" onClick={generate} disabled={!spreadsheetId || loading}>
            {loading ? "Calisiyor…" : "Toplu uret"}
          </button>
        </div>

        <p style={{ fontSize: "0.8rem", color: "var(--muted)", marginBottom: 0 }}>
          A sutunu nis basligi, B sutunu (opsiyonel) o nise ozel baglam olarak okunur. Sheet&apos;i
          servis hesabinizin e-postasiyla paylasmayi unutmayin.
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
            heading={`Satir ${entry.row} — ${entry.niche}`}
          />
        ) : (
          <div key={entry.row} className={entry.error ? "alert error" : "card"}>
            {entry.error ? `Satir ${entry.row} — ${entry.niche}: ${entry.error}` : `Satir ${entry.row} — ${entry.niche}`}
          </div>
        ),
      )}
    </>
  );
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("design");
  const [language, setLanguage] = useState<Language>("en");

  return (
    <main className="page">
      <header>
        <h1>ListFlow</h1>
        <p>
          Tasarim yukleyin veya Google Sheet&apos;ten nis cekin; ListFlow Etsy icin baslik, aciklama
          ve 13 etiketi uretsin.
        </p>
      </header>

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "design"} onClick={() => setTab("design")}>
          Tasarim analizi
        </button>
        <button role="tab" aria-selected={tab === "niche"} onClick={() => setTab("niche")}>
          Tek nis
        </button>
        <button role="tab" aria-selected={tab === "sheet"} onClick={() => setTab("sheet")}>
          Google Sheet
        </button>
      </div>

      <div className="card">
        <LanguageSelect value={language} onChange={setLanguage} />
      </div>

      {tab === "design" && <DesignTab language={language} />}
      {tab === "niche" && <NicheTab language={language} />}
      {tab === "sheet" && <SheetTab language={language} />}
    </main>
  );
}
