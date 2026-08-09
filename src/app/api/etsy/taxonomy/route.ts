import { NextResponse } from "next/server";
import { apiKeyHeader, isEtsyConfigured } from "@/lib/etsy-api";

export const runtime = "nodejs";
// The seller taxonomy is effectively static; caching it keeps the picker snappy
// and stays well inside Etsy's rate limits.
export const revalidate = 86400;

interface TaxonomyNode {
  id: number;
  name: string;
  children?: TaxonomyNode[];
}

/** Depth-first walk collecting leaf nodes with their readable path. */
function flatten(nodes: TaxonomyNode[], trail: string[] = []): { id: number; path: string }[] {
  return nodes.flatMap((node) => {
    const path = [...trail, node.name];
    return node.children?.length
      ? flatten(node.children, path)
      : [{ id: node.id, path: path.join(" > ") }];
  });
}

/**
 * Etsy's seller taxonomy, narrowed to Clothing. This shop only sells garments,
 * and the full tree is thousands of entries — most of them noise in a picker.
 */
export async function GET() {
  if (!isEtsyConfigured()) {
    return NextResponse.json({ error: "ETSY_KEYSTRING / ETSY_SHARED_SECRET are not set." }, { status: 501 });
  }

  try {
    // Public endpoint: the app key is enough, no seller authorization needed.
    const response = await fetch("https://openapi.etsy.com/v3/application/seller-taxonomy/nodes", {
      headers: { "x-api-key": apiKeyHeader() },
      next: { revalidate },
    });

    if (!response.ok) {
      throw new Error(`Etsy returned ${response.status}`);
    }

    const body = (await response.json()) as { results: TaxonomyNode[] };
    const clothing = body.results.filter((node) => /^(clothing|shoes)/i.test(node.name));

    return NextResponse.json({ categories: flatten(clothing.length ? clothing : body.results) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load Etsy categories.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
