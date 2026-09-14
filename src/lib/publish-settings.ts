/**
 * A blank's publishing settings, kept where clearing a browser cannot reach.
 *
 * These lived only in localStorage, which survives a reload and a restart but
 * not "clear cookies and site data" — and they are not a browser convenience
 * like a remembered tab. A sixteen-line size run with its prices is work, typed
 * once and relied on for every listing off that blank afterwards, and losing it
 * to a routine browser clean-out is losing it for no reason the seller could
 * have anticipated.
 *
 * So they go to the same store that already holds the Etsy connection and the
 * template photos. That also makes them the same settings on a phone as on the
 * desktop, which is what a seller means by "my settings" in any case.
 */

import { readJson, remove, writeJson } from "./storage";

/** Shape is the panel's business; this only has to keep it whole. */
export type StoredSettings = Record<string, unknown>;

/**
 * Product ids are ours rather than the seller's, but they arrive over a query
 * string, and a key is a path on both backends: anything that could climb out
 * of the settings prefix is not a product id.
 */
function keyFor(productId: string): string | null {
  const id = productId.trim();
  return /^[A-Za-z0-9._-]{1,80}$/.test(id) && !id.startsWith(".")
    ? `settings/${id}.json`
    : null;
}

export async function readSettings(productId: string): Promise<StoredSettings | null> {
  const key = keyFor(productId);
  return key ? await readJson<StoredSettings>(key) : null;
}

export async function writeSettings(
  productId: string,
  settings: StoredSettings,
): Promise<boolean> {
  const key = keyFor(productId);
  if (!key) return false;

  await writeJson(key, settings);
  return true;
}

export async function clearSettings(productId: string): Promise<boolean> {
  const key = keyFor(productId);
  if (!key) return false;

  await remove(key);
  return true;
}
