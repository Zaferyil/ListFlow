import { NextResponse } from "next/server";
import { z } from "zod";
import { inspectListing, type Listing } from "@/lib/etsy";
import { generateFromNiche } from "@/lib/listing";
import { requiredKeywordsFor } from "@/lib/products";
import {
  columnLetter,
  DEFAULT_SHEET_NAME,
  extractSpreadsheetId,
  isSheetsConfigured,
  readNiches,
  type SheetLayout,
  writeListings,
} from "@/lib/sheets";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * How many listings one request generates.
 *
 * The browser calls this endpoint repeatedly until the sheet is drained, which
 * keeps every request well inside a serverless function's time limit —
 * Netlify's free plan cuts a function off at ten seconds, and a five-row batch
 * takes closer to forty. It also means progress appears row by row instead of
 * after a long silence, and a row that fails does not take the batch with it.
 */
const BATCH_SIZE = 1;

/** The detected column mapping, as letters, so the UI can show what it found. */
function describeLayout(layout: SheetLayout) {
  return {
    sheetName: layout.sheetName,
    fromHeaders: layout.fromHeaders,
    niche: columnLetter(layout.nicheColumn),
    status: layout.statusColumn === null ? null : columnLetter(layout.statusColumn),
    title: columnLetter(layout.titleColumn),
    description: columnLetter(layout.descriptionColumn),
    tags: columnLetter(layout.tagsColumn),
  };
}

/** Previews the sheet so the seller can check the mapping before spending calls. */
export async function GET(request: Request) {
  try {
    if (!isSheetsConfigured()) {
      return NextResponse.json({ error: "Google Sheets is not configured." }, { status: 501 });
    }

    const params = new URL(request.url).searchParams;
    const raw = params.get("spreadsheetId") ?? process.env.GOOGLE_SHEET_ID;
    const spreadsheetId = raw ? extractSpreadsheetId(raw) : undefined;
    const sheetName = params.get("sheetName") || process.env.GOOGLE_SHEET_NAME || DEFAULT_SHEET_NAME;

    if (!spreadsheetId) {
      return NextResponse.json({ error: "spreadsheetId is required." }, { status: 400 });
    }

    const { layout, rows } = await readNiches(spreadsheetId, sheetName);

    return NextResponse.json({
      layout: describeLayout(layout),
      pending: rows.filter((row) => row.pending).map(({ row, niche, status }) => ({ row, niche, status })),
      skipped: rows.filter((row) => !row.pending).length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read the sheet.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

const generateSchema = z.object({
  // Accepts the full browser URL as well as a bare ID.
  spreadsheetId: z.string().trim().min(1).transform(extractSpreadsheetId),
  sheetName: z.string().trim().min(1).default(DEFAULT_SHEET_NAME),
  productId: z.string().trim().optional(),
  /** Rows per request. Kept small so a serverless run cannot time out. */
  limit: z.number().int().min(1).max(50).default(BATCH_SIZE),
  /** Off runs a dry pass: listings come back, the sheet is left untouched. */
  writeBack: z.boolean().default(true),
});

interface BatchResult {
  row: number;
  niche: string;
  listing?: Listing;
  warnings?: ReturnType<typeof inspectListing>;
  error?: string;
}

/**
 * Generates listings for every row still marked New, writes them into the
 * output columns, and flips those rows to Done.
 */
export async function POST(request: Request) {
  try {
    if (!isSheetsConfigured()) {
      return NextResponse.json({ error: "Google Sheets is not configured." }, { status: 501 });
    }

    const parsed = generateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { spreadsheetId, sheetName, limit, writeBack, productId } = parsed.data;
    const { layout, rows } = await readNiches(spreadsheetId, sheetName);
    const pending = rows.filter((row) => row.pending).slice(0, limit);

    if (pending.length === 0) {
      return NextResponse.json(
        {
          error: rows.length
            ? `No rows are marked New in "${sheetName}" — all ${rows.length} rows are already done.`
            : `No niches found in "${sheetName}".`,
        },
        { status: 404 },
      );
    }

    const results: BatchResult[] = await Promise.all(
      pending.map(async (entry) => {
        try {
          const listing = await generateFromNiche(entry.niche, { productId });
          return {
            row: entry.row,
            niche: entry.niche,
            listing,
            warnings: inspectListing(listing, requiredKeywordsFor(productId)),
          };
        } catch (error) {
          return {
            row: entry.row,
            niche: entry.niche,
            error: error instanceof Error ? error.message : "Generation failed.",
          };
        }
      }),
    );

    let writtenRows = 0;
    let writeError: string | undefined;

    if (writeBack) {
      // Only rows that produced a listing are written, so a failed row keeps
      // its New status and gets picked up on the next run.
      const successful = results.filter(
        (result): result is BatchResult & { listing: Listing } => Boolean(result.listing),
      );
      try {
        await writeListings(
          spreadsheetId,
          layout,
          successful.map((result) => ({
            row: result.row,
            title: result.listing.title,
            description: result.listing.description,
            tags: result.listing.tags,
          })),
        );
        writtenRows = successful.length;
      } catch (error) {
        // A failed write-back must not discard listings we already paid to generate.
        writeError = error instanceof Error ? error.message : "Could not write to the sheet.";
      }
    }

    return NextResponse.json({
      results,
      writtenRows,
      writeError,
      layout: describeLayout(layout),
      remaining: rows.filter((row) => row.pending).length - pending.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
