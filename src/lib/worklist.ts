/**
 * One ordered list of what to do next.
 *
 * The shop report, the audit and the calendar each answer a different question,
 * and deciding what to actually pick up means holding all three at once: which
 * listings earn nothing, which are weak, and whose season is about to arrive.
 * That reasoning is the same every time, so it is done here rather than left to
 * be redone by hand on every visit.
 *
 * Two rules shape it. A listing that has sold is never here — Etsy weighs a
 * listing's own history, and there is no version of "improve this" worth
 * risking what already works. And every entry says why it is where it is,
 * because a ranking nobody can check is a ranking nobody should follow.
 */

import { OCCASIONS } from "./season";

export interface WorkCandidate {
  listingId: number;
  title: string;
  favorites: number;
  unitsSold: number;
  imageCount: number;
  /** Epoch seconds. */
  createdAt: number;
  /** How many findings the audit raised against its wording. */
  findings: number;
}

export interface WorkItem {
  listingId: number;
  title: string;
  /** Why it sits where it does, strongest first. */
  reasons: string[];
  /** What to do about it, most useful first. */
  actions: string[];
  /**
   * How many findings the audit raised against its wording.
   *
   * Carried through so the queue can offer a rewrite exactly where one is the
   * answer. A listing held back by its photos is not helped by new words, and
   * rewriting it spends the search history it has earned for nothing.
   */
  findings: number;
}

/** Photos the listings that sell in a shop like this one carry. */
const WANTED_IMAGES = 5;

/** Long enough live that drawing nobody is an answer rather than a wait. */
const SETTLED_DAYS = 60;

const DAY = 86_400_000;

function ageInDays(createdAt: number): number {
  return createdAt ? Math.max(0, Math.floor((Date.now() / 1000 - createdAt) / 86_400)) : 0;
}

/** The soonest occasion this listing is written for, if any. */
function seasonFor(title: string, now: Date): { name: string; daysToBuying: number } | null {
  const haystack = title.toLowerCase();
  let soonest: { name: string; daysToBuying: number } | null = null;

  for (const occasion of OCCASIONS) {
    if (!occasion.keywords.some((keyword) => haystack.includes(keyword))) continue;

    const year = now.getUTCFullYear();
    const thisYear = occasion.date(year);
    const date =
      thisYear.getTime() + occasion.buyingClosesDays * DAY >= now.getTime()
        ? thisYear
        : occasion.date(year + 1);

    const daysToBuying = Math.ceil(
      (date.getTime() - occasion.buyingOpensDays * DAY - now.getTime()) / DAY,
    );
    if (!soonest || daysToBuying < soonest.daysToBuying) {
      soonest = { name: occasion.name, daysToBuying };
    }
  }

  return soonest;
}

/**
 * What to work on, most pressing first.
 *
 * Season decides the order above all else, because it is the only factor with a
 * deadline: a thin Christmas listing in September can still be fixed in time,
 * and the same listing in December cannot. Everything else — too few photos, no
 * interest after months live, a title that breaks the rules — says how much
 * there is to gain once you are there.
 */
export function buildWorklist(candidates: WorkCandidate[], now = new Date()): WorkItem[] {
  const scored = candidates
    // A listing that sells is not a problem to solve.
    .filter((candidate) => candidate.unitsSold === 0)
    .map((candidate) => {
      const reasons: string[] = [];
      const actions: string[] = [];
      let score = 0;

      const season = seasonFor(candidate.title, now);
      if (season) {
        if (season.daysToBuying <= 0) {
          score += 100;
          reasons.push(`${season.name} buyers are shopping now`);
        } else if (season.daysToBuying <= 30) {
          score += 70;
          reasons.push(`${season.name} buying opens in ${season.daysToBuying} days`);
        } else if (season.daysToBuying <= 60) {
          score += 40;
          reasons.push(`${season.name} buying opens in ${season.daysToBuying} days`);
        }
      }

      if (candidate.imageCount < 3) {
        score += 45;
        reasons.push(`only ${candidate.imageCount} photo${candidate.imageCount === 1 ? "" : "s"}`);
        actions.push(
          `Add photos. The listings that sell in this shop carry eight or more; this has ${candidate.imageCount}.`,
        );
      } else if (candidate.imageCount < WANTED_IMAGES) {
        score += 30;
        reasons.push(`${candidate.imageCount} photos`);
        actions.push(`Add photos — ${candidate.imageCount} now, and the ones that sell have eight or more.`);
      }

      const age = ageInDays(candidate.createdAt);
      if (candidate.favorites === 0 && age >= SETTLED_DAYS) {
        score += 25;
        reasons.push(`live ${age} days without a single favourite`);
      } else if (candidate.favorites > 0) {
        score += 15;
        reasons.push(`${candidate.favorites} favourites but no sale`);
        actions.push(
          "Buyers are finding this and stopping short of buying. Look at the price and the photos before the wording.",
        );
      }

      if (candidate.findings > 0) {
        score += Math.min(candidate.findings * 3, 15);
        actions.push(
          `Rewrite the wording — the audit raised ${candidate.findings} finding${candidate.findings === 1 ? "" : "s"}.`,
        );
      }

      return { candidate, score, reasons, actions };
    })
    // Nothing to say about it is nothing to do about it.
    .filter((entry) => entry.reasons.length > 0)
    .sort((a, b) => b.score - a.score);

  return scored.map(({ candidate, reasons, actions }) => ({
    listingId: candidate.listingId,
    title: candidate.title,
    reasons,
    actions,
    findings: candidate.findings,
  }));
}

export interface SeasonGap {
  occasion: string;
  daysToBuying: number;
}

/**
 * Occasions with nothing listed against them at all.
 *
 * A gap is a different kind of work from a weak listing — it is a design to
 * make, not a listing to mend — so it is reported apart from the queue rather
 * than ranked against it.
 */
export function seasonGaps(titles: string[], now = new Date()): SeasonGap[] {
  const haystacks = titles.map((title) => title.toLowerCase());

  return OCCASIONS.map((occasion) => {
    const year = now.getUTCFullYear();
    const thisYear = occasion.date(year);
    const date =
      thisYear.getTime() + occasion.buyingClosesDays * DAY >= now.getTime()
        ? thisYear
        : occasion.date(year + 1);

    return {
      occasion: occasion.name,
      daysToBuying: Math.ceil(
        (date.getTime() - occasion.buyingOpensDays * DAY - now.getTime()) / DAY,
      ),
      covered: haystacks.some((title) =>
        occasion.keywords.some((keyword) => title.includes(keyword)),
      ),
    };
  })
    .filter((entry) => !entry.covered && entry.daysToBuying > 0 && entry.daysToBuying <= 120)
    .sort((a, b) => a.daysToBuying - b.daysToBuying)
    .map(({ occasion, daysToBuying }) => ({ occasion, daysToBuying }));
}
