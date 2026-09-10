"use client";

import { useEffect, useState } from "react";
import type { SeasonStatus } from "@/lib/season";

/**
 * What is coming, and whether the shop is ready for it.
 *
 * Etsy's API says nothing about the market — no search volume, no trends, no
 * popular terms — so this makes no claim about what is selling out there. It
 * reports the calendar the US market runs on against what the shop has listed,
 * which is what actually decides a seasonal listing: one published after buyers
 * have started has missed the year.
 */
export function SeasonCalendar() {
  const [seasons, setSeasons] = useState<SeasonStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/etsy/season")
      .then((response) => response.json())
      .then((body) => {
        if (body.error) setError(body.error);
        setSeasons(body.seasons ?? []);
      })
      .catch(() => setError("Could not reach your shop."));
  }, []);

  if (error) {
    return (
      <div className="card">
        <div className="alert error" style={{ marginTop: 0 }}>
          {error}
        </div>
      </div>
    );
  }

  if (!seasons) {
    return (
      <div className="card">
        <p className="hint" style={{ margin: 0 }}>
          Reading your listings…
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <p className="hint" style={{ marginTop: 0 }}>
        The US shopping calendar against what you have listed, soonest first. Etsy&apos;s API
        carries nothing about the market — no search volume, no trends — so this does not claim to
        know what is selling out there. It knows when buyers shop and whether you were ready: a
        listing needs weeks in the index before it ranks, and the newest listing in this shop to
        have sold anything was already two months old.
      </p>

      <ul className="report-rows season-rows">
        {seasons.map((season) => {
          const late = season.daysToListBy < 0;
          const missing = season.matching === 0;
          return (
            <li key={season.occasion}>
              <span className="season-head">
                <strong>{season.occasion}</strong>
                <span className="season-when">
                  {season.date} · {season.daysAway} days away
                  {season.phase === "buying" && " · buyers are shopping now"}
                </span>
              </span>

              <span className={missing || late ? "season-note season-late" : "season-note"}>
                {missing
                  ? "Nothing listed for it."
                  : `${season.matching} listing${season.matching === 1 ? "" : "s"}, ${season.seasoned} live early enough to rank.`}{" "}
                {late
                  ? `The date to have published by passed ${-season.daysToListBy} days ago.`
                  : `${season.daysToListBy} days left to publish something that can still rank in time.`}
              </span>

              {season.expiringMidSeason.map((listing) => (
                <span key={listing.listingId} className="season-note season-late">
                  Expires while buyers are still shopping:{" "}
                  <a
                    href={`https://www.etsy.com/listing/${listing.listingId}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {listing.title.slice(0, 60)}
                  </a>
                </span>
              ))}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
