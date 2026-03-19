import fs from "fs";
import path from "path";
import { searchGTFS, findNearbyStops, type ModeFilter } from "./gtfs";
import {
  fetchFlixTrips,
  gtfsIdToFlixId,
  matchTripPrice,
} from "./flixbus";

// ── Types ──────────────────────────────────────────────────────────────────

export type TransitPreference = "all" | "bus" | "train";

export interface SearchParams {
  originLat: number;
  originLng: number;
  venueName: string;
  venueLat: number;
  venueLng: number;
  gameDate: string; // YYYY-MM-DD
  gameTime: string; // HH:MM (EST)
  limit?: number;
  transitPref?: TransitPreference; // filter GTFS results by mode
}

export interface Leg {
  mode: "flight" | "drive" | "rideshare" | "transit" | "bus" | "train";
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
  cost: number | null; // null = unknown (don't BS prices)
  bookingUrl?: string;
  miles: number;
  enrichable?: boolean; // true if this leg can be enriched with real data
}

export interface Itinerary {
  id: string;
  totalMinutes: number;
  totalCost: number | null; // null if any leg has unknown cost
  departureTime: string; // ISO
  arrivalTime: string; // ISO
  bufferMinutes: number;
  legs: Leg[];
  enriched?: boolean; // false = GTFS estimates only
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
    const raw = fs.readFileSync(
      path.join(process.cwd(), "data", "stadium-airports.json"),
      "utf-8"
    );
    stadiumData = JSON.parse(raw);
  }
  return stadiumData!;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function haversineMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Estimate drive minutes from haversine miles (road_miles ≈ 1.3×, avg 50 mph). */
function estimateDriveMin(miles: number): number {
  return Math.max(5, Math.round((miles * 1.3 * 60) / 50));
}

function estimateFlightCost(miles: number): number {
  return Math.max(60, Math.round(miles * 0.12));
}

/** Minimum layover between consecutive legs to ensure realistic transitions. */
const MIN_LAYOVER = 20; // minutes

function dateStr(d: string): string {
  return d.replace(/-/g, "");
}

/** Build ISO datetime from date (YYYYMMDD) and minutes from midnight (EST).
 *  Handles negative minutes (previous day) and >1440 (next day). */
function toIso(dateYYYYMMDD: string, estMinutes: number): string {
  const y = parseInt(dateYYYYMMDD.substring(0, 4), 10);
  const m = parseInt(dateYYYYMMDD.substring(4, 6), 10) - 1;
  const d = parseInt(dateYYYYMMDD.substring(6, 8), 10);
  const dt = new Date(y, m, d);
  dt.setMinutes(estMinutes); // JS Date handles negative/overflow correctly
  return dt.toISOString();
}

// ── Search ─────────────────────────────────────────────────────────────────

export async function searchRoutes(
  params: SearchParams
): Promise<Itinerary[]> {
  const {
    originLat,
    originLng,
    venueName,
    venueLat,
    venueLng,
    gameDate,
    gameTime,
  } = params;
  const limit = params.limit ?? 10;

  const gameDateYMD = dateStr(gameDate);
  const [gh, gm] = gameTime.split(":").map(Number);
  const gameMinutesEst = gh * 60 + gm;
  const arrivalDeadline = gameMinutesEst;

  // Compute "now" in EST to filter out past departures
  const nowUtc = new Date();
  const nowEstMs = nowUtc.getTime() + -5 * 60 * 60 * 1000;
  const nowEstDate = new Date(nowEstMs);
  const todayYMD = `${nowEstDate.getUTCFullYear()}${String(nowEstDate.getUTCMonth() + 1).padStart(2, "0")}${String(nowEstDate.getUTCDate()).padStart(2, "0")}`;
  const nowEstMinutes =
    nowEstDate.getUTCHours() * 60 + nowEstDate.getUTCMinutes();
  const isGameToday = gameDateYMD === todayYMD;
  const isGameInPast = gameDateYMD < todayYMD;

  if (isGameInPast) return [];
  if (isGameToday && nowEstMinutes >= gameMinutesEst) return [];

  const earliestDepartEst = isGameToday ? nowEstMinutes : 0;

  const stadium = getStadiumData()[venueName];
  const itineraries: Itinerary[] = [];
  let idCounter = 0;

  // ── 1. Drive (haversine estimate, no API calls) ──

  const driveMiles = haversineMiles(originLat, originLng, venueLat, venueLng);
  const roadMiles = Math.round(driveMiles * 1.3);
  const driveMin = estimateDriveMin(driveMiles);
  const driveDepart = arrivalDeadline - driveMin;

  if (driveDepart >= earliestDepartEst) {
    const gmapsLink = `https://www.google.com/maps/dir/?api=1&origin=${originLat},${originLng}&destination=${venueLat},${venueLng}&travelmode=driving`;
    itineraries.push({
      id: `drive-${idCounter++}`,
      totalMinutes: driveMin,
      totalCost: null, // don't BS the price
      departureTime: toIso(gameDateYMD, driveDepart),
      arrivalTime: toIso(gameDateYMD, arrivalDeadline),
      bufferMinutes: 0,
      enriched: false,
      legs: [
        {
          mode: "drive",
          from: "Your location",
          fromLat: originLat,
          fromLng: originLng,
          to: venueName,
          toLat: venueLat,
          toLng: venueLng,
          depart: toIso(gameDateYMD, driveDepart),
          arrive: toIso(gameDateYMD, arrivalDeadline),
          minutes: driveMin,
          cost: null,
          bookingUrl: gmapsLink,
          miles: roadMiles,
          enrichable: true,
        },
      ],
    });
  }

  // ── 2. Bus & Train (GTFS schedules — no API calls) ──

  // Track FlixBus/Greyhound legs for price enrichment:
  // { legRef, fromStopId, toStopId, departMinutes }
  const flixPriceLookups: {
    leg: Leg;
    itin: Itinerary;
    fromStopId: string;
    toStopId: string;
    departMin: number;
  }[] = [];

  const gtfsModeFilter: ModeFilter = params.transitPref ?? "all";
  const gtfsResults = searchGTFS(
    originLat,
    originLng,
    venueLat,
    venueLng,
    gameDate,
    arrivalDeadline, // must arrive at stop by game time
    60, // origin radius miles
    40, // dest radius miles
    gtfsModeFilter
  );

  for (const git of gtfsResults) {
    // Compute first mile: user → boarding stop
    const boardStop = git.legs[0];
    const firstMileMi = haversineMiles(
      originLat,
      originLng,
      boardStop.fromLat,
      boardStop.fromLng
    );
    const firstMileMin =
      firstMileMi < 1 ? 5 : estimateDriveMin(firstMileMi);
    const firstMileRoadMi = Math.round(firstMileMi * 1.3);

    // Compute last mile: alighting stop → venue
    const alightStop = git.legs[git.legs.length - 1];
    const lastMileMi = haversineMiles(
      alightStop.toLat,
      alightStop.toLng,
      venueLat,
      venueLng
    );
    const lastMileMin = lastMileMi < 1 ? 5 : estimateDriveMin(lastMileMi);
    const lastMileRoadMi = Math.round(lastMileMi * 1.3);

    // Work backwards: arrive at venue by deadline
    // Last mile ends at arrivalDeadline
    const lastMileDepart = arrivalDeadline - lastMileMin;

    // Transit must arrive with enough layover before last mile depart
    const lastMileLayover = lastMileMi > 0.5 ? MIN_LAYOVER : 0;
    if (git.arriveMinutes + lastMileLayover > lastMileDepart) continue;

    // First mile must get us to the boarding stop with layover before transit departure
    const firstMileLayover = firstMileMi > 0.5 ? MIN_LAYOVER : 0;
    const firstMileDepart = git.departMinutes - firstMileMin - firstMileLayover;
    // For GTFS: allow previous-day departures (negative minutes = day before game)
    // Only filter if game is today AND departure is in the past
    if (isGameToday && firstMileDepart < earliestDepartEst) continue;
    // Reject departures more than 36 hours before game (unreasonably early)
    if (firstMileDepart < -36 * 60) continue;

    const totalMin = arrivalDeadline - firstMileDepart;

    const legs: Leg[] = [];

    // First mile (drive to boarding stop) — skip if very close
    if (firstMileMi > 0.5) {
      legs.push({
        mode: "drive",
        from: "Your location",
        fromLat: originLat,
        fromLng: originLng,
        to: boardStop.fromStopName,
        toLat: boardStop.fromLat,
        toLng: boardStop.fromLng,
        depart: toIso(gameDateYMD, firstMileDepart),
        arrive: toIso(gameDateYMD, firstMileDepart + firstMileMin),
        minutes: firstMileMin,
        cost: null,
        bookingUrl: `https://www.google.com/maps/dir/?api=1&origin=${originLat},${originLng}&destination=${boardStop.fromLat},${boardStop.fromLng}&travelmode=driving`,
        miles: firstMileRoadMi,
        enrichable: true,
      });
    }

    // Transit legs (bus/train from GTFS)
    // Track which legs are FlixBus/Greyhound for price lookup
    const flixLegsInThisItin: {
      leg: Leg;
      fromStopId: string;
      toStopId: string;
      departMin: number;
    }[] = [];

    for (let i = 0; i < git.legs.length; i++) {
      const gl = git.legs[i];

      // If there's a layover gap before this leg (not the first transit leg), add it implicitly
      // The frontend will detect gaps between legs

      const bookingUrl =
        gl.carrier === "Amtrak"
          ? `https://www.amtrak.com/tickets/departure.html`
          : `https://www.flixbus.com/`;

      const leg: Leg = {
        mode: gl.mode,
        carrier: gl.carrier,
        routeName: gl.routeName,
        from: gl.fromStopName,
        fromLat: gl.fromLat,
        fromLng: gl.fromLng,
        to: gl.toStopName,
        toLat: gl.toLat,
        toLng: gl.toLng,
        depart: toIso(gameDateYMD, gl.departMinutes),
        arrive: toIso(gameDateYMD, gl.arriveMinutes),
        minutes: gl.durationMinutes,
        cost: null, // will be filled by FlixBus API if available
        bookingUrl,
        miles: gl.miles,
      };
      legs.push(leg);

      // Track FlixBus/Greyhound legs for price enrichment
      if (
        (gl.carrier === "FlixBus" || gl.carrier === "Greyhound") &&
        gtfsIdToFlixId(gl.fromStopId) &&
        gtfsIdToFlixId(gl.toStopId)
      ) {
        flixLegsInThisItin.push({
          leg,
          fromStopId: gl.fromStopId,
          toStopId: gl.toStopId,
          departMin: gl.departMinutes,
        });
      }
    }

    // Last mile (drive from alighting stop to venue) — skip if very close
    if (lastMileMi > 0.5) {
      legs.push({
        mode: "drive",
        from: alightStop.toStopName,
        fromLat: alightStop.toLat,
        fromLng: alightStop.toLng,
        to: venueName,
        toLat: venueLat,
        toLng: venueLng,
        depart: toIso(gameDateYMD, lastMileDepart),
        arrive: toIso(gameDateYMD, arrivalDeadline),
        minutes: lastMileMin,
        cost: null,
        bookingUrl: `https://www.google.com/maps/dir/?api=1&origin=${alightStop.toLat},${alightStop.toLng}&destination=${venueLat},${venueLng}&travelmode=driving`,
        miles: lastMileRoadMi,
        enrichable: true,
      });
    }

    const itin: Itinerary = {
      id: `transit-${idCounter++}`,
      totalMinutes: totalMin,
      totalCost: null, // will be updated if FlixBus prices are found
      departureTime: legs[0].depart,
      arrivalTime: legs[legs.length - 1].arrive,
      bufferMinutes: 0,
      enriched: false,
      legs,
    };
    itineraries.push(itin);

    // Register FlixBus legs for batch price lookup
    for (const fl of flixLegsInThisItin) {
      flixPriceLookups.push({ ...fl, itin });
    }
  }

  // ── 3. Flight itineraries ──

  if (stadium) {
    const destAirports = stadium.airports ?? [];

    // Find origin airports within 100mi from all known stadiums
    const originAirports: {
      code: string;
      name: string;
      lat: number;
      lng: number;
    }[] = [];
    const seenCodes = new Set<string>();
    for (const s of Object.values(getStadiumData())) {
      for (const a of s.airports) {
        if (
          !seenCodes.has(a.code) &&
          haversineMiles(originLat, originLng, a.lat, a.lng) <= 100
        ) {
          originAirports.push(a);
          seenCodes.add(a.code);
        }
      }
    }

    for (const origApt of originAirports) {
      for (const destApt of destAirports) {
        if (origApt.code === destApt.code) continue;

        const flightMiles = haversineMiles(
          origApt.lat,
          origApt.lng,
          destApt.lat,
          destApt.lng
        );
        if (flightMiles < 100) continue;

        const flightMin = Math.round((flightMiles / 500) * 60 + 90);
        const flightCost = estimateFlightCost(flightMiles);

        // First mile: user → origin airport
        const toAirportMiles = haversineMiles(
          originLat,
          originLng,
          origApt.lat,
          origApt.lng
        );
        const toAirportMin = estimateDriveMin(toAirportMiles);

        // Last mile: dest airport → venue
        const fromAirportMiles = haversineMiles(
          destApt.lat,
          destApt.lng,
          venueLat,
          venueLng
        );
        const fromAirportMin = estimateDriveMin(fromAirportMiles);

        // Work backwards from game time
        const postFlightLayover = fromAirportMin > 5 ? MIN_LAYOVER : 0;
        const lastMileFromAirport = arrivalDeadline - fromAirportMin;
        const flightArriveEst = lastMileFromAirport - postFlightLayover;
        const flightDepartEst = flightArriveEst - flightMin;
        const leaveHomeEst = flightDepartEst - toAirportMin - 90; // 90min pre-flight buffer

        if (leaveHomeEst < 0 || leaveHomeEst < earliestDepartEst) continue;

        const totalMinutes = arrivalDeadline - leaveHomeEst;
        const legs: Leg[] = [];

        // First mile (rideshare to airport)
        if (toAirportMin > 5) {
          legs.push({
            mode: "rideshare",
            from: "Your location",
            fromLat: originLat,
            fromLng: originLng,
            to: origApt.name,
            toLat: origApt.lat,
            toLng: origApt.lng,
            depart: toIso(gameDateYMD, leaveHomeEst),
            arrive: toIso(gameDateYMD, leaveHomeEst + toAirportMin),
            minutes: toAirportMin,
            cost: null, // don't BS rideshare prices
            miles: Math.round(toAirportMiles * 1.3),
            enrichable: true,
          });
        }

        // Flight
        const googleFlightsUrl = `https://www.google.com/travel/flights?q=Flights+to+${destApt.code}+from+${origApt.code}+on+${gameDate}`;
        legs.push({
          mode: "flight",
          carrier: "Various Airlines",
          routeName: `${origApt.code} → ${destApt.code}`,
          from: origApt.name,
          fromLat: origApt.lat,
          fromLng: origApt.lng,
          to: destApt.name,
          toLat: destApt.lat,
          toLng: destApt.lng,
          depart: toIso(gameDateYMD, flightDepartEst),
          arrive: toIso(gameDateYMD, flightArriveEst),
          minutes: flightMin,
          cost: flightCost,
          bookingUrl: googleFlightsUrl,
          miles: Math.round(flightMiles),
        });

        // Last mile (rideshare from airport)
        if (fromAirportMin > 5) {
          legs.push({
            mode: "rideshare",
            from: destApt.name,
            fromLat: destApt.lat,
            fromLng: destApt.lng,
            to: venueName,
            toLat: venueLat,
            toLng: venueLng,
            depart: toIso(gameDateYMD, lastMileFromAirport),
            arrive: toIso(gameDateYMD, arrivalDeadline),
            minutes: fromAirportMin,
            cost: null,
            miles: Math.round(fromAirportMiles * 1.3),
            enrichable: true,
          });
        }

        const totalCost = legs.every((l) => l.cost != null)
          ? legs.reduce((s, l) => s + (l.cost ?? 0), 0)
          : null;

        itineraries.push({
          id: `flight-${idCounter++}`,
          totalMinutes,
          totalCost,
          departureTime: legs[0].depart,
          arrivalTime: legs[legs.length - 1].arrive,
          bufferMinutes: gameMinutesEst - arrivalDeadline,
          enriched: false,
          legs,
        });
      }
    }
  }

  // ── 4. Enrich FlixBus/Greyhound legs with real prices ──

  if (flixPriceLookups.length > 0) {
    // Deduplicate route lookups: group by (from→to) to avoid duplicate API calls
    const routeKey = (from: string, to: string) => `${from}|${to}`;
    const uniqueRoutes = new Map<
      string,
      { fromId: string; toId: string }
    >();

    for (const fl of flixPriceLookups) {
      const fromId = gtfsIdToFlixId(fl.fromStopId)!;
      const toId = gtfsIdToFlixId(fl.toStopId)!;
      const key = routeKey(fromId, toId);
      if (!uniqueRoutes.has(key)) {
        uniqueRoutes.set(key, { fromId, toId });
      }
    }

    // Fetch prices in parallel (max 6 concurrent to respect rate limits)
    const routeEntries = Array.from(uniqueRoutes.entries());
    const tripCache = new Map<string, Awaited<ReturnType<typeof fetchFlixTrips>>>();

    const BATCH_SIZE = 6;
    for (let i = 0; i < routeEntries.length; i += BATCH_SIZE) {
      const batch = routeEntries.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async ([key, { fromId, toId }]) => {
          const trips = await fetchFlixTrips(fromId, toId, gameDate);
          return [key, trips] as const;
        })
      );
      for (const [key, trips] of results) {
        tripCache.set(key, trips);
      }
    }

    // Apply prices + build FlixBus booking URLs
    const [gy, gm, gd] = gameDate.split("-");
    const flixRideDate = `${gd}.${gm}.${gy}`;
    for (const fl of flixPriceLookups) {
      const fromId = gtfsIdToFlixId(fl.fromStopId)!;
      const toId = gtfsIdToFlixId(fl.toStopId)!;
      const key = routeKey(fromId, toId);
      const trips = tripCache.get(key);
      if (!trips || trips.length === 0) continue;

      // Build booking URL with city UUIDs from any trip on this route
      const depCityId = trips[0].departureCityId;
      const arrCityId = trips[0].arrivalCityId;
      if (depCityId && arrCityId) {
        const route = encodeURIComponent(`${fl.leg.from}-${fl.leg.to}`);
        fl.leg.bookingUrl = `https://shop.flixbus.com/search?departureCity=${depCityId}&arrivalCity=${arrCityId}&route=${route}&rideDate=${flixRideDate}&adult=1&_locale=en_US&departureCountryCode=US&arrivalCountryCode=US&features%5Bfeature.enable_distribusion%5D=1&features%5Bfeature.train_cities_only%5D=0&features%5Bfeature.station_search%5D=0&features%5Bfeature.station_search_recommendation%5D=0&features%5Bfeature.darken_page%5D=1`;
      }

      const price = matchTripPrice(trips, fl.departMin);
      if (price) {
        fl.leg.cost = price.price;
      }
    }

    // Recompute totalCost for itineraries that had FlixBus legs enriched
    const affectedItins = Array.from(new Set(flixPriceLookups.map((fl) => fl.itin)));
    for (const itin of affectedItins) {
      if (itin.legs.every((l) => l.cost != null)) {
        itin.totalCost = itin.legs.reduce((s, l) => s + (l.cost ?? 0), 0);
      }
    }
  }

  // Always include drive, then distribute remaining limit between transit and flights
  const drive = itineraries.filter((i) => i.id.startsWith("drive-"));
  const transit = itineraries
    .filter((i) => i.id.startsWith("transit-"))
    .sort((a, b) => a.totalMinutes - b.totalMinutes);
  const flights = itineraries
    .filter((i) => i.id.startsWith("flight-"))
    .sort((a, b) => a.totalMinutes - b.totalMinutes);

  const remaining = limit - drive.length;
  const transitSlots = Math.min(transit.length, Math.max(5, Math.ceil(remaining * 0.6)));
  const flightSlots = Math.min(flights.length, remaining - transitSlots);

  return [
    ...drive,
    ...transit.slice(0, transitSlots),
    ...flights.slice(0, flightSlots),
  ];
}
