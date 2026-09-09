"use client";

import { useEffect, useState } from "react";
import type { AuditedListing, ListingPerformance, ShopReport as Report } from "@/lib/shop-report";

interface Reply {
  shop?: { shopName: string };
  report?: Report;
  audit?: AuditedListing[];
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
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
  return (
    <ul className="report-rows">
      {listings.map((entry) => (
        <li key={entry.listingId}>
          <a
            href={`https://www.etsy.com/listing/${entry.listingId}`}
            target="_blank"
            rel="noreferrer"
          >
            {entry.title}
          </a>
          <span>
            {showRevenue && <strong>{money(entry.revenue, currency)}</strong>}
            {showRevenue && entry.unitsSold > 0 && ` · ${entry.unitsSold} sold`}
            {showRevenue && entry.unitsSold > 0 && entry.favorites > 0 && " · "}
            {entry.favorites > 0 && `${entry.favorites} favourites`}
            {!showRevenue && entry.favorites === 0 && "no favourites, no sales"}
          </span>
        </li>
      ))}
    </ul>
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

  return (
    <>
      <div className="card">
        <div className="stats">
          <Stat label="Revenue" value={money(report.totalRevenue, report.currency)} />
          <Stat label="Items sold" value={String(report.unitsSold)} />
          <Stat label="Live listings" value={String(report.listingCount)} />
          <Stat
            label="Listings that sold"
            value={`${sellers.length}/${report.listingCount}`}
          />
        </div>
        <p className="hint">
          Favourites and sales come from Etsy&apos;s API. Views, visits and follower counts are not
          in it at all — those stay in your Etsy dashboard.
        </p>
      </div>

      {sellers.length > 0 && (
        <section className="card">
          <h3 style={{ marginTop: 0 }}>Best sellers</h3>
          <ListingRows listings={sellers.slice(0, 10)} currency={report.currency} />
        </section>
      )}

      {report.favoritedNeverSold.length > 0 && (
        <section className="card">
          <h3 style={{ marginTop: 0 }}>Favourited, never sold</h3>
          <p className="hint" style={{ marginTop: 0 }}>
            Buyers found these and wanted them, then did not buy. The listing is reaching people;
            something after that — price, photos, shipping cost — is losing them.
          </p>
          <ListingRows
            listings={report.favoritedNeverSold.slice(0, 10)}
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
            yourself, and start with those below that earn nothing.
          </p>
          <ul className="report-rows audit-rows">
            {audit.slice(0, 25).map((entry) => (
              <li key={entry.listingId}>
                <a
                  href={`https://www.etsy.com/listing/${entry.listingId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {entry.title}
                </a>
                <ul>
                  {entry.warnings.map((warning) => (
                    <li key={`${warning.field}-${warning.message}`}>{warning.message}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}

      {report.unnoticed.length > 0 && (
        <section className="card">
          <h3 style={{ marginTop: 0 }}>
            No favourites, no sales ({report.unnoticed.length})
          </h3>
          <p className="hint" style={{ marginTop: 0 }}>
            Nothing is reaching these. That points at the listing itself — the title, the tags, the
            category — rather than at the design.
          </p>
          <ListingRows
            listings={report.unnoticed.slice(0, 10)}
            currency={report.currency}
            showRevenue={false}
          />
        </section>
      )}
    </>
  );
}
