"use client";

/**
 * Shrinks an image before it is uploaded.
 *
 * Netlify rejects a function request whose body is larger than the plan allows,
 * and the files this app deals with — print-ready artwork, mockup photos — are
 * comfortably over it. A local run has no such limit, which is why this only
 * ever mattered once the site was deployed.
 */

interface Options {
  /** Longest edge of the result, in pixels. */
  maxEdge: number;
  /** Redraw smaller rather than send anything heavier than this. */
  budget: number;
  /**
   * Whether a fully opaque image may be re-encoded as JPEG. Photographs shrink
   * far better that way; artwork on a transparent canvas cannot take it, since
   * JPEG would flatten the transparency into a solid block.
   */
  allowJpeg: boolean;
}

/** The design sent for analysis. The vision model resizes to about this
 *  anyway, so the detail beyond it never reaches the model. */
export const FOR_ANALYSIS: Options = { maxEdge: 1200, budget: 900 * 1024, allowJpeg: false };

/** Template photos, which go on to Etsy as real listing photos and are looked
 *  at by buyers — so they keep more resolution than the design does. */
export const FOR_ETSY: Options = { maxEdge: 2000, budget: 800 * 1024, allowJpeg: true };

function isSvg(file: File): boolean {
  return (
    file.type === "image/svg+xml" ||
    file.type === "text/xml" ||
    file.name.toLowerCase().endsWith(".svg")
  );
}

/** Whether every pixel is fully opaque, which decides PNG against JPEG. */
function isOpaque(context: CanvasRenderingContext2D, width: number, height: number): boolean {
  const { data } = context.getImageData(0, 0, width, height);
  for (let alpha = 3; alpha < data.length; alpha += 4) {
    if (data[alpha] !== 255) return false;
  }
  return true;
}

interface Encoded {
  blob: Blob;
  type: string;
}

async function redraw(bitmap: ImageBitmap, maxEdge: number, allowJpeg: boolean): Promise<Encoded | null> {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;

  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

  const type = allowJpeg && isOpaque(context, canvas.width, canvas.height) ? "image/jpeg" : "image/png";
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, type === "image/jpeg" ? 0.85 : undefined),
  );

  return blob ? { blob, type } : null;
}

function renamed(file: File, type: string): string {
  const stem = file.name.replace(/\.[^.]+$/, "");
  return `${stem}.${type === "image/jpeg" ? "jpg" : "png"}`;
}

/**
 * Returns a smaller copy, or the original when it is already small enough,
 * cannot be decoded, or would not benefit. Never throws — a failure here should
 * let the upload go ahead as it did before rather than block the seller.
 */
export async function prepareForUpload(file: File, options: Options): Promise<File> {
  const ready = await shrinkForUpload(file, options);

  // Shrinking gives the file back untouched when the browser could not decode
  // it, and sending it anyway means the platform cuts the request off with an
  // empty reply. Better to say so here, where the file name is still to hand.
  if (!isSvg(ready) && ready.size > options.budget * 2) {
    throw new Error(
      `${file.name} could not be prepared for upload. Re-save it as a PNG or JPEG and try again.`,
    );
  }

  return ready;
}

async function shrinkForUpload(file: File, options: Options): Promise<File> {
  // The server rasterises SVG itself, and the source is text — leave it alone.
  if (isSvg(file) || file.size <= options.budget) return file;

  try {
    const bitmap = await createImageBitmap(file);
    try {
      let encoded = await redraw(bitmap, options.maxEdge, options.allowJpeg);
      // One more pass at two thirds the size, for the files that are still
      // heavy — a detailed photograph, mostly.
      if (encoded && encoded.blob.size > options.budget) {
        encoded =
          (await redraw(bitmap, Math.round(options.maxEdge * 0.66), options.allowJpeg)) ?? encoded;
      }
      // Re-encoding can grow an already well-compressed file; keep the smaller.
      if (!encoded || encoded.blob.size >= file.size) return file;

      return new File([encoded.blob], renamed(file, encoded.type), { type: encoded.type });
    } finally {
      bitmap.close();
    }
  } catch {
    return file;
  }
}
