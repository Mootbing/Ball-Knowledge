const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY ?? "";

interface TravelTimes {
  driveMinutes: number;
  transitMinutes: number | null;
  transitFare: string | null;
  transitDepartureTime: string | null; // ISO string from Google
  transitArrivalTime: string | null;   // ISO string from Google
  uberEstimate: string | null;
  lyftEstimate: string | null;
}

// In-memory cache: "lat1,lng1;lat2,lng2" -> TravelTimes
const cache = new Map<string, TravelTimes>();

function cacheKey(
  fromLat: number, fromLng: number,
  toLat: number, toLng: number
): string {
  return `${fromLat.toFixed(4)},${fromLng.toFixed(4)};${toLat.toFixed(4)},${toLng.toFixed(4)}`;
}

/** Haversine distance in km */
function haversineKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Fallback estimate from straight-line distance */
function estimateDriveMinutes(
  fromLat: number, fromLng: number,
  toLat: number, toLng: number
): number {
  const km = haversineKm(fromLat, fromLng, toLat, toLng);
  return Math.round((km * 1.4) / 50 * 60);
}

async function fetchGoogleDirections(
  fromLat: number, fromLng: number,
  toLat: number, toLng: number,
  mode: "driving" | "transit",
  timeConstraint?: { arriveBy?: number; departAfter?: number }, // Unix seconds
  transitMode?: "bus" | "rail"
): Promise<{
  minutes: number;
  fareUsd: string | null;
  departureTime: number | null; // Unix seconds
  arrivalTime: number | null;   // Unix seconds
} | null> {
  if (!GOOGLE_API_KEY) return null;
  try {
    let url = `https://maps.googleapis.com/maps/api/directions/json?origin=${fromLat},${fromLng}&destination=${toLat},${toLng}&mode=${mode}&key=${GOOGLE_API_KEY}`;
    if (mode === "transit" && timeConstraint?.arriveBy) {
      url += `&arrival_time=${timeConstraint.arriveBy}`;
    } else if (mode === "transit" && timeConstraint?.departAfter) {
      url += `&departure_time=${timeConstraint.departAfter}`;
    }
    if (mode === "transit" && transitMode) {
      url += `&transit_mode=${transitMode}`;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    const leg = data?.routes?.[0]?.legs?.[0];
    const seconds = leg?.duration?.value;
    if (seconds == null) return null;
    // Extract fare if available and in USD
    const fare = data?.routes?.[0]?.fare;
    const fareUsd = fare && fare.currency === "USD" ? fare.text : null;
    // Extract transit departure/arrival times (Unix seconds)
    const departureTime: number | null = leg?.departure_time?.value ?? null;
    const arrivalTime: number | null = leg?.arrival_time?.value ?? null;
    return { minutes: Math.round(seconds / 60), fareUsd, departureTime, arrivalTime };
  } catch {
    return null;
  }
}

/** Math-based ride-share estimate from distance + time */
function estimateRideFare(
  miles: number, minutes: number,
  baseFare: number, perMile: number, perMinute: number, minFare: number
): string {
  const low = Math.max(minFare, Math.round(baseFare + perMile * miles + perMinute * minutes));
  const high = Math.round(low * 1.3); // surge / variability buffer
  return low === high ? `~$${low}` : `~$${low}\u2013${high}`;
}

function estimateRides(
  fromLat: number, fromLng: number,
  toLat: number, toLng: number,
  driveMinutes: number
): { uber: string; lyft: string } {
  const miles = haversineKm(fromLat, fromLng, toLat, toLng) * 0.6214 * 1.4; // road-adjusted
  return {
    // UberX: $2.50 base + $1.50/mi + $0.25/min, $7 min
    uber: estimateRideFare(miles, driveMinutes, 2.5, 1.5, 0.25, 7),
    // Lyft: $2.00 base + $1.35/mi + $0.20/min, $6 min
    lyft: estimateRideFare(miles, driveMinutes, 2.0, 1.35, 0.20, 6),
  };
}

export async function getTravelTimes(
  fromLat: number, fromLng: number,
  toLat: number, toLng: number,
  transitConstraint?: { arriveBy?: number; departAfter?: number }
): Promise<TravelTimes> {
  const constraintSuffix = transitConstraint?.arriveBy
    ? `:a${transitConstraint.arriveBy}`
    : transitConstraint?.departAfter
      ? `:d${transitConstraint.departAfter}`
      : "";
  const key = cacheKey(fromLat, fromLng, toLat, toLng) + constraintSuffix;
  const cached = cache.get(key);
  if (cached) return cached;

  // Fetch driving and transit in parallel
  const [driveResult, transitResult] = await Promise.all([
    fetchGoogleDirections(fromLat, fromLng, toLat, toLng, "driving"),
    fetchGoogleDirections(fromLat, fromLng, toLat, toLng, "transit", transitConstraint),
  ]);

  const driveMin = driveResult?.minutes ?? estimateDriveMinutes(fromLat, fromLng, toLat, toLng);

  const rides = estimateRides(fromLat, fromLng, toLat, toLng, driveMin);

  const result: TravelTimes = {
    driveMinutes: driveMin,
    transitMinutes: transitResult?.minutes ?? null,
    transitFare: transitResult?.fareUsd ?? null,
    transitDepartureTime: transitResult?.departureTime
      ? new Date(transitResult.departureTime * 1000).toISOString()
      : null,
    transitArrivalTime: transitResult?.arrivalTime
      ? new Date(transitResult.arrivalTime * 1000).toISOString()
      : null,
    uberEstimate: rides.uber,
    lyftEstimate: rides.lyft,
  };

  cache.set(key, result);
  return result;
}

export async function getTransitTime(
  fromLat: number, fromLng: number,
  toLat: number, toLng: number,
  transitMode: "bus" | "rail",
  timeConstraint?: { arriveBy?: number; departAfter?: number }
): Promise<{
  minutes: number | null;
  fare: string | null;
  departureTime: string | null;
  arrivalTime: string | null;
}> {
  const result = await fetchGoogleDirections(
    fromLat, fromLng, toLat, toLng, "transit", timeConstraint, transitMode
  );
  if (!result) return { minutes: null, fare: null, departureTime: null, arrivalTime: null };
  return {
    minutes: result.minutes,
    fare: result.fareUsd,
    departureTime: result.departureTime ? new Date(result.departureTime * 1000).toISOString() : null,
    arrivalTime: result.arrivalTime ? new Date(result.arrivalTime * 1000).toISOString() : null,
  };
}

/** Small delay helper */
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface AirportWithTimes {
  code: string;
  name: string;
  lat: number;
  lng: number;
  driveMinutes: number;
  transitMinutes: number | null;
  transitFare: string | null;
  uberEstimate: string | null;
  lyftEstimate: string | null;
}

export async function getAirportsWithTravelTimes(
  venueLat: number,
  venueLng: number,
  airports: { code: string; name: string; lat: number; lng: number }[]
): Promise<AirportWithTimes[]> {
  const results: TravelTimes[] = [];
  for (const apt of airports) {
    const times = await getTravelTimes(venueLat, venueLng, apt.lat, apt.lng);
    results.push(times);
    if (airports.length > 1) await delay(100);
  }
  return airports.map((apt, i) => ({
    code: apt.code,
    name: apt.name,
    lat: apt.lat,
    lng: apt.lng,
    driveMinutes: results[i].driveMinutes,
    transitMinutes: results[i].transitMinutes,
    transitFare: results[i].transitFare,
    uberEstimate: results[i].uberEstimate,
    lyftEstimate: results[i].lyftEstimate,
  }));
}
