import { google } from "googleapis";
import { JWT } from "google-auth-library";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

export const DEFAULT_SHEET_NAME = "Nis Listesi";

/** Status values, compared case-insensitively after trimming. */
const STATUS_NEW = "new";
const STATUS_DONE = "Done";

function auth(): JWT {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY;

  if (!email || !key) {
    throw new Error(
      "Google Sheets is not configured. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY.",
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
 * Accepts either a bare spreadsheet ID or the full URL from the browser's
 * address bar, because pasting the URL is what anyone actually does.
 */
export function extractSpreadsheetId(input: string): string {
  const trimmed = input.trim();
  return trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)?.[1] ?? trimmed;
}

/** 0-based column index to an A1 letter: 0 → A, 25 → Z, 26 → AA. */
export function columnLetter(index: number): string {
  let letter = "";
  let remaining = index;
  while (remaining >= 0) {
    letter = String.fromCharCode((remaining % 26) + 65) + letter;
    remaining = Math.floor(remaining / 26) - 1;
  }
  return letter;
}

/** Sheet names containing spaces have to be quoted in A1 notation. */
function quoteSheetName(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}

/**
 * Matched anywhere in the header, not just at the start, because real headers
 * carry prefixes — "SEO_Title" is the title column. Word boundaries keep
 * neighbouring columns like "Design_URL" and "Etsy_URL" out of it.
 */
const HEADER_PATTERNS = {
  // \b is ASCII-only, so it fails after a Turkish letter — "Niş" would not
  // match /\bniş\b/. Unicode lookarounds handle both alphabets.
  niche: /(?<!\p{L})(niche|ni[sş])(?!\p{L})|keyword|anahtar|konu/iu,
  status: /(?<!\p{L})(status|stat[uü]|durum|state)(?!\p{L})/iu,
  title: /title|titel|ba[sş]l[iı]k/iu,
  description: /descript|a[cç][iı]klama|i[cç]erik/iu,
  tags: /(?<!\p{L})tags?(?!\p{L})|etiket/iu,
} as const;

export interface SheetLayout {
  sheetName: string;
  /** 1-based row the data starts on — 2 when there is a header, 1 when there isn't. */
  firstDataRow: number;
  nicheColumn: number;
  /** Null when the sheet has no status column; then every row is processed. */
  statusColumn: number | null;
  titleColumn: number;
  descriptionColumn: number;
  tagsColumn: number;
  /** True when the columns came from header names rather than from position. */
  fromHeaders: boolean;
}

/**
 * Works out which column is which. Header names are preferred so the sheet can
 * be laid out however the seller likes; a sheet with no recognisable header
 * falls back to niche / status / title / description / tags left to right.
 */
export function detectLayout(sheetName: string, rows: string[][]): SheetLayout {
  const header = rows[0] ?? [];
  const taken = new Set<number>();

  // Claimed columns are excluded from later patterns so a header like
  // "Niche Title" can't be read as both the input and the output column.
  const find = (pattern: RegExp) => {
    const index = header.findIndex(
      (cell, position) => !taken.has(position) && pattern.test(String(cell ?? "").trim()),
    );
    if (index !== -1) taken.add(index);
    return index;
  };

  const niche = find(HEADER_PATTERNS.niche);
  const status = find(HEADER_PATTERNS.status);
  const title = find(HEADER_PATTERNS.title);
  const description = find(HEADER_PATTERNS.description);
  const tags = find(HEADER_PATTERNS.tags);

  // Any recognised header name means row 1 is a header. Requiring the niche
  // column specifically would be stricter but far more dangerous: a header we
  // failed to parse would be treated as a niche, generating a listing for the
  // word "Niche" and then marking that row Done.
  const isHeaderRow = [niche, status, title, description, tags].some((index) => index !== -1);

  if (!isHeaderRow) {
    return {
      sheetName,
      firstDataRow: 1,
      nicheColumn: 0,
      statusColumn: 1,
      titleColumn: 2,
      descriptionColumn: 3,
      tagsColumn: 4,
      fromHeaders: false,
    };
  }

  const nicheColumn = niche === -1 ? 0 : niche;

  // Where headers for the outputs are missing, write to the three columns after
  // whatever the sheet already uses, so nothing existing is overwritten.
  const firstFree = Math.max(header.length, nicheColumn + 1, status + 1);

  return {
    sheetName,
    firstDataRow: 2,
    nicheColumn,
    statusColumn: status === -1 ? null : status,
    titleColumn: title === -1 ? firstFree : title,
    descriptionColumn: description === -1 ? firstFree + 1 : description,
    tagsColumn: tags === -1 ? firstFree + 2 : tags,
    fromHeaders: true,
  };
}

export interface NicheRow {
  /** 1-based row number in the sheet, so results go back to the right line. */
  row: number;
  niche: string;
  status: string;
  /** False when the status column marks the row as already handled. */
  pending: boolean;
}

export interface SheetRead {
  layout: SheetLayout;
  rows: NicheRow[];
}

/**
 * A row is pending when its status is "New" or blank. Blank counts because a
 * freshly typed niche with nothing in the status column is obviously not done;
 * anything else — "Done", "Hold", a typo — is left alone deliberately.
 */
function isPending(status: string): boolean {
  const value = status.trim().toLowerCase();
  return value === "" || value === STATUS_NEW;
}

export async function readNiches(
  spreadsheetId: string,
  sheetName = DEFAULT_SHEET_NAME,
): Promise<SheetRead> {
  const response = await sheetsClient().spreadsheets.values.get({
    spreadsheetId,
    range: quoteSheetName(sheetName),
  });

  const grid = (response.data.values ?? []).map((row) => (row ?? []).map((cell) => String(cell ?? "")));
  const layout = detectLayout(sheetName, grid);

  const rows: NicheRow[] = [];
  for (let index = layout.firstDataRow - 1; index < grid.length; index++) {
    const cells = grid[index] ?? [];
    const niche = (cells[layout.nicheColumn] ?? "").trim();
    if (!niche) continue;

    const status = layout.statusColumn === null ? "" : (cells[layout.statusColumn] ?? "").trim();
    rows.push({ row: index + 1, niche, status, pending: isPending(status) });
  }

  return { layout, rows };
}

export interface SheetWriteRow {
  row: number;
  title: string;
  description: string;
  tags: string[];
}

/**
 * Writes the generated listing back and flips the row's status to Done.
 *
 * Output columns are written as separate single-cell ranges rather than one
 * span, because a sheet whose headers put them out of order (or far apart)
 * would otherwise have the cells in between overwritten with blanks.
 */
export async function writeListings(
  spreadsheetId: string,
  layout: SheetLayout,
  rows: SheetWriteRow[],
): Promise<void> {
  if (rows.length === 0) return;

  const sheet = quoteSheetName(layout.sheetName);
  const cell = (column: number, row: number, value: string) => ({
    range: `${sheet}!${columnLetter(column)}${row}`,
    values: [[value]],
  });

  const data = rows.flatMap((entry) => {
    const updates = [
      cell(layout.titleColumn, entry.row, entry.title),
      cell(layout.descriptionColumn, entry.row, entry.description),
      cell(layout.tagsColumn, entry.row, entry.tags.join(", ")),
    ];
    if (layout.statusColumn !== null) {
      updates.push(cell(layout.statusColumn, entry.row, STATUS_DONE));
    }
    return updates;
  });

  await sheetsClient().spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: "RAW", data },
  });
}

export function isSheetsConfigured(): boolean {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY);
}
