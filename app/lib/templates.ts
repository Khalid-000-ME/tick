/**
 * Market templates, grouped by sport.
 *
 * `templateId` is part of the on-chain market id, so these ids are permanent —
 * append new templates, never renumber existing ones.
 *
 * Every template must be *objectively resolvable* within its window. Anything
 * requiring judgement creates disputes you cannot settle in under a minute, and the
 * reporter has a bond at risk.
 */

export interface Template {
  id: number;
  sport: string;
  question: string;
  /** Unit the operator counts in — "Over", "Point", "Drive". */
  contextLabel: string;
  /** Default market duration in seconds. */
  seconds: number;
  resolvesOn: string;
}

export const TEMPLATES: Template[] = [
  // ── Cricket
  { id: 1, sport: "Cricket", question: "More than 8 runs this over", contextLabel: "Over", seconds: 300,
    resolvesOn: "Total runs conceded in the over, extras included." },
  { id: 2, sport: "Cricket", question: "A wicket falls this over", contextLabel: "Over", seconds: 300,
    resolvesOn: "Any dismissal credited during the over, run-outs included." },
  { id: 3, sport: "Cricket", question: "A boundary off the next ball", contextLabel: "Ball", seconds: 45,
    resolvesOn: "Next legal delivery reaches the rope for four or six." },

  // ── Tennis
  { id: 4, sport: "Tennis", question: "Next point is an ace", contextLabel: "Point", seconds: 45,
    resolvesOn: "Serve is untouched and called in." },
  { id: 5, sport: "Tennis", question: "This game goes to deuce", contextLabel: "Game", seconds: 240,
    resolvesOn: "Score reaches 40–40 at any point in the game." },
  { id: 6, sport: "Tennis", question: "Service break this game", contextLabel: "Game", seconds: 240,
    resolvesOn: "Receiver wins the game." },

  // ── Chess
  { id: 7, sport: "Chess", question: "Next move is a capture", contextLabel: "Move", seconds: 90,
    resolvesOn: "The move played removes a piece from the board." },
  { id: 8, sport: "Chess", question: "Check within the next two moves", contextLabel: "Move", seconds: 150,
    resolvesOn: "Either side delivers check inside the window." },

  // ── Football
  { id: 9, sport: "Football", question: "A goal in the next 10 minutes", contextLabel: "Minute", seconds: 600,
    resolvesOn: "Any goal awarded by the referee inside the window." },
  { id: 10, sport: "Football", question: "Corner from this attack", contextLabel: "Attack", seconds: 60,
    resolvesOn: "Referee awards a corner before play resets." },
  { id: 11, sport: "Football", question: "Card shown in the next 10 minutes", contextLabel: "Minute", seconds: 600,
    resolvesOn: "Yellow or red shown inside the window." },

  // ── Basketball
  { id: 12, sport: "Basketball", question: "Three pointer on this possession", contextLabel: "Possession", seconds: 45,
    resolvesOn: "A successful three-point attempt before possession changes." },
  { id: 13, sport: "Basketball", question: "More than 5 points this minute", contextLabel: "Minute", seconds: 60,
    resolvesOn: "Combined points scored by both teams inside the window." },

  // ── Kabaddi
  { id: 14, sport: "Kabaddi", question: "Successful raid this turn", contextLabel: "Raid", seconds: 45,
    resolvesOn: "Raider returns having touched at least one defender." },

  // ── Esports
  { id: 15, sport: "Esports", question: "First blood in the next 2 minutes", contextLabel: "Minute", seconds: 120,
    resolvesOn: "First kill of the match occurs inside the window." },
  { id: 16, sport: "Esports", question: "This round ends by elimination", contextLabel: "Round", seconds: 120,
    resolvesOn: "Round concludes with a full team wipe rather than an objective." },
];

export function templateById(id: number): Template | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

export function sports(): string[] {
  return Array.from(new Set(TEMPLATES.map((t) => t.sport)));
}

export function templatesForSport(sport: string): Template[] {
  return TEMPLATES.filter((t) => t.sport === sport);
}

/** Emoji-free glyphs, so the UI stays typographic rather than cartoonish. */
export const SPORT_GLYPH: Record<string, string> = {
  Cricket: "◎",
  Tennis: "◍",
  Chess: "◆",
  Football: "⬡",
  Basketball: "◉",
  Kabaddi: "◈",
  Esports: "⬢",
};
