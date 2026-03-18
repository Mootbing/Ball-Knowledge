const API_BASE = "https://api.elections.kalshi.com/trade-api/v2";

interface KalshiMarket {
  ticker: string;
  title: string;
  subtitle: string;
  yes_bid_dollars: string;
  yes_ask_dollars: string;
  last_price_dollars: string;
  event_ticker: string;
  status: string;
}

interface KalshiEvent {
  event_ticker: string;
  title: string;
  sub_title: string;
  series_ticker: string;
  markets: KalshiMarket[];
}

interface KalshiResponse {
  events: KalshiEvent[];
  cursor: string;
}

export interface KalshiGameOdds {
  event_ticker: string;
  title: string;
  /** e.g. "Mar 18" from sub_title */
  date_hint: string;
  away_team: string;
  home_team: string;
  away_yes: number;
  home_yes: number;
}

/** Parse "LAL at HOU (Mar 18)" style sub_title */
function parseSubTitle(sub: string): { away: string; home: string; dateHint: string } | null {
  // Format: "LAL at HOU (Mar 18)" or "TOR at DEN (Mar 20)"
  const match = sub.match(/^(\w+)\s+at\s+(\w+)\s+\((.+)\)$/);
  if (!match) return null;
  return { away: match[1], home: match[2], dateHint: match[3] };
}

export async function fetchNBAOdds(): Promise<KalshiGameOdds[]> {
  const allOdds: KalshiGameOdds[] = [];
  let cursor = "";

  // Paginate through all open NBA game events
  do {
    const url = new URL(`${API_BASE}/events`);
    url.searchParams.set("series_ticker", "KXNBAGAME");
    url.searchParams.set("status", "open");
    url.searchParams.set("with_nested_markets", "true");
    url.searchParams.set("limit", "50");
    if (cursor) url.searchParams.set("cursor", cursor);

    const res = await fetch(url.toString(), {
      next: { revalidate: 60 }, // refresh odds every minute
    });

    if (!res.ok) break;

    const data: KalshiResponse = await res.json();
    cursor = data.cursor;

    for (const event of data.events) {
      const parsed = parseSubTitle(event.sub_title);
      if (!parsed) continue;

      // Find market for each team
      let awayYes = 0;
      let homeYes = 0;

      for (const market of event.markets) {
        const teamCode = market.ticker.split("-").pop() ?? "";
        const yesAsk = parseFloat(market.yes_ask_dollars) || 0;
        const yesBid = parseFloat(market.yes_bid_dollars) || 0;
        // Use midpoint of bid/ask for display, fall back to last price
        const mid = yesBid > 0 && yesAsk > 0 ? (yesBid + yesAsk) / 2 : parseFloat(market.last_price_dollars) || 0;

        if (teamCode === parsed.away) {
          awayYes = mid;
        } else if (teamCode === parsed.home) {
          homeYes = mid;
        }
      }

      allOdds.push({
        event_ticker: event.event_ticker,
        title: event.title,
        date_hint: parsed.dateHint,
        away_team: parsed.away,
        home_team: parsed.home,
        away_yes: awayYes,
        home_yes: homeYes,
      });
    }
  } while (cursor);

  return allOdds;
}

// Team abbreviation mapping: Kalshi code -> common name fragments for matching
const TEAM_NAMES: Record<string, string[]> = {
  ATL: ["atlanta", "hawks"],
  BOS: ["boston", "celtics"],
  BKN: ["brooklyn", "nets"],
  CHA: ["charlotte", "hornets"],
  CHI: ["chicago", "bulls"],
  CLE: ["cleveland", "cavaliers", "cavs"],
  DAL: ["dallas", "mavericks", "mavs"],
  DEN: ["denver", "nuggets"],
  DET: ["detroit", "pistons"],
  GSW: ["golden state", "warriors"],
  HOU: ["houston", "rockets"],
  IND: ["indiana", "pacers"],
  LAC: ["los angeles c", "clippers", "la clippers"],
  LAL: ["los angeles l", "lakers", "la lakers"],
  MEM: ["memphis", "grizzlies"],
  MIA: ["miami", "heat"],
  MIL: ["milwaukee", "bucks"],
  MIN: ["minnesota", "timberwolves", "wolves"],
  NOP: ["new orleans", "pelicans"],
  NYK: ["new york", "knicks"],
  OKC: ["oklahoma city", "thunder"],
  ORL: ["orlando", "magic"],
  PHI: ["philadelphia", "76ers", "sixers"],
  PHX: ["phoenix", "suns"],
  POR: ["portland", "trail blazers", "blazers"],
  SAC: ["sacramento", "kings"],
  SAS: ["san antonio", "spurs"],
  TOR: ["toronto", "raptors"],
  UTA: ["utah", "jazz"],
  WAS: ["washington", "wizards"],
};

/** Check if a TM event name contains a team */
function nameMatchesTeam(eventName: string, teamCode: string): boolean {
  const lower = eventName.toLowerCase();
  const names = TEAM_NAMES[teamCode];
  if (!names) return false;
  return names.some((n) => lower.includes(n));
}

/**
 * Match Kalshi odds to a Ticketmaster event by checking:
 * 1. Both team names appear in the TM event name
 * 2. The EST date matches the Kalshi date hint (e.g., "Mar 18")
 */
export function matchOddsToEvent(
  tmName: string,
  tmEstDate: string,
  odds: KalshiGameOdds[]
): KalshiGameOdds | null {
  // Parse TM date to "Mar DD" format for comparison
  const [y, m, d] = tmEstDate.split("-").map(Number);
  const dateObj = new Date(y, m - 1, d);
  const tmDateHint = dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  for (const o of odds) {
    if (o.date_hint !== tmDateHint) continue;
    if (nameMatchesTeam(tmName, o.away_team) && nameMatchesTeam(tmName, o.home_team)) {
      return o;
    }
  }
  return null;
}
