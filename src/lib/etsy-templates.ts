import { listKeys, readBytes, readJson, remove, writeBytes, writeJson } from "./storage";

/**
 * Template photos — size chart, care card, colour chart — that go on every
 * listing for a given blank. See storage.ts for where the bytes land.
 */

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
 * trusted — a name like "../../etsy-tokens.json" must not reach a key.
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

function prefixFor(productId: string): string {
  return `templates/${safeName(productId)}`;
}

function keyFor(productId: string, name: string): string {
  return `${prefixFor(productId)}/${safeName(name)}`;
}

/**
 * The gallery order, kept beside the images under a name the image-only
 * listing filter skips.
 */
function orderKey(productId: string): string {
  return `${prefixFor(productId)}/.order.json`;
}

/**
 * Stores the order the seller arranged. Names not in storage are dropped and
 * files missing from the list keep their place at the end, so a stale order
 * from a deleted photo cannot hide a real one.
 */
export async function setOrder(productId: string, names: string[]): Promise<TemplateImage[]> {
  await writeJson(orderKey(productId), names.map(safeName));
  return listTemplates(productId);
}

/**
 * In the order the seller arranged, which is also the upload order. Anything
 * not yet ordered — a photo added since — follows in name order.
 */
export async function listTemplates(productId: string): Promise<TemplateImage[]> {
  const present = (await listKeys(prefixFor(productId))).filter(
    (name) => extensionOf(name) in ALLOWED_TYPES,
  );
  const order = (await readJson<string[]>(orderKey(productId))) ?? [];

  const ordered = order.filter((name) => present.includes(name));
  const rest = present
    .filter((name) => !ordered.includes(name))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));

  return Promise.all(
    [...ordered, ...rest].map(async (name) => ({
      name,
      size: (await readBytes(keyFor(productId, name)))?.byteLength ?? 0,
    })),
  );
}

export async function readTemplate(productId: string, name: string): Promise<Buffer> {
  const bytes = await readBytes(keyFor(productId, name));
  if (!bytes) throw new Error("No such image.");
  return bytes;
}

export async function saveTemplate(
  productId: string,
  name: string,
  bytes: Buffer,
): Promise<TemplateImage> {
  const safe = safeName(name);
  contentTypeFor(safe);

  await writeBytes(keyFor(productId, safe), bytes);
  return { name: safe, size: bytes.byteLength };
}

export async function deleteTemplate(productId: string, name: string): Promise<void> {
  await remove(keyFor(productId, name));
}
