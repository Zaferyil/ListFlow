import { google } from "googleapis";
import { JWT } from "google-auth-library";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

export interface NicheRow {
  /** 1-based row number in the sheet, so results can be written back in place. */
  row: number;
  niche: string;
  /** Optional second column: extra context for this niche. */
  context?: string;
}

function auth(): JWT {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY;

  if (!email || !key) {
    throw new Error(
      "Google Sheets yapilandirilmamis. GOOGLE_SERVICE_ACCOUNT_EMAIL ve GOOGLE_PRIVATE_KEY tanimlayin.",
    );
  }

  return new JWT({
    email,
    // Env vars store the key with literal \n sequences; the JWT client needs real newlines.
    key: key.replace(/\\n/g, "\n"),
    scopes: SCOPES,
  });
}

function sheetsClient() {
  return google.sheets({ version: "v4", auth: auth() });
}

/**
 * Reads niche keywords from a sheet. The first column is the niche/title; an
 * optional second column carries per-row context. A header row is skipped when
 * the first cell looks like a header rather than a niche.
 */
export async function readNiches(spreadsheetId: string, range: string): Promise<NicheRow[]> {
  const response = await sheetsClient().spreadsheets.values.get({ spreadsheetId, range });
  const values = response.data.values ?? [];

  // `range` may start below row 1 (e.g. "Sheet1!A5:B"), so anchor row numbers to it.
  const startRow = Number(range.match(/![A-Z]+(\d+)/i)?.[1] ?? 1);

  const rows: NicheRow[] = [];
  for (const [index, value] of values.entries()) {
    const niche = String(value?.[0] ?? "").trim();
    if (!niche) continue;

    // Skip a header row, but only if it is genuinely the first row we read.
    if (index === 0 && /^(niche|nis|keyword|anahtar|title|baslik)/i.test(niche)) continue;

    rows.push({
      row: startRow + index,
      niche,
      context: String(value?.[1] ?? "").trim() || undefined,
    });
  }

  return rows;
}

export interface SheetWriteRow {
  row: number;
  title: string;
  description: string;
  tags: string[];
}

/**
 * Writes generated listings back to the sheet, starting at `startColumn`
 * (title, description, tags), leaving the input columns untouched.
 */
export async function writeListings(
  spreadsheetId: string,
  sheetName: string,
  rows: SheetWriteRow[],
  startColumn = "C",
): Promise<void> {
  if (rows.length === 0) return;

  const endColumn = String.fromCharCode(startColumn.charCodeAt(0) + 2);

  await sheetsClient().spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "RAW",
      data: rows.map((entry) => ({
        range: `${sheetName}!${startColumn}${entry.row}:${endColumn}${entry.row}`,
        values: [[entry.title, entry.description, entry.tags.join(", ")]],
      })),
    },
  });
}

export function isSheetsConfigured(): boolean {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY);
}
