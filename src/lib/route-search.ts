import fs from "fs";
import path from "path";
import { getTravelTimes } from "./driving";

// ── Types ──────────────────────────────────────────────────────────────────

export interface SearchParams {
  originLat: number;
  originLng: number;
  venueName: string;
  venueLat: number;
  venueLng: number;
  gameDate: string; // YYYY-MM-DD
  gameTime: string; // HH:MM (EST)
  limit?: number;
}

export interface Leg {
  mode: "flight" | "drive" | "rideshare" | "transit";
  carrier?: string;
  routeName?: string;
  from: string;
  fromLat: number;
  fromLng: number;
  to: string;
  toLat: number;
  toLng: number;
  depart: string; // ISO
  arrive: string; // ISO
  minutes: number;
  cost: number;
  bookingUrl?: string;
  miles: number;
}

export interface Itinerary {
  id: string;
  totalMinutes: number;
  totalCost: number;
  departureTime: string; // ISO
  arrivalTime: string; // ISO
  bufferMinutes: number;
  legs: Leg[];
}

// ── Stadium data ───────────────────────────────────────────────────────────

interface StadiumEntry {
  city: string;
  state: string;
  lat: number;
  lng: number;
  airports: { code: string; name: string; lat: number; lng: number }[];
  trainStations: { code: string; name: string; lat: number; lng: number }[];
  busStations: { code: string; name: string; lat: number; lng: number }[];
}

let stadiumData: Record<string, StadiumEntry> | null = null;
function getStadiumData(): Record<string, StadiumEntry> {
  if (!stadiumData) {
    const raw = fs.readFileSync(path.join(process.cwd(), "data", "stadium-airports.json"), "utf-8");
    stadiumData = JSON.parse(raw);
  }
  return stadiumData!;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 3958.8; // Earth radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function estimateDriveMinutes(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const miles = haversineMiles(lat1, lng1, lat2, lng2);
  return Math.round((miles * 1.4) / 50 * 60);
}

function estimateFlightCost(miles: number): number {
  return Math.max(60, Math.round(miles * 0.12));
}

function estimateDriveCost(miles: number): number {
  return Math.max(8, Math.round(miles * 0.30));
}

function estimateRideFare(miles: number, minutes: number): number {
  return Math.max(10, Math.round(2.50 + 3.50 + 1.20 * miles + 0.35 * minutes));
}

function estimateTransitCost(miles: number): number {
  if (miles <= 15) return 3;
  if (miles <= 40) return Math.round(3 + (miles - 15) * 0.08);
  return Math.round(5 + (miles - 40) * 0.05);
}

function dateStr(d: string): string {
  return d.replace(/-/g, "");
}

/** Build ISO datetime from date (YYYYMMDD) and minutes from midnight (EST) */
function toIso(dateYYYYMMDD: string, estMinutes: number): string {
  const y = parseInt(dateYYYYMMDD.substring(0, 4), 10);
  const m = parseInt(dateYYYYMMDD.substring(4, 6), 10) - 1;
  const d = parseInt(dateYYYYMMDD.substring(6, 8), 10);
  const dt = new Date(y, m, d);
  dt.setMinutes(estMinutes);
  return dt.toISOString();
}

// ── Search ─────────────────────────────────────────────────────────────────

export async function searchRoutes(params: SearchParams): Promise<Itinerary[]> {
  const { originLat, originLng, venueName, venueLat, venueLng, gameDate, gameTime } = params;
  const limit = params.limit ?? 5;

  const gameDateYMD = dateStr(gameDate);
  const [gh, gm] = gameTime.split(":").map(Number);
  const gameMinutesEst = gh * 60 + gm;
  const arrivalDeadline = gameMinutesEst;

  // Compute "now" in EST to filter out past departures
  const nowUtc = new Date();
  const nowEstMs = nowUtc.getTime() + (-5 * 60 * 60 * 1000);
  const nowEstDate = new Date(nowEstMs);
  const todayYMD = `${nowEstDate.getUTCFullYear()}${String(nowEstDate.getUTCMonth() + 1).padStart(2, "0")}${String(nowEstDate.getUTCDate()).padStart(2, "0")}`;
  const nowEstMinutes = nowEstDate.getUTCHours() * 60 + nowEstDate.getUTCMinutes();
  const isGameToday = gameDateYMD === todayYMD;
  const isGameInPast = gameDateYMD < todayYMD;

  if (isGameInPast) return [];
  if (isGameToday && nowEstMinutes >= gameMinutesEst) return [];

  const earliestDepartEst = isGameToday ? nowEstMinutes : 0;

  const stadium = getStadiumData()[venueName];
  const itineraries: Itinerary[] = [];
  let idCounter = 0;

  // ── 1. Drive + Transit (real Google Maps data) ──

  const driveMiles = haversineMiles(originLat, originLng, venueLat, venueLng);
  const roadMiles = driveMiles * 1.4;
  const realTimes = await getTravelTimes(originLat, originLng, venueLat, venueLng);

  // Drive
  const driveMin = realTimes.driveMinutes;
  const driveCost = estimateDriveCost(roadMiles);
  const driveDepart = arrivalDeadline - driveMin;

  if (driveDepart >= earliestDepartEst) {
    const gmapsLink = `https://www.google.com/maps/dir/?api=1&origin=${originLat},${originLng}&destination=${venueLat},${venueLng}&travelmode=driving`;
    itineraries.push({
      id: `drive-${idCounter++}`,
      totalMinutes: driveMin,
      totalCost: driveCost,
      departureTime: toIso(gameDateYMD, driveDepart),
      arrivalTime: toIso(gameDateYMD, arrivalDeadline),
      bufferMinutes: 0,
      legs: [{
        mode: "drive",
        from: "Your location", fromLat: originLat, fromLng: originLng,
        to: venueName, toLat: venueLat, toLng: venueLng,
        depart: toIso(gameDateYMD, driveDepart),
        arrive: toIso(gameDateYMD, arrivalDeadline),
        minutes: driveMin, cost: driveCost,
        bookingUrl: gmapsLink,
        miles: Math.round(roadMiles),
      }],
    });
  }

  // Transit
  if (realTimes.transitMinutes != null) {
    const transitMin = realTimes.transitMinutes;
    const transitCost = realTimes.transitFare
      ? parseInt(realTimes.transitFare.replace(/[^0-9]/g, ""), 10) || 3
      : estimateTransitCost(roadMiles);
    const transitDepart = arrivalDeadline - transitMin;

    if (transitDepart >= earliestDepartEst && transitDepart >= 0) {
      const gmapsTransit = `https://www.google.com/maps/dir/?api=1&origin=${originLat},${originLng}&destination=${venueLat},${venueLng}&travelmode=transit`;
      itineraries.push({
        id: `transit-${idCounter++}`,
        totalMinutes: transitMin,
        totalCost: transitCost,
        departureTime: toIso(gameDateYMD, transitDepart),
        arrivalTime: toIso(gameDateYMD, arrivalDeadline),
        bufferMinutes: 0,
        legs: [{
          mode: "transit",
          carrier: "Public Transit",
          from: "Your location", fromLat: originLat, fromLng: originLng,
          to: venueName, toLat: venueLat, toLng: venueLng,
          depart: toIso(gameDateYMD, transitDepart),
          arrive: toIso(gameDateYMD, arrivalDeadline),
          minutes: transitMin, cost: transitCost,
          bookingUrl: gmapsTransit,
          miles: Math.round(roadMiles),
        }],
      });
    }
  }

  // ── 2. Flight itineraries ──

  if (stadium) {
    const destAirports = stadium.airports ?? [];

    // Find origin airports within 100mi from all known stadiums
    const originAirports: { code: string; name: string; lat: number; lng: number }[] = [];
    const seenCodes = new Set<string>();
    for (const s of Object.values(getStadiumData())) {
      for (const a of s.airports) {
        if (!seenCodes.has(a.code) && haversineMiles(originLat, originLng, a.lat, a.lng) <= 100) {
          originAirports.push(a);
          seenCodes.add(a.code);
        }
      }
    }

    for (const origApt of originAirports) {
      for (const destApt of destAirports) {
        if (origApt.code === destApt.code) continue;

        const flightMiles = haversineMiles(origApt.lat, origApt.lng, destApt.lat, destApt.lng);
        if (flightMiles < 100) continue;

        const flightMin = Math.round(flightMiles / 500 * 60 + 90); // cruise speed + airport overhead
        const flightCost = estimateFlightCost(flightMiles);

        // First mile: user → origin airport
        const toAirportMiles = haversineMiles(originLat, originLng, origApt.lat, origApt.lng);
        const toAirportMin = estimateDriveMinutes(originLat, originLng, origApt.lat, origApt.lng);
        const toAirportCost = estimateRideFare(toAirportMiles * 1.4, toAirportMin);

        // Last mile: dest airport → venue
        const fromAirportMiles = haversineMiles(destApt.lat, destApt.lng, venueLat, venueLng);
        const fromAirportMin = estimateDriveMinutes(destApt.lat, destApt.lng, venueLat, venueLng);
        const fromAirportCost = estimateRideFare(fromAirportMiles * 1.4, fromAirportMin);

        // Work backwards from game time
        const airportArriveEst = arrivalDeadline - fromAirportMin;
        const flightDepartEst = airportArriveEst - flightMin;
        const leaveHomeEst = flightDepartEst - toAirportMin - 90; // 90min pre-flight buffer

        if (leaveHomeEst < 0 || leaveHomeEst < earliestDepartEst) continue;

        const totalMinutes = arrivalDeadline - leaveHomeEst;
        const legs: Leg[] = [];

        // First mile (rideshare to airport)
        if (toAirportMin > 5) {
          legs.push({
            mode: "rideshare",
            from: "Your location", fromLat: originLat, fromLng: originLng,
            to: origApt.name, toLat: origApt.lat, toLng: origApt.lng,
            depart: toIso(gameDateYMD, leaveHomeEst),
            arrive: toIso(gameDateYMD, leaveHomeEst + toAirportMin),
            minutes: toAirportMin, cost: toAirportCost,
            miles: Math.round(toAirportMiles * 1.4),
          });
        }

        // Flight
        const googleFlightsUrl = `https://www.google.com/travel/flights?q=Flights+to+${destApt.code}+from+${origApt.code}+on+${gameDate}`;
        legs.push({
          mode: "flight",
          carrier: "Various Airlines",
          routeName: `${origApt.code} → ${destApt.code}`,
          from: origApt.name, fromLat: origApt.lat, fromLng: origApt.lng,
          to: destApt.name, toLat: destApt.lat, toLng: destApt.lng,
          depart: toIso(gameDateYMD, flightDepartEst),
          arrive: toIso(gameDateYMD, airportArriveEst),
          minutes: flightMin, cost: flightCost,
          bookingUrl: googleFlightsUrl,
          miles: Math.round(flightMiles),
        });

        // Last mile (rideshare from airport)
        if (fromAirportMin > 5) {
          legs.push({
            mode: "rideshare",
            from: destApt.name, fromLat: destApt.lat, fromLng: destApt.lng,
            to: venueName, toLat: venueLat, toLng: venueLng,
            depart: toIso(gameDateYMD, airportArriveEst),
            arrive: toIso(gameDateYMD, arrivalDeadline),
            minutes: fromAirportMin, cost: fromAirportCost,
            miles: Math.round(fromAirportMiles * 1.4),
          });
        }

        itineraries.push({
          id: `flight-${idCounter++}`,
          totalMinutes,
          totalCost: legs.reduce((s, l) => s + l.cost, 0),
          departureTime: legs[0].depart,
          arrivalTime: legs[legs.length - 1].arrive,
          bufferMinutes: gameMinutesEst - arrivalDeadline,
          legs,
        });
      }
    }
  }

  // Sort flights by total time, keep drive/transit first
  const driveTransit = itineraries.filter((i) => i.id.startsWith("drive-") || i.id.startsWith("transit-"));
  const flights = itineraries.filter((i) => i.id.startsWith("flight-")).sort((a, b) => a.totalMinutes - b.totalMinutes);

  return [...driveTransit, ...flights].slice(0, limit);
}
