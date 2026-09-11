"use client";

import { useEffect, useState } from "react";
import type { SeasonGap, WorkItem } from "@/lib/worklist";

interface Reply {
  worklist?: WorkItem[];
  gaps?: SeasonGap[];
  salesError?: string;
  error?: string;
  needsReconnect?: boolean;
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
          works.
        </p>

        {worklist.length === 0 && (
          <p className="hint">Nothing pressing. Every listing either sells or has no fault to fix.</p>
        )}

        <ol className="worklist">
          {worklist.slice(0, limit).map((item) => (
            <li key={item.listingId}>
              <a
                href={`https://www.etsy.com/listing/${item.listingId}`}
                target="_blank"
                rel="noreferrer"
              >
                {item.title}
              </a>
              <span className="work-why">{item.reasons.join(" · ")}</span>
              <ul>
                {item.actions.map((action) => (
                  <li key={action}>{action}</li>
                ))}
              </ul>
            </li>
          ))}
        </ol>

        {worklist.length > limit && (
          <button type="button" className="ghost" onClick={() => setLimit(limit + 25)}>
            Show more — {worklist.length - limit} further down the queue
          </button>
        )}
      </div>

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
