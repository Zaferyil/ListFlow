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

/** How many template photos a blank may keep, all of which go on the listing. */
export const MAX_TEMPLATE_IMAGES = 15;

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
 *
 * The order file is what says a photo exists, not the key listing. On Netlify
 * Blobs a listing is only eventually consistent: a photo written a moment ago
 * may be absent from it, which showed up as an upload that appeared only once
 * the next one was added. Reading a key by name is immediate, so the listing is
 * now used to find photos the order file has not heard of, and each candidate
 * is confirmed by the read that fetches its size anyway.
 */
export async function listTemplates(productId: string): Promise<TemplateImage[]> {
  const order = (await readJson<string[]>(orderKey(productId))) ?? [];
  const discovered = await listKeys(prefixFor(productId));

  const known = new Set(order);
  const rest = discovered
    .filter((name) => !known.has(name))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));

  const candidates = [...new Set([...order, ...rest])].filter(
    (name) => extensionOf(name) in ALLOWED_TYPES,
  );

  const found = await Promise.all(
    candidates.map(async (name) => {
      const bytes = await readBytes(keyFor(productId, name));
      // A name left over from a deleted photo simply is not there any more.
      return bytes ? { name, size: bytes.byteLength } : null;
    }),
  );

  return found.filter((image): image is TemplateImage => image !== null);
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

  // Recorded here so the photo is listed straight away, at the end of the
  // gallery — where uploading it puts it.
  const order = (await readJson<string[]>(orderKey(productId))) ?? [];
  if (!order.includes(safe)) {
    await writeJson(orderKey(productId), [...order, safe]);
  }

  return { name: safe, size: bytes.byteLength };
}

export async function deleteTemplate(productId: string, name: string): Promise<void> {
  const safe = safeName(name);
  await remove(keyFor(productId, safe));

  const order = (await readJson<string[]>(orderKey(productId))) ?? [];
  if (order.includes(safe)) {
    await writeJson(
      orderKey(productId),
      order.filter((entry) => entry !== safe),
    );
  }
}
