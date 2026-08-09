import { mkdir, readFile, readdir, rm, writeFile } from "fs/promises";
import { join } from "path";

/**
 * Template photos — size chart, care card, colour chart — that go on every
 * listing for a given blank.
 *
 * They live on disk beside the Etsy tokens, for the same reason and with the
 * same caveat: right for one seller on their own machine, wrong for a
 * serverless host where each invocation starts with an empty filesystem.
 */
const TEMPLATE_ROOT = join(process.cwd(), ".data", "templates");

/** Etsy accepts these; anything else is rejected at upload time. */
const ALLOWED_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
};

export interface TemplateImage {
  name: string;
  size: number;
}

/**
 * Names come from the browser, so they are rebuilt from scratch rather than
 * trusted — a name like "../../etsy-tokens.json" must not reach join().
 */
function safeName(name: string): string {
  const cleaned = name
    .replace(/\\/g, "/")
    .split("/")
    .pop()!
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/^\.+/, "");

  if (!cleaned) throw new Error("That file name cannot be used.");
  return cleaned;
}

function extensionOf(name: string): string {
  const match = /\.[a-zA-Z0-9]+$/.exec(name);
  return match ? match[0].toLowerCase() : "";
}

export function contentTypeFor(name: string): string {
  const type = ALLOWED_TYPES[extensionOf(name)];
  if (!type) {
    throw new Error("Etsy accepts PNG, JPEG and GIF images only.");
  }
  return type;
}

function folderFor(productId: string): string {
  return join(TEMPLATE_ROOT, safeName(productId));
}

/**
 * Sorted by name, which is also the order they are uploaded in — so numbering
 * files 1-size-chart.png, 2-care.png gives a predictable gallery.
 */
export async function listTemplates(productId: string): Promise<TemplateImage[]> {
  try {
    const folder = folderFor(productId);
    const names = (await readdir(folder)).filter((name) => extensionOf(name) in ALLOWED_TYPES);
    names.sort((a, b) => a.localeCompare(b, "en", { numeric: true }));

    return await Promise.all(
      names.map(async (name) => ({
        name,
        size: (await readFile(join(folder, name))).byteLength,
      })),
    );
  } catch {
    return [];
  }
}

export async function readTemplate(productId: string, name: string): Promise<Buffer> {
  return readFile(join(folderFor(productId), safeName(name)));
}

export async function saveTemplate(
  productId: string,
  name: string,
  bytes: Buffer,
): Promise<TemplateImage> {
  const safe = safeName(name);
  contentTypeFor(safe);

  const folder = folderFor(productId);
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, safe), bytes);

  return { name: safe, size: bytes.byteLength };
}

export async function deleteTemplate(productId: string, name: string): Promise<void> {
  await rm(join(folderFor(productId), safeName(name)), { force: true });
}
