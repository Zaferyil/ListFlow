"use client";

import { useEffect, useState } from "react";
import type { AuditedListing, ListingPerformance, ShopReport as Report } from "@/lib/shop-report";
import { RewriteListing } from "./RewriteListing";

interface Reply {
  shop?: { shopName: string };
  report?: Report;
  audit?: AuditedListing[];
  /** Set when the sales call alone failed; the rest of the report still stands. */
  salesError?: string;
  error?: string;
  needsReconnect?: boolean;
}

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    // An unknown currency code should not take the whole report down with it.
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/**
 * A figure, or an honest gap where one could not be read.
 *
 * Zero and "not available" look identical once a number is printed, and here
 * they could not be further apart: a shop whose sales the app was never
 * permitted to read would otherwise be shown a confident $0.00 and told it has
 * sold nothing.
 */
function Stat({
  label,
  value,
  unavailable = false,
}: {
  label: string;
  value: string;
  unavailable?: boolean;
}) {
  return (
    <div className="stat">
      <span className={`stat-value${unavailable ? " stat-unknown" : ""}`}>
        {unavailable ? "—" : value}
      </span>
      <span className="stat-label">{unavailable ? `${label} — not readable` : label}</span>
    </div>
  );
}

/** Listings as rows: title, then the numbers, so it reads on a phone. */
function ListingRows({
  listings,
  currency,
  showRevenue = true,
}: {
  listings: ListingPerformance[];
  currency: string;
  showRevenue?: boolean;
}) {
  const [limit, setLimit] = useState(10);

  return (
    <>
    <ul className="report-rows">
      {listings.slice(0, limit).map((entry) => (
        <li key={entry.listingId}>
          <a
            href={`https://www.etsy.com/listing/${entry.listingId}`}
            target="_blank"
            rel="noreferrer"
          >
            {entry.title}
          </a>
          <span>
            {[
              // The asking price leads, because for a listing that never sold
              // it is the figure the rest of the row is evidence about.
              entry.price > 0 ? money(entry.price, currency) : null,
              showRevenue ? money(entry.revenue, currency) : null,
              entry.unitsSold > 0 ? `${entry.unitsSold} sold` : null,
              entry.favorites > 0 ? `${entry.favorites} favourites` : null,
              // Age and photo count are why a listing with nothing to show has
              // nothing to show, so they belong beside the zero.
              entry.ageDays > 0 ? `live ${entry.ageDays} days` : null,
              `${entry.imageCount} photo${entry.imageCount === 1 ? "" : "s"}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </li>
      ))}
    </ul>
    {listings.length > limit && (
      <button type="button" className="ghost" onClick={() => setLimit(limit + 25)}>
        Show more — {listings.length - limit} still hidden
      </button>
    )}
    </>
  );
}

/**
 * When a listing last changed, said the way it is asked about.
 *
 * Recent edits are read as "how long ago" — that is the question while working
 * through a list — and anything older as a date, where the day of the week it
 * happened stopped mattering.
 */
function lastEdited(epochSeconds: number): string {
  if (!epochSeconds) return "";

  const days = Math.floor((Date.now() / 1000 - epochSeconds) / 86_400);
  if (days <= 0) return "edited today";
  if (days === 1) return "edited yesterday";
  if (days < 30) return `edited ${days} days ago`;

  return `edited ${new Date(epochSeconds * 1000).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}`;
}

/**
 * The listing id inside whatever was pasted.
 *
 * Reaching for a particular listing, the thing to hand is its URL — from the
 * shop manager, from the listing page, with a #media or a ?ref trailing it. All
 * of them carry the id, and matching on that is exact where matching on a title
 * is a guess.
 */
function listingIdIn(term: string): number | null {
  const digits = term.match(/\d{6,}/);
  return digits ? Number(digits[0]) : null;
}

/**
 * The audited listings, searchable and grown on request.
 *
 * Numbered pages would be the obvious thing and the wrong one: the list is
 * ordered worst first, so a page number is a claim about where a listing sits
 * in a queue the seller is working through, and paging away loses the place
 * they had reached. Searching finds a particular listing; showing more
 * continues down the queue.
 */
function AuditRows({ audit }: { audit: AuditedListing[] }) {
  const [limit, setLimit] = useState(15);
  const [search, setSearch] = useState("");
  // Which listings this visit has changed. The audit itself is a snapshot taken
  // when the page loaded, so it still describes the version each rewrite
  // replaced — the card says which of them that is now true of.
  const [updated, setUpdated] = useState<number[]>([]);

  const term = search.trim().toLowerCase();
  const wantedId = listingIdIn(term);
  const matching = !term
    ? audit
    : wantedId !== null
      ? audit.filter((entry) => entry.listingId === wantedId)
      : audit.filter((entry) => entry.title.toLowerCase().includes(term));
  const visible = matching.slice(0, limit);

  return (
    <>
      <div className="field">
        <label htmlFor="audit-search">Find a listing</label>
        <input
          id="audit-search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setLimit(15);
          }}
          placeholder="Paste a listing URL, or search by title"
        />
      </div>

      {matching.length === 0 && (
        <p className="hint">
          {wantedId !== null
            ? `Nothing audited under listing ${wantedId}. Only listings that fall short of a check appear here, so it may have passed all of them — or it may not be live.`
            : "No listing title matches that. Paste the listing's URL to find it exactly."}
        </p>
      )}

      <ul className="report-rows audit-rows">
        {visible.map((entry) => {
          const isUpdated = updated.includes(entry.listingId);
          return (
            <li key={entry.listingId} className={isUpdated ? "updated" : undefined}>
              <a
                href={`https://www.etsy.com/listing/${entry.listingId}`}
                target="_blank"
                rel="noreferrer"
              >
                {isUpdated && (
                  <span className="updated-badge" aria-label="Updated">
                    ✓
                  </span>
                )}
                {entry.title}
              </a>
              {entry.updatedAt > 0 && (
                <span className="audit-edited">{lastEdited(entry.updatedAt)}</span>
              )}
              <ul>
                {entry.warnings.map((warning) => (
                  <li key={`${warning.field}-${warning.message}`}>{warning.message}</li>
                ))}
              </ul>
              <RewriteListing
                listingId={entry.listingId}
                onApplied={() => setUpdated((current) => [...current, entry.listingId])}
              />
            </li>
          );
        })}
      </ul>

      {matching.length > limit && (
        <button type="button" className="ghost" onClick={() => setLimit(limit + 25)}>
          Show more — {matching.length - limit} still hidden
        </button>
      )}
    </>
  );
}

export function ShopReport() {
  const [reply, setReply] = useState<Reply | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/etsy/analytics")
      .then((response) => response.json())
      .then(setReply)
      .catch(() => setReply({ error: "Could not reach your shop." }))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="card">
        <p className="hint" style={{ margin: 0 }}>
          Reading your shop…
        </p>
      </div>
    );
  }

  if (!reply?.report) {
    return (
      <div className="card">
        <div className="alert error" style={{ marginTop: 0 }}>
          {reply?.error ?? "Could not read your shop."}
        </div>
        {reply?.needsReconnect && (
          <a className="primary" href="/api/etsy/connect">
            Reconnect to Etsy
          </a>
        )}
      </div>
    );
  }

  const { report } = reply;
  const audit = reply.audit ?? [];
  const sellers = report.listings.filter((entry) => entry.unitsSold > 0);
  // Sales could not be read at all, so every figure drawn from them is absent
  // rather than zero — including the never-sold lists, which cannot tell a
  // listing that has sold nothing from one whose sales are invisible here.
  const salesUnknown = Boolean(reply.salesError);

  return (
    <>
      <div className="card">
        <div className="stats">
          <Stat
            label="Revenue"
            value={money(report.totalRevenue, report.currency)}
            unavailable={salesUnknown}
          />
          <Stat label="Items sold" value={String(report.unitsSold)} unavailable={salesUnknown} />
          <Stat label="Live listings" value={String(report.listingCount)} />
          <Stat
            label="Listings that sold"
            value={`${sellers.length}/${report.listingCount}`}
            unavailable={salesUnknown}
          />
        </div>
        {report.priceBand && (
          <p className="hint">
            <strong>What your buyers pay:</strong>{" "}
            {money(report.priceBand.low, report.currency)}–
            {money(report.priceBand.high, report.currency)}, usually around{" "}
            {money(report.priceBand.median, report.currency)}, across the {report.priceBand.from}{" "}
            listings that have sold. This is your own evidence rather than general advice about
            pricing: it says what these buyers have agreed to, not what Etsy sellers charge.
          </p>
        )}
        <p className="hint">
          Favourites and sales come from Etsy&apos;s API. Views, visits and follower counts are not
          in it at all — those stay in your Etsy dashboard.
        </p>
      </div>

      {reply.salesError && (
        <div className="alert warn">
          {reply.salesError}
          {reply.needsReconnect && (
            <>
              {" "}
              <a href="/api/etsy/connect">Reconnect to Etsy</a>
            </>
          )}
        </div>
      )}

      {sellers.length > 0 && (
        <section className="card">
          <h3 style={{ marginTop: 0 }}>Best sellers</h3>
          <ListingRows listings={sellers} currency={report.currency} />
        </section>
      )}

      {report.favoritedNeverSold.length > 0 && (
        <section className="card">
          <h3 style={{ marginTop: 0 }}>Favourited, never sold</h3>
          <p className="hint" style={{ marginTop: 0 }}>
            {salesUnknown
              ? "Favourited listings. Whether any of them sold cannot be read on this connection, so treat this as \u201cfavourited\u201d rather than \u201cnever sold\u201d until sales access is granted."
              : report.priceBand
                ? `Buyers found these and wanted them, then did not buy. The listing is reaching people; something after that — price, photos, shipping cost — is losing them. Each row leads with what it asks: compare it against the ${money(report.priceBand.low, report.currency)}–${money(report.priceBand.high, report.currency)} your buyers have actually paid.`
                : "Buyers found these and wanted them, then did not buy. The listing is reaching people; something after that — price, photos, shipping cost — is losing them."}
          </p>
          <ListingRows
            listings={report.favoritedNeverSold}
            currency={report.currency}
            showRevenue={false}
          />
        </section>
      )}

      {audit.length > 0 && (
        <section className="card">
          <h3 style={{ marginTop: 0 }}>SEO audit ({audit.length})</h3>
          <p className="hint" style={{ marginTop: 0 }}>
            Your live listings against the same rules a new one is written to, worst first. This
            reads only — nothing is changed. Etsy weighs a listing&apos;s own history, so a listing
            that already sells is not obviously improved by a rewrite: pick the ones to act on
            yourself, and start with those that earn nothing. Rewriting shows both versions side by
            side and changes nothing on Etsy until you accept it.
          </p>
          <AuditRows audit={audit} />
        </section>
      )}

      {report.unnoticed.length > 0 && (
        <section className="card">
          <h3 style={{ marginTop: 0 }}>
            No favourites, no sales ({report.unnoticed.length})
          </h3>
          <p className="hint" style={{ marginTop: 0 }}>
            Nothing is reaching these, oldest first — one live for months without a single
            favourite has been answered, where last week&apos;s has not been asked yet. Check the
            photo count as well as the wording: Etsy search is a grid of images, and a listing with
            one or two photos loses the click before the title is ever read.
          </p>
          <ListingRows
            listings={report.unnoticed}
            currency={report.currency}
            showRevenue={false}
          />
        </section>
      )}
    </>
  );
}
