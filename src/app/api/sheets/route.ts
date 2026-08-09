import { NextResponse } from "next/server";
import { z } from "zod";
import { inspectListing, type Listing } from "@/lib/etsy";
import { generateFromNiche } from "@/lib/listing";
import { isSheetsConfigured, readNiches, writeListings } from "@/lib/sheets";

export const runtime = "nodejs";
export const maxDuration = 300;

/** How many listings to generate in parallel — keeps us inside API rate limits. */
const CONCURRENCY = 3;

/** Reads the niche list so the UI can show it before generating anything. */
export async function GET(request: Request) {
  try {
    if (!isSheetsConfigured()) {
      return NextResponse.json({ error: "Google Sheets yapilandirilmamis." }, { status: 501 });
    }

    const params = new URL(request.url).searchParams;
    const spreadsheetId = params.get("spreadsheetId") ?? process.env.GOOGLE_SHEET_ID;
    const range = params.get("range") ?? process.env.GOOGLE_SHEET_RANGE ?? "Sheet1!A:B";

    if (!spreadsheetId) {
      return NextResponse.json({ error: "spreadsheetId gerekli." }, { status: 400 });
    }

    return NextResponse.json({ niches: await readNiches(spreadsheetId, range), range });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sheet okunamadi.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

const generateSchema = z.object({
  spreadsheetId: z.string().trim().min(1),
  range: z.string().trim().min(1).default("Sheet1!A:B"),
  language: z.enum(["tr", "en"]).default("en"),
  requiredKeywords: z.array(z.string().trim().min(1).max(60)).max(5).default([]),
  limit: z.number().int().min(1).max(50).default(10),
  /** When true, results are written back into columns C:E of the same rows. */
  writeBack: z.boolean().default(false),
});

interface BatchResult {
  row: number;
  niche: string;
  listing?: Listing;
  warnings?: ReturnType<typeof inspectListing>;
  error?: string;
}

/** Generates listings for the sheet's niches, optionally writing them back. */
export async function POST(request: Request) {
  try {
    if (!isSheetsConfigured()) {
      return NextResponse.json({ error: "Google Sheets yapilandirilmamis." }, { status: 501 });
    }

    const parsed = generateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { spreadsheetId, range, language, limit, writeBack, requiredKeywords } = parsed.data;
    const niches = (await readNiches(spreadsheetId, range)).slice(0, limit);

    if (niches.length === 0) {
      return NextResponse.json({ error: "Sheet'te islenecek nis bulunamadi." }, { status: 404 });
    }

    const results: BatchResult[] = new Array(niches.length);
    let cursor = 0;

    // A shared cursor gives us a fixed-size worker pool without pulling in a
    // dependency: each worker takes the next index until the list is drained.
    async function worker() {
      while (cursor < niches.length) {
        const index = cursor++;
        const entry = niches[index];
        try {
          const listing = await generateFromNiche(entry.niche, {
            language,
            context: entry.context,
            requiredKeywords,
          });
          results[index] = {
            row: entry.row,
            niche: entry.niche,
            listing,
            warnings: inspectListing(listing, requiredKeywords),
          };
        } catch (error) {
          results[index] = {
            row: entry.row,
            niche: entry.niche,
            error: error instanceof Error ? error.message : "Uretim basarisiz.",
          };
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, niches.length) }, () => worker()),
    );

    let writtenRows = 0;
    let writeError: string | undefined;

    if (writeBack) {
      const successful = results.filter(
        (result): result is BatchResult & { listing: Listing } => Boolean(result.listing),
      );
      try {
        const sheetName = range.includes("!") ? range.split("!")[0] : "Sheet1";
        await writeListings(
          spreadsheetId,
          sheetName,
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
        writeError = error instanceof Error ? error.message : "Sheet'e yazilamadi.";
      }
    }

    return NextResponse.json({ results, writtenRows, writeError });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Beklenmeyen bir hata olustu.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
