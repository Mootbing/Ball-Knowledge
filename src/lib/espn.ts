export interface TeamRecord {
  wins: number;
  losses: number;
}

// ESPN abbreviation → Kalshi abbreviation mapping
const ESPN_TO_KALSHI: Record<string, string> = {
  GS: "GSW",
  SA: "SAS",
  NO: "NOP",
  NY: "NYK",
  WSH: "WAS",
  UTAH: "UTA",
  PHO: "PHX",
};

function normalizeAbbr(espnAbbr: string): string {
  const upper = espnAbbr.toUpperCase();
  return ESPN_TO_KALSHI[upper] ?? upper;
}

export interface EspnTicketInfo {
  price: number;
  available: number;
  url: string | null;
}

/**
 * Fetch ticket prices from ESPN scoreboard for a set of dates.
 * Returns a map keyed by "AWAYCODE@HOMECODE" (normalized Kalshi codes) → ticket info.
 */
export async function fetchEspnTickets(dates: string[]): Promise<Record<string, EspnTicketInfo>> {
  const results: Record<string, EspnTicketInfo> = {};
  const uniqueDates = [...new Set(dates)];

  await Promise.all(
    uniqueDates.map(async (date) => {
      try {
        const dateParam = date.replace(/-/g, "");
        const res = await fetch(
          `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${dateParam}`,
          { next: { revalidate: 300 } }
        );
        if (!res.ok) return;

        const data = await res.json();
        const events = data.events ?? [];

        for (const ev of events) {
          // Extract team codes from competitions
          const comp = ev.competitions?.[0];
          if (!comp) continue;

          const competitors = comp.competitors ?? [];
          let homeCode: string | null = null;
          let awayCode: string | null = null;
          for (const c of competitors) {
            const abbr = normalizeAbbr(c.team?.abbreviation ?? "");
            if (c.homeAway === "home") homeCode = abbr;
            else if (c.homeAway === "away") awayCode = abbr;
          }

          if (!homeCode || !awayCode) continue;

          // Extract ticket info
          const tickets = ev.tickets ?? comp.tickets ?? [];
          if (tickets.length === 0) continue;

          const ticket = tickets[0];
          const summary: string = ticket.summary ?? "";
          const priceMatch = summary.match(/\$(\d+)/);
          if (!priceMatch) continue;

          const key = `${awayCode}@${homeCode}`;
          results[key] = {
            price: parseInt(priceMatch[1], 10),
            available: ticket.numberAvailable ?? 0,
            url: ticket.links?.[0]?.href ?? null,
          };
        }
      } catch {
        // skip failed date
      }
    })
  );

  return results;
}

export async function fetchNBAStandings(): Promise<Record<string, TeamRecord>> {
  const res = await fetch(
    "https://site.api.espn.com/apis/v2/sports/basketball/nba/standings",
    { next: { revalidate: 3600 } }
  );

  if (!res.ok) return {};

  const data = await res.json();
  const records: Record<string, TeamRecord> = {};

  // ESPN response: { children: [{ standings: { entries: [...] } }] }
  const conferences = data.children ?? [];
  for (const conf of conferences) {
    const entries = conf.standings?.entries ?? [];
    for (const entry of entries) {
      const abbr = entry.team?.abbreviation;
      if (!abbr) continue;

      const stats = entry.stats ?? [];
      let wins = 0;
      let losses = 0;
      for (const stat of stats) {
        if (stat.name === "wins") wins = stat.value;
        if (stat.name === "losses") losses = stat.value;
      }

      records[normalizeAbbr(abbr)] = { wins, losses };
    }
  }

  return records;
}
