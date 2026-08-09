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
 * The gallery order, kept beside the images. It is a dotfile with a .json
 * extension, so listTemplates — which only accepts image extensions — never
 * mistakes it for a photo.
 */
const ORDER_FILE = ".order.json";

async function readOrder(productId: string): Promise<string[]> {
  try {
    const raw = await readFile(join(folderFor(productId), ORDER_FILE), "utf8");
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((name): name is string => typeof name === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Stores the order the seller arranged. Names not on disk are dropped and
 * files missing from the list keep their place at the end, so a stale order
 * from a deleted photo cannot hide a real one.
 */
export async function setOrder(productId: string, names: string[]): Promise<TemplateImage[]> {
  const folder = folderFor(productId);
  await mkdir(folder, { recursive: true });
  await writeFile(
    join(folder, ORDER_FILE),
    JSON.stringify(names.map(safeName), null, 2),
  );
  return listTemplates(productId);
}

/**
 * In the order the seller arranged, which is also the upload order. Anything
 * not yet ordered — a photo added since — follows in name order.
 */
export async function listTemplates(productId: string): Promise<TemplateImage[]> {
  try {
    const folder = folderFor(productId);
    const present = (await readdir(folder)).filter((name) => extensionOf(name) in ALLOWED_TYPES);
    const order = await readOrder(productId);

    const ordered = order.filter((name) => present.includes(name));
    const rest = present
      .filter((name) => !ordered.includes(name))
      .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
    const names = [...ordered, ...rest];

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
