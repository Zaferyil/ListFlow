"use client";

/**
 * Shrinks a design before it is uploaded for analysis.
 *
 * A print-ready file is several thousand pixels wide, and Netlify rejects a
 * function request whose body is larger than the plan allows — so a 1.2 MB PNG
 * that works locally comes back as "Request size exceeds the allowed limit for
 * your account tier" once deployed. Nothing is lost by sending less: the vision
 * model resizes the image to around a thousand pixels itself, so the extra
 * detail never reaches it.
 */

/** Roughly what the vision model keeps, so shrinking this far costs nothing. */
const MAX_EDGE = 1200;

/** Below this a file is already small enough to send untouched. */
const SEND_AS_IS = 700 * 1024;

/** If the first pass is still heavy, redraw smaller rather than give up. */
const SECOND_PASS_OVER = 1_500 * 1024;
const SECOND_PASS_EDGE = 800;

function isSvg(file: File): boolean {
  return (
    file.type === "image/svg+xml" ||
    file.type === "text/xml" ||
    file.name.toLowerCase().endsWith(".svg")
  );
}

/** PNG throughout: these designs sit on a transparent canvas, and JPEG would
 *  flatten that to a black or white block the model then describes. */
function toPng(bitmap: ImageBitmap, maxEdge: number): Promise<Blob | null> {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));

  const context = canvas.getContext("2d");
  if (!context) return Promise.resolve(null);

  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

function renamed(file: File): string {
  return file.name.replace(/\.[^.]+$/, "") + ".png";
}

/**
 * Returns a smaller copy, or the original when it is already small, cannot be
 * decoded, or would not benefit. Never throws — a failure here should let the
 * upload proceed as it did before rather than block the seller.
 */
export async function shrinkForUpload(file: File): Promise<File> {
  // The server rasterises SVG itself, and the source is text — leave it alone.
  if (isSvg(file) || file.size <= SEND_AS_IS) return file;

  try {
    const bitmap = await createImageBitmap(file);
    try {
      let blob = await toPng(bitmap, MAX_EDGE);
      if (blob && blob.size > SECOND_PASS_OVER) {
        blob = (await toPng(bitmap, SECOND_PASS_EDGE)) ?? blob;
      }
      // Re-encoding can grow a well-compressed file; keep whichever is smaller.
      if (!blob || blob.size >= file.size) return file;

      return new File([blob], renamed(file), { type: "image/png" });
    } finally {
      bitmap.close();
    }
  } catch {
    return file;
  }
}
