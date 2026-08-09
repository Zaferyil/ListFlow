"use client";

import { useState } from "react";
import { ETSY_LIMITS, type Listing, type ListingWarning } from "@/lib/etsy";

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className="ghost"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/**
 * Fields are ordered title → description → tags to match the order they are
 * filled in on Etsy's own listing form.
 */
export function ListingCard({
  listing,
  warnings = [],
  heading,
}: {
  listing: Listing;
  warnings?: ListingWarning[];
  heading?: string;
}) {
  return (
    <article className="card listing">
      {heading && <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>{heading}</h2>}

      {warnings.map((warning) => (
        <div key={`${warning.field}-${warning.message}`} className="alert warn">
          {warning.message}
        </div>
      ))}

      <section>
        <div className="meta">
          <h3>Title</h3>
          <span>
            {listing.title.length}/{ETSY_LIMITS.titleMaxChars} <CopyButton value={listing.title} />
          </span>
        </div>
        <p className="title">{listing.title}</p>
      </section>

      <section>
        <div className="meta">
          <h3>Description</h3>
          <CopyButton value={listing.description} />
        </div>
        <pre>{listing.description}</pre>
      </section>

      <section>
        <div className="meta">
          <h3>Tags</h3>
          <span>
            {listing.tags.length}/{ETSY_LIMITS.maxTags}{" "}
            <CopyButton value={listing.tags.join(", ")} />
          </span>
        </div>
        <ul className="tags">
          {listing.tags.map((tag) => (
            <li key={tag}>{tag}</li>
          ))}
        </ul>
      </section>

      {listing.materials.length > 0 && (
        <section>
          <h3>Materials</h3>
          <ul className="tags">
            {listing.materials.map((material) => (
              <li key={material}>{material}</li>
            ))}
          </ul>
        </section>
      )}

      {listing.category && (
        <section>
          <h3>Suggested category</h3>
          <p style={{ margin: 0 }}>{listing.category}</p>
        </section>
      )}

      {listing.notes && (
        <section>
          <h3>Strategy note</h3>
          <p style={{ margin: 0, color: "var(--muted)" }}>{listing.notes}</p>
        </section>
      )}
    </article>
  );
}
