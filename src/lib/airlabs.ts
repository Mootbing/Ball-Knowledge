// ── AirLabs flight schedule verification ─────────────────────────────────
//
// Uses the /routes endpoint to check if a Frontier (F9) route operates on a
// given day of the week and to retrieve scheduled departure/arrival times.
// Free tier: 1,000 calls/month, 50 results max per request.

const AIRLABS_API = "https://airlabs.co/api/v9";

export interface AirLabsFlight {
  airline_iata?: string;
  flight_iata?: string;
  flight_number?: string;
  dep_iata?: string;
  arr_iata?: string;
  dep_time?: string; // "HH:MM" local time (routes) or "YYYY-MM-DD HH:MM" (schedules)
  arr_time?: string;
  days?: number[]; // day-of-week: varies by API (could be 1=Mon or 0=Sun)
  duration?: number; // minutes
}

export interface RouteCheckResult {
  dep: string;
  arr: string;
  exists: boolean;
  flights: AirLabsFlight[];
}

// In-memory cache to conserve API calls (1,000/month limit)
const cache = new Map<string, { data: AirLabsFlight[]; ts: number }>();
const CACHE_TTL = 12 * 60 * 60 * 1000; // 12 hours

export async function checkFrontierRoutes(
  legs: { dep: string; arr: string }[],
  date: string, // YYYY-MM-DD
  apiKey: string
): Promise<RouteCheckResult[]> {
  // Deduplicate route pairs
  const unique = new Map<string, { dep: string; arr: string }>();
  for (const l of legs) {
    const key = `${l.dep}-${l.arr}`;
    if (!unique.has(key)) unique.set(key, l);
  }

  const results: RouteCheckResult[] = [];
  const toFetch: { key: string; dep: string; arr: string }[] = [];

  // Check cache first
  for (const [key, leg] of unique) {
    const cached = cache.get(key);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      const filtered = filterByDate(cached.data, date);
      results.push({
        dep: leg.dep,
        arr: leg.arr,
        exists: filtered.length > 0,
        flights: filtered,
      });
    } else {
      toFetch.push({ key, ...leg });
    }
  }

  // Fetch uncached routes in parallel (max 4 concurrent)
  const BATCH = 4;
  for (let i = 0; i < toFetch.length; i += BATCH) {
    const batch = toFetch.slice(i, i + BATCH);
    const fetched = await Promise.all(
      batch.map(async ({ key, dep, arr }) => {
        try {
          const params = new URLSearchParams({
            api_key: apiKey,
            airline_iata: "F9",
            dep_iata: dep,
            arr_iata: arr,
          });
          const res = await fetch(`${AIRLABS_API}/routes?${params}`, {
            signal: AbortSignal.timeout(8000),
          });
          if (!res.ok) {
            console.warn(`[airlabs] ${res.status} for ${dep}-${arr}`);
            return { key, dep, arr, data: [] as AirLabsFlight[] };
          }
          const json = await res.json();
          if (json.error) {
            console.warn(`[airlabs] API error:`, json.error);
            return { key, dep, arr, data: [] as AirLabsFlight[] };
          }
          return {
            key,
            dep,
            arr,
            data: (json.response ?? []) as AirLabsFlight[],
          };
        } catch (err) {
          console.warn(`[airlabs] fetch error for ${dep}-${arr}:`, (err as Error).message);
          return { key, dep, arr, data: [] as AirLabsFlight[] };
        }
      })
    );

    for (const { key, dep, arr, data } of fetched) {
      cache.set(key, { data, ts: Date.now() });
      const filtered = filterByDate(data, date);
      results.push({
        dep,
        arr,
        exists: filtered.length > 0,
        flights: filtered,
      });
    }
  }

  return results;
}

/**
 * Filter flights to those operating on the given date's day-of-week.
 * AirLabs `days` array format may use 1=Mon..7=Sun or 0=Sun..6=Sat.
 * We handle both by checking JS getDay() (0=Sun) and ISO day (1=Mon..7=Sun).
 */
function filterByDate(flights: AirLabsFlight[], date: string): AirLabsFlight[] {
  const d = new Date(date + "T12:00:00Z");
  const jsDow = d.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const isoDow = jsDow === 0 ? 7 : jsDow; // 1=Mon, ..., 7=Sun

  return flights.filter((f) => {
    if (!f.days || f.days.length === 0) return true; // no days info → assume daily
    // Check both numbering schemes
    return f.days.includes(jsDow) || f.days.includes(isoDow);
  });
}

/**
 * Parse a time string ("HH:MM" or "YYYY-MM-DD HH:MM") into minutes from midnight.
 */
export function parseTimeToMinutes(time: string): number | null {
  // Try "HH:MM" format
  const shortMatch = time.match(/^(\d{1,2}):(\d{2})$/);
  if (shortMatch) {
    return parseInt(shortMatch[1], 10) * 60 + parseInt(shortMatch[2], 10);
  }
  // Try "YYYY-MM-DD HH:MM" format
  const longMatch = time.match(/(\d{1,2}):(\d{2})$/);
  if (longMatch) {
    return parseInt(longMatch[1], 10) * 60 + parseInt(longMatch[2], 10);
  }
  return null;
}
