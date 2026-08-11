import { mkdir, readFile, readdir, rm, writeFile } from "fs/promises";
import { dirname, join } from "path";

/**
 * Where the app keeps what has to outlive a request: the Etsy connection and
 * the template photos.
 *
 * On your own machine that is a folder under .data/. On Netlify each function
 * invocation starts with an empty filesystem, so the same reads and writes go
 * to Netlify Blobs instead. Everything above this file works in terms of keys
 * and bytes and does not know which one it got.
 */

/** Netlify sets this on every deploy, and nothing sets it locally. */
function onNetlify(): boolean {
  return Boolean(process.env.NETLIFY);
}

const STORE_NAME = "listflow";
const ROOT = join(process.cwd(), ".data");

/** Loaded lazily so the dependency is never pulled in during a local run. */
async function blobStore() {
  const { getStore } = await import("@netlify/blobs");
  return getStore(STORE_NAME);
}

/** Keys look like "templates/cc-1717/1-size.png" — a path, on either backend. */
function pathFor(key: string): string {
  return join(ROOT, key);
}

export async function readBytes(key: string): Promise<Buffer | null> {
  if (onNetlify()) {
    const blob = await (await blobStore()).get(key, { type: "arrayBuffer" });
    return blob ? Buffer.from(blob) : null;
  }

  try {
    return await readFile(pathFor(key));
  } catch {
    return null;
  }
}

export async function readJson<T>(key: string): Promise<T | null> {
  const bytes = await readBytes(key);
  if (!bytes) return null;

  try {
    return JSON.parse(bytes.toString("utf8")) as T;
  } catch {
    // A half-written or hand-edited file should read as "nothing stored".
    return null;
  }
}

export async function writeBytes(key: string, bytes: Buffer): Promise<void> {
  if (onNetlify()) {
    // Blobs takes an ArrayBuffer; a Buffer view may sit inside a larger pool.
    await (await blobStore()).set(key, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    return;
  }

  await mkdir(dirname(pathFor(key)), { recursive: true });
  // 0600: the token file holds a live Etsy credential.
  await writeFile(pathFor(key), bytes, { mode: 0o600 });
}

export async function writeJson(key: string, value: unknown): Promise<void> {
  await writeBytes(key, Buffer.from(JSON.stringify(value, null, 2), "utf8"));
}

export async function remove(key: string): Promise<void> {
  if (onNetlify()) {
    await (await blobStore()).delete(key);
    return;
  }

  await rm(pathFor(key), { force: true });
}

/**
 * The keys directly under a prefix, without the prefix. Both backends are
 * flat enough that this only needs one level.
 */
export async function listKeys(prefix: string): Promise<string[]> {
  const withSlash = prefix.endsWith("/") ? prefix : `${prefix}/`;

  if (onNetlify()) {
    const { blobs } = await (await blobStore()).list({ prefix: withSlash });
    return blobs.map((blob) => blob.key.slice(withSlash.length)).filter((key) => !key.includes("/"));
  }

  try {
    return await readdir(pathFor(withSlash));
  } catch {
    return [];
  }
}
