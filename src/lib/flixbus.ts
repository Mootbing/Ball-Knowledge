// ── FlixBus pricing via global.api.flixbus.com (v4) ───────────────────────
//
// Uses FlixBus's own public search API — no API key needed.
// Station UUIDs from our GTFS data map directly to FlixBus station IDs.

const FLIX_API = "https://global.api.flixbus.com/search/service/v4/search";

// ── Response types ────────────────────────────────────────────────────────

interface FlixPrice {
  total: number;
  original: number;
  average: number;
}

interface FlixDeparture {
  date: string; // ISO "2026-03-20T01:05:00-04:00"
  city_id: string;
  station_id: string;
}

interface FlixResult {
  uid: string;
  status: string;
  transfer_type: string; // "Direct" | ...
  departure: FlixDeparture;
  arrival: FlixDeparture;
  duration: { hours: number; minutes: number };
  price: FlixPrice;
}

interface FlixTripDay {
  results: Record<string, FlixResult>;
}

interface FlixSearchResponse {
  trips?: FlixTripDay[];
}

// ── Public types for matching ─────────────────────────────────────────────

export interface FlixTrip {
  uid: string;
  departIso: string;
  arriveIso: string;
  departMin: number; // minutes from midnight (local)
  price: number;
  currency: string;
  transferType: string;
  departureCityId: string;
  arrivalCityId: string;
}

// ── API ───────────────────────────────────────────────────────────────────

/**
 * Fetch FlixBus trip prices between two stations on a given date.
 * Uses FlixBus's own public v4 search API (no key required).
 *
 * @param fromStationId FlixBus station UUID (without 'f:' prefix)
 * @param toStationId   FlixBus station UUID (without 'f:' prefix)
 * @param dateYMD       Date as YYYY-MM-DD
 * @returns Parsed trips with prices, or empty array on failure
 */
export async function fetchFlixTrips(
  fromStationId: string,
  toStationId: string,
  dateYMD: string
): Promise<FlixTrip[]> {
  // Convert YYYY-MM-DD to DD.MM.YYYY
  const [y, m, d] = dateYMD.split("-");
  const flixDate = `${d}.${m}.${y}`;

  const params = new URLSearchParams({
    from_station_id: fromStationId,
    to_station_id: toStationId,
    departure_date: flixDate,
    products: JSON.stringify({ adult: 1 }),
    currency: "USD",
    locale: "en_US",
    search_by: "stations",
    include_after_midnight_departures: "1",
  });

  const url = `${FLIX_API}?${params}`;

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      console.warn(`[flixbus] API ${res.status} for ${fromStationId} → ${toStationId}`);
      return [];
    }

    const data = (await res.json()) as FlixSearchResponse;
    if (!data.trips?.length) return [];

    // Flatten all trips/results into our simplified format
    const results: FlixTrip[] = [];
    for (const tripDay of data.trips) {
      for (const r of Object.values(tripDay.results ?? {})) {
        if (r.status !== "available") continue;

        const depMatch = r.departure?.date?.match(/T(\d{2}):(\d{2})/);
        const departMin = depMatch
          ? parseInt(depMatch[1], 10) * 60 + parseInt(depMatch[2], 10)
          : -1;

        results.push({
          uid: r.uid,
          departIso: r.departure.date,
          arriveIso: r.arrival.date,
          departMin,
          price: r.price.total,
          currency: "USD",
          transferType: r.transfer_type,
          departureCityId: r.departure.city_id,
          arrivalCityId: r.arrival.city_id,
        });
      }
    }

    return results;
  } catch (err) {
    console.warn("[flixbus] fetch error:", (err as Error).message);
    return [];
  }
}

/**
 * Given a FlixBus GTFS stop ID (e.g. "f:abc123-..."), strip the prefix
 * to get the native FlixBus station UUID.
 */
export function gtfsIdToFlixId(gtfsStopId: string): string | null {
  if (!gtfsStopId.startsWith("f:")) return null;
  return gtfsStopId.substring(2);
}

/**
 * Find the best matching trip for a specific departure from FlixBus trips.
 *
 * Matches by finding the trip whose departure time is closest to the expected
 * departure (within a 30-minute window).
 *
 * @param trips     Parsed FlixBus trip results
 * @param departMin Expected departure in minutes from midnight (EST)
 * @returns The matched FlixTrip or null if no match
 */
export function matchTrip(
  trips: FlixTrip[],
  departMin: number
): FlixTrip | null {
  if (trips.length === 0) return null;

  let bestTrip: FlixTrip | null = null;
  let bestDiff = Infinity;

  for (const trip of trips) {
    if (trip.departMin < 0) continue;
    const diff = Math.abs(trip.departMin - (departMin % 1440));

    if (diff < bestDiff && diff <= 30) {
      bestDiff = diff;
      bestTrip = trip;
    }
  }

  return bestTrip;
}
