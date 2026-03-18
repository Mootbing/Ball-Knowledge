const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY ?? "";
const UBER_SERVER_TOKEN = process.env.UBER_SERVER_TOKEN ?? "";
const LYFT_CLIENT_ID = process.env.LYFT_CLIENT_ID ?? "";
const LYFT_CLIENT_SECRET = process.env.LYFT_CLIENT_SECRET ?? "";

interface TravelTimes {
  driveMinutes: number;
  transitMinutes: number | null;
  transitFare: string | null;
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
  mode: "driving" | "transit"
): Promise<{ minutes: number; fareUsd: string | null } | null> {
  if (!GOOGLE_API_KEY) return null;
  try {
    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${fromLat},${fromLng}&destination=${toLat},${toLng}&mode=${mode}&key=${GOOGLE_API_KEY}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    const seconds = data?.routes?.[0]?.legs?.[0]?.duration?.value;
    if (seconds == null) return null;
    // Extract fare if available and in USD
    const fare = data?.routes?.[0]?.fare;
    const fareUsd = fare && fare.currency === "USD" ? fare.text : null;
    return { minutes: Math.round(seconds / 60), fareUsd };
  } catch {
    return null;
  }
}

async function fetchUberEstimate(
  fromLat: number, fromLng: number,
  toLat: number, toLng: number
): Promise<string | null> {
  if (!UBER_SERVER_TOKEN) return null;
  try {
    const url = `https://api.uber.com/v1.2/estimates/price?start_latitude=${fromLat}&start_longitude=${fromLng}&end_latitude=${toLat}&end_longitude=${toLng}`;
    const res = await fetch(url, {
      headers: { Authorization: `Token ${UBER_SERVER_TOKEN}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const uberX = data.prices?.find((p: any) => p.display_name === "UberX");
    if (!uberX) return data.prices?.[0]?.estimate ?? null;
    return uberX.estimate;
  } catch { return null; }
}

let lyftToken: { token: string; expires: number } | null = null;

async function getLyftToken(): Promise<string | null> {
  if (lyftToken && Date.now() < lyftToken.expires) return lyftToken.token;
  if (!LYFT_CLIENT_ID || !LYFT_CLIENT_SECRET) return null;
  try {
    const res = await fetch("https://api.lyft.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${LYFT_CLIENT_ID}:${LYFT_CLIENT_SECRET}`).toString("base64")}`,
      },
      body: JSON.stringify({ grant_type: "client_credentials", scope: "public" }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    lyftToken = { token: data.access_token, expires: Date.now() + (data.expires_in - 60) * 1000 };
    return data.access_token;
  } catch { return null; }
}

async function fetchLyftEstimate(
  fromLat: number, fromLng: number,
  toLat: number, toLng: number
): Promise<string | null> {
  const token = await getLyftToken();
  if (!token) return null;
  try {
    const url = `https://api.lyft.com/v1/cost?start_lat=${fromLat}&start_lng=${fromLng}&end_lat=${toLat}&end_lng=${toLng}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const lyft = data.cost_estimates?.find((c: any) => c.ride_type === "lyft");
    const est = lyft ?? data.cost_estimates?.[0];
    if (!est) return null;
    const low = Math.round(est.estimated_cost_cents_min / 100);
    const high = Math.round(est.estimated_cost_cents_max / 100);
    return `$${low}\u2013${high}`;
  } catch { return null; }
}

export async function getTravelTimes(
  fromLat: number, fromLng: number,
  toLat: number, toLng: number
): Promise<TravelTimes> {
  const key = cacheKey(fromLat, fromLng, toLat, toLng);
  const cached = cache.get(key);
  if (cached) return cached;

  // Fetch driving, transit, Uber, and Lyft in parallel
  const [driveResult, transitResult, uberEst, lyftEst] = await Promise.all([
    fetchGoogleDirections(fromLat, fromLng, toLat, toLng, "driving"),
    fetchGoogleDirections(fromLat, fromLng, toLat, toLng, "transit"),
    fetchUberEstimate(fromLat, fromLng, toLat, toLng),
    fetchLyftEstimate(fromLat, fromLng, toLat, toLng),
  ]);

  const result: TravelTimes = {
    driveMinutes: driveResult?.minutes ?? estimateDriveMinutes(fromLat, fromLng, toLat, toLng),
    transitMinutes: transitResult?.minutes ?? null,
    transitFare: transitResult?.fareUsd ?? null,
    uberEstimate: uberEst,
    lyftEstimate: lyftEst,
  };

  cache.set(key, result);
  return result;
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
