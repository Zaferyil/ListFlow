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
export const maxDuration = 300;

/** How many listings to generate in parallel — keeps us inside API rate limits. */
const CONCURRENCY = 3;

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
  limit: z.number().int().min(1).max(50).default(10),
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

    const results: BatchResult[] = new Array(pending.length);
    let cursor = 0;

    // A shared cursor gives us a fixed-size worker pool without pulling in a
    // dependency: each worker takes the next index until the list is drained.
    async function worker() {
      while (cursor < pending.length) {
        const index = cursor++;
        const entry = pending[index];
        try {
          const listing = await generateFromNiche(entry.niche, { productId });
          results[index] = {
            row: entry.row,
            niche: entry.niche,
            listing,
            warnings: inspectListing(listing, requiredKeywordsFor(productId)),
          };
        } catch (error) {
          results[index] = {
            row: entry.row,
            niche: entry.niche,
            error: error instanceof Error ? error.message : "Generation failed.",
          };
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, () => worker()));

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
