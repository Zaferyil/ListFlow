"use client";

import { useEffect, useState } from "react";
import type { SeasonGap, WorkItem } from "@/lib/worklist";
import type { PriceBand } from "@/lib/shop-report";
import type { CompetingGroup } from "@/lib/cannibalization";
import { RewriteListing } from "./RewriteListing";

interface Reply {
  worklist?: WorkItem[];
  gaps?: SeasonGap[];
  priceBand?: PriceBand | null;
  competing?: CompetingGroup[];
  salesError?: string;
  error?: string;
  needsReconnect?: boolean;
}

/** What a listing has behind it, said in the order the evidence counts. */
function evidence(entry: CompetingGroup["keep"]): string {
  return [
    entry.unitsSold > 0 ? `${entry.unitsSold} sold` : null,
    entry.favorites > 0 ? `${entry.favorites} favourite${entry.favorites === 1 ? "" : "s"}` : null,
    `${entry.imageCount} photo${entry.imageCount === 1 ? "" : "s"}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

function EtsyLink({ listingId, title }: { listingId: number; title: string }) {
  return (
    <a href={`https://www.etsy.com/listing/${listingId}`} target="_blank" rel="noreferrer">
      {title}
    </a>
  );
}

/**
 * Listings in the shop chasing the same search as each other.
 *
 * Etsy shows one shop only so often for a given query, so these do not add up
 * — they divide. Named by the words they share, so the grouping can be checked
 * against the titles rather than taken on trust, and headed by the one with the
 * most behind it, because splitting a query is only worth solving if something
 * is kept whole.
 */
function CompetingGroups({ groups }: { groups: CompetingGroup[] }) {
  const [limit, setLimit] = useState(5);
  const crowded = groups.reduce((sum, group) => sum + group.others.length, 0);

  return (
    <section className="card">
      <h3 style={{ marginTop: 0 }}>Listings competing with each other ({groups.length})</h3>
      <p className="hint" style={{ marginTop: 0 }}>
        Etsy shows one shop only so often for a given query, so listings built around the same
        phrase do not double your chances — they split them, and the weakest drags on the rest.{" "}
        <strong>{crowded}</strong> listings are sharing a query with a stronger one here.
      </p>
      <p className="hint">
        The fix is rarely deletion. Give each one a different opening phrase and a different buyer —
        the occasion, the recipient, the style — so they stop answering the same search. Where a
        listing has nothing of its own to say, letting it end instead of renewing is a decision too.
      </p>

      <ul className="competing">
        {groups.slice(0, limit).map((group) => (
          <li key={group.keep.listingId}>
            <span className="competing-phrase">{group.phrase}</span>
            <div className="competing-keep">
              <span className="competing-tag">Keep</span>
              <EtsyLink listingId={group.keep.listingId} title={group.keep.title} />
              <span className="work-why">{evidence(group.keep)}</span>
            </div>
            <ul>
              {group.others.map((other) => (
                <li key={other.listingId}>
                  <EtsyLink listingId={other.listingId} title={other.title} />
                  <span className="work-why">{evidence(other)}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>

      {groups.length > limit && (
        <button type="button" className="ghost" onClick={() => setLimit(limit + 10)}>
          Show more — {groups.length - limit} further groups
        </button>
      )}
    </section>
  );
}

/**
 * What to pick up next, in order.
 *
 * The other tabs each answer part of it — what earns, what is weak, what season
 * is coming — and leave the seller to hold all three at once. This does that
 * reasoning and shows its working: every entry says why it is where it is,
 * because a ranking nobody can check is a ranking nobody should follow.
 */
export function WorkList() {
  const [reply, setReply] = useState<Reply | null>(null);
  const [limit, setLimit] = useState(10);
  // Which listings this visit has rewritten. The queue was worked out when the
  // page loaded, so it still describes the version each rewrite replaced — the
  // entry says which of them that is now true of.
  const [updated, setUpdated] = useState<number[]>([]);

  useEffect(() => {
    fetch("/api/etsy/worklist")
      .then((response) => response.json())
      .then(setReply)
      .catch(() => setReply({ error: "Could not reach your shop." }));
  }, []);

  if (!reply) {
    return (
      <div className="card">
        <p className="hint" style={{ margin: 0 }}>
          Working out where to start…
        </p>
      </div>
    );
  }

  if (reply.error) {
    return (
      <div className="card">
        <div className="alert error" style={{ marginTop: 0 }}>
          {reply.error}
        </div>
        {reply.needsReconnect && (
          <a className="primary" href="/api/etsy/connect">
            Reconnect to Etsy
          </a>
        )}
      </div>
    );
  }

  const worklist = reply.worklist ?? [];
  const gaps = reply.gaps ?? [];

  return (
    <>
      {reply.salesError && <div className="alert warn">{reply.salesError}</div>}

      <div className="card">
        <p className="hint" style={{ marginTop: 0 }}>
          Your listings in the order worth picking them up, weighing the season against how much
          each has to gain. Listings that have sold are left out entirely: Etsy weighs a listing&apos;s
          own history, and there is no version of improving one that is worth risking what already
          works. Where the wording is the fault, the rewrite sits on the entry itself — it shows
          both versions and changes nothing on Etsy until you accept it.
        </p>

        {reply.priceBand && (
          <p className="hint">
            Prices here are weighed against what your buyers have actually paid:{" "}
            <strong>
              ${reply.priceBand.low.toFixed(2)}–${reply.priceBand.high.toFixed(2)}
            </strong>
            , usually around ${reply.priceBand.median.toFixed(2)}, across the{" "}
            {reply.priceBand.from} listings that have sold. A listing asking more than anything in
            that range is not wrong, but it is the cheapest thing on this list to test.
          </p>
        )}

        {worklist.length === 0 && (
          <p className="hint">Nothing pressing. Every listing either sells or has no fault to fix.</p>
        )}

        <ol className="worklist">
          {worklist.slice(0, limit).map((item) => {
            const isUpdated = updated.includes(item.listingId);
            return (
              <li key={item.listingId} className={isUpdated ? "updated" : undefined}>
                <a
                  href={`https://www.etsy.com/listing/${item.listingId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {isUpdated && (
                    <span className="updated-badge" aria-label="Updated">
                      ✓
                    </span>
                  )}
                  {item.title}
                </a>
                <span className="work-why">{item.reasons.join(" · ")}</span>
                <ul>
                  {item.actions.map((action) => (
                    <li key={action}>{action}</li>
                  ))}
                </ul>
                {/*
                  Offered only where the wording is what is wrong. A listing
                  held back by its photos gains nothing from new words, and
                  rewriting it spends the search history it has earned.
                */}
                {item.findings > 0 && (
                  <RewriteListing
                    listingId={item.listingId}
                    onApplied={() => setUpdated((current) => [...current, item.listingId])}
                  />
                )}
              </li>
            );
          })}
        </ol>

        {worklist.length > limit && (
          <button type="button" className="ghost" onClick={() => setLimit(limit + 25)}>
            Show more — {worklist.length - limit} further down the queue
          </button>
        )}
      </div>

      {(reply.competing ?? []).length > 0 && (
        <CompetingGroups groups={reply.competing ?? []} />
      )}

      {gaps.length > 0 && (
        <section className="card">
          <h3 style={{ marginTop: 0 }}>Seasons with nothing listed</h3>
          <p className="hint" style={{ marginTop: 0 }}>
            A gap is a design to make rather than a listing to mend, so it is not ranked against the
            queue above. Only the next four months are shown — further out than that and there is
            nothing to decide yet.
          </p>
          <ul className="report-rows">
            {gaps.map((gap) => (
              <li key={gap.occasion}>
                <strong>{gap.occasion}</strong>
                <span>buying opens in {gap.daysToBuying} days</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
