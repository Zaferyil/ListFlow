import { Resvg } from "@resvg/resvg-js";

/**
 * Vision models don't accept SVG, so uploaded vector files are rasterised
 * server-side before they reach the API.
 *
 * resvg is used rather than a browser-based renderer because it neither
 * executes scripts nor fetches remote resources — an uploaded SVG is untrusted
 * input, and both are attack surfaces we don't want.
 */

/** Wide enough for the model to read fine detail, small enough to stay cheap. */
const RENDER_WIDTH = 1024;

const LIGHT_BACKGROUND = "#ffffff";
const DARK_BACKGROUND = "#1b1b1b";

/** Above this mean luminance (0-255) the artwork is too light for a white background. */
const LIGHT_ARTWORK_THRESHOLD = 170;

/** Below this share of visible pixels we treat the render as empty. */
const MIN_COVERAGE = 0.001;

export interface RasterizedSvg {
  /** Base64 PNG, without the data: URI prefix. */
  data: string;
  /** Which background the transparent areas were flattened onto. */
  background: "light" | "dark";
}

/**
 * Measures how bright the artwork itself is, ignoring transparent areas.
 * Returns null when effectively nothing was drawn.
 */
function artworkLuminance(pixels: Buffer | Uint8Array): number | null {
  let weighted = 0;
  let coverage = 0;

  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3] / 255;
    if (alpha < 0.05) continue;
    // Rec. 709 luma, weighted by alpha so soft edges count proportionally.
    weighted += (0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]) * alpha;
    coverage += alpha;
  }

  if (coverage / (pixels.length / 4) < MIN_COVERAGE) return null;
  return weighted / coverage;
}

/**
 * Renders an SVG to PNG, flattening transparency onto a background chosen to
 * keep the artwork visible. Cut files and print-ready designs are usually a
 * single colour on transparency: flattening a white design onto white would
 * hand the model a blank image, so light artwork gets a dark background instead.
 */
export function rasterizeSvg(source: Buffer): RasterizedSvg {
  const fitTo = { mode: "width", value: RENDER_WIDTH } as const;

  let probe;
  try {
    probe = new Resvg(source, { fitTo }).render();
  } catch (error) {
    throw new Error(
      `SVG dosyasi okunamadi: ${error instanceof Error ? error.message : "bilinmeyen hata"}`,
    );
  }

  const luminance = artworkLuminance(probe.pixels);
  if (luminance === null) {
    throw new Error(
      "SVG bos gorunuyor. Dosyada gomulu yazi tipi veya dis kaynak varsa cizim olusturulamamis olabilir; PNG olarak disa aktarip tekrar deneyin.",
    );
  }

  const background = luminance > LIGHT_ARTWORK_THRESHOLD ? "dark" : "light";
  const rendered = new Resvg(source, {
    fitTo,
    background: background === "dark" ? DARK_BACKGROUND : LIGHT_BACKGROUND,
  }).render();

  return { data: rendered.asPng().toString("base64"), background };
}
