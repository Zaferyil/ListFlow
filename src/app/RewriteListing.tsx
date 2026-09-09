"use client";

import { useState } from "react";
import type { Listing, ListingWarning } from "@/lib/etsy";

interface Proposal {
  existing?: { title: string; description: string; tags: string[] };
  proposed?: Listing;
  warnings?: ListingWarning[];
  /** Figures the rewrite states that the live listing never did. */
  introduced?: string[];
  error?: string;
}

function Field({ label, before, after }: { label: string; before: string; after: string }) {
  const changed = before.trim() !== after.trim();
  return (
    <div className="diff-field">
      <h4>
        {label}
        {!changed && <span className="diff-same"> — unchanged</span>}
      </h4>
      <div className="diff-pair">
        <div>
          <span className="diff-label">Now</span>
          <pre>{before || "(empty)"}</pre>
        </div>
        <div>
          <span className="diff-label">Proposed</span>
          <pre className={changed ? "diff-new" : undefined}>{after}</pre>
        </div>
      </div>
    </div>
  );
}

/**
 * One listing's rewrite, proposed and then applied only if the seller says so.
 *
 * The two versions sit side by side because the decision is a comparison: the
 * live listing carries whatever search history it has earned, and better
 * wording is not automatically worth trading that for.
 */
export function RewriteListing({
  listingId,
  onApplied,
}: {
  listingId: number;
  /** Told when the listing changes, so the card around it can say so. */
  onApplied?: () => void;
}) {
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  async function propose() {
    setBusy(true);
    setProposal(null);
    setApplyError(null);
    try {
      const response = await fetch("/api/etsy/rewrite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ listingId }),
      });
      setProposal(await response.json());
    } catch {
      setProposal({ error: "Could not reach the rewriter." });
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!proposal?.proposed) return;
    setBusy(true);
    setApplyError(null);
    try {
      const response = await fetch("/api/etsy/rewrite", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          listingId,
          title: proposal.proposed.title,
          description: proposal.proposed.description,
          tags: proposal.proposed.tags,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "The update was refused.");
      setApplied(true);
      onApplied?.();
    } catch (caught) {
      setApplyError(caught instanceof Error ? caught.message : "Could not update the listing.");
    } finally {
      setBusy(false);
    }
  }

  if (applied) {
    return (
      <p className="hint diff-done">
        Updated on Etsy. The live listing now carries this wording — the findings above described
        the version it replaced.
      </p>
    );
  }

  return (
    <div className="rewrite">
      {!proposal && (
        <button type="button" className="ghost" onClick={propose} disabled={busy}>
          {busy ? "Rewriting…" : "Rewrite this listing"}
        </button>
      )}

      {proposal?.error && <div className="alert error">{proposal.error}</div>}

      {proposal?.proposed && proposal.existing && (
        <>
          <Field label="Title" before={proposal.existing.title} after={proposal.proposed.title} />
          <Field
            label="Tags"
            before={proposal.existing.tags.join(", ")}
            after={proposal.proposed.tags.join(", ")}
          />
          <Field
            label="Description"
            before={proposal.existing.description}
            after={proposal.proposed.description}
          />

          {proposal.proposed.notes && (
            <p className="hint">
              <strong>What changed:</strong> {proposal.proposed.notes}
            </p>
          )}

          {(proposal.introduced ?? []).length > 0 && (
            <div className="alert error">
              <strong>Check these before applying: {(proposal.introduced ?? []).join(", ")}</strong>
              <p style={{ margin: "0.35rem 0 0" }}>
                The rewrite states figures your listing does not — a blank model, a fibre content,
                a fabric weight. They may well be right, but nothing here verified them against the
                product, and a specification on a live listing is one a buyer can hold you to.
                Confirm they match the blank you actually print on, or press Try again.
              </p>
            </div>
          )}

          {(proposal.warnings ?? []).length > 0 && (
            <div className="alert warn">
              The rewrite still falls short in places:
              <ul style={{ margin: "0.35rem 0 0", paddingLeft: "1.1rem" }}>
                {(proposal.warnings ?? []).map((warning) => (
                  <li key={warning.message}>{warning.message}</li>
                ))}
              </ul>
            </div>
          )}

          {applyError && <div className="alert error">{applyError}</div>}

          <div className="actions">
            <button type="button" className="primary" onClick={apply} disabled={busy}>
              {busy ? "Sending…" : "Apply to Etsy"}
            </button>
            <button type="button" className="ghost" onClick={() => setProposal(null)} disabled={busy}>
              Discard
            </button>
            <button type="button" className="ghost" onClick={propose} disabled={busy}>
              Try again
            </button>
          </div>
        </>
      )}
    </div>
  );
}
