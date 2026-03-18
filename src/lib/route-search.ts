import fs from "fs";
import path from "path";
import {
  type GtfsIndex,
  type GtfsStop,
  ensureGtfsLoaded,
  findStopsNear,
  haversineMiles,
  isServiceActive,
  parseGtfsTime,
  gtfsTimeToEst,
} from "./gtfs";

// ── Types ──────────────────────────────────────────────────────────────────

export interface SearchParams {
  originLat: number;
  originLng: number;
  venueName: string;
  venueLat: number;
  venueLng: number;
  gameDate: string; // YYYY-MM-DD
  gameTime: string; // HH:MM (EST)
  preference: Preference;
  maxTransfers: number; // 0, 1, or 2
}

export type Preference = "balanced" | "cheapest" | "fastest" | "prefer_bus" | "prefer_train" | "prefer_plane";

export interface Leg {
  mode: "bus" | "train" | "flight" | "drive" | "rideshare" | "walk";
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

// ── Price estimation ───────────────────────────────────────────────────────

function estimateBusFare(miles: number, agencyId: string): number {
  if (agencyId.startsWith("GREYHOUND")) return Math.max(15, Math.round(miles * 0.10));
  return Math.max(10, Math.round(miles * 0.08)); // FlixBus
}

function estimateTrainFare(miles: number): number {
  return Math.max(20, Math.round(miles * 0.20));
}

function estimateFlightCost(miles: number): number {
  return Math.max(60, Math.round(miles * 0.12));
}

function estimateDriveCost(miles: number): number {
  // Gas (~$0.15/mi) + wear/maintenance (~$0.10/mi) + tolls estimate (~$0.05/mi)
  return Math.max(8, Math.round(miles * 0.30));
}

function estimateRideFare(miles: number, minutes: number): number {
  // Base fare + booking/service fee + per-mile + per-minute
  return Math.max(10, Math.round(2.50 + 3.50 + 1.20 * miles + 0.35 * minutes));
}

function estimateDriveMinutes(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const miles = haversineMiles(lat1, lng1, lat2, lng2);
  return Math.round((miles * 1.4) / 50 * 60); // road factor 1.4, avg 50mph
}

// ── Time helpers ───────────────────────────────────────────────────────────

function dateStr(d: string): string {
  // YYYY-MM-DD → YYYYMMDD
  return d.replace(/-/g, "");
}

function prevDateStr(yyyymmdd: string): string {
  const y = parseInt(yyyymmdd.substring(0, 4), 10);
  const m = parseInt(yyyymmdd.substring(4, 6), 10) - 1;
  const d = parseInt(yyyymmdd.substring(6, 8), 10);
  const dt = new Date(y, m, d - 1);
  return `${dt.getFullYear()}${String(dt.getMonth() + 1).padStart(2, "0")}${String(dt.getDate()).padStart(2, "0")}`;
}

/** Format minutes from midnight as "HH:MM" */
function minutesToTime(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Build ISO datetime from date (YYYY-MM-DD) and minutes from midnight (EST) */
function toIso(dateYYYYMMDD: string, estMinutes: number): string {
  const y = parseInt(dateYYYYMMDD.substring(0, 4), 10);
  const m = parseInt(dateYYYYMMDD.substring(4, 6), 10) - 1;
  const d = parseInt(dateYYYYMMDD.substring(6, 8), 10);
  const dt = new Date(y, m, d);
  dt.setMinutes(estMinutes);
  return dt.toISOString();
}

function carrierName(agencyId: string): string {
  if (agencyId.startsWith("GREYHOUND")) return "Greyhound";
  if (agencyId.startsWith("FLIXBUS")) return "FlixBus";
  return agencyId;
}

function bookingUrl(agencyId: string): string {
  if (agencyId.startsWith("GREYHOUND")) return "https://shop.greyhound.com";
  if (agencyId.startsWith("FLIXBUS")) return "https://shop.flixbus.com";
  return "";
}

// ── Search ─────────────────────────────────────────────────────────────────

export async function searchRoutes(params: SearchParams): Promise<Itinerary[]> {
  const { originLat, originLng, venueName, venueLat, venueLng, gameDate, gameTime, maxTransfers } = params;

  const gtfs = await ensureGtfsLoaded();
  const gameDateYMD = dateStr(gameDate);
  const prevDay = prevDateStr(gameDateYMD);
  const [gh, gm] = gameTime.split(":").map(Number);
  const gameMinutesEst = gh * 60 + gm;
  const arrivalDeadline = gameMinutesEst; // must arrive before game starts

  // ── Compute "now" in EST to filter out past departures ──
  const nowUtc = new Date();
  // EST = UTC-5 (not handling DST — close enough for filtering)
  const nowEstMs = nowUtc.getTime() + (-5 * 60 * 60 * 1000);
  const nowEstDate = new Date(nowEstMs);
  const todayYMD = `${nowEstDate.getUTCFullYear()}${String(nowEstDate.getUTCMonth() + 1).padStart(2, "0")}${String(nowEstDate.getUTCDate()).padStart(2, "0")}`;
  const nowEstMinutes = nowEstDate.getUTCHours() * 60 + nowEstDate.getUTCMinutes();
  const isGameToday = gameDateYMD === todayYMD;
  const isGameInPast = gameDateYMD < todayYMD;

  // If the game date is in the past, no bookable trips exist
  if (isGameInPast) return [];

  // If game is today and already started, no point searching
  if (isGameToday && nowEstMinutes >= gameMinutesEst) return [];

  // Earliest allowed departure: if game is today, must be >= now; otherwise no constraint
  const earliestDepartEst = isGameToday ? nowEstMinutes : 0;

  const stadium = getStadiumData()[venueName];
  const itineraries: Itinerary[] = [];
  let idCounter = 0;

  // ── Phase A: Identify destination stops from stadium data ──

  interface DestStop { stop: GtfsStop; index: GtfsIndex; distToVenueMiles: number; name: string; code: string }
  const destStops: DestStop[] = [];

  if (stadium) {
    // Bus stations
    for (const bs of stadium.busStations ?? []) {
      const gtfsStop = gtfs.bus.stopsByCode.get(bs.code);
      if (gtfsStop) {
        destStops.push({
          stop: gtfsStop,
          index: gtfs.bus,
          distToVenueMiles: haversineMiles(gtfsStop.stop_lat, gtfsStop.stop_lon, venueLat, venueLng),
          name: bs.name,
          code: bs.code,
        });
      }
    }

    // Train stations (amtrak)
    if (gtfs.amtrak) {
      for (const ts of stadium.trainStations ?? []) {
        const gtfsStop = gtfs.amtrak.stopsByCode.get(ts.code);
        if (gtfsStop) {
          destStops.push({
            stop: gtfsStop,
            index: gtfs.amtrak,
            distToVenueMiles: haversineMiles(gtfsStop.stop_lat, gtfsStop.stop_lon, venueLat, venueLng),
            name: ts.name,
            code: ts.code,
          });
        }
      }
    }
  }

  // ── Phase A: Origin stops nearby ──

  interface OriginStop { stop: GtfsStop; index: GtfsIndex; driveMinFromOrigin: number; distFromOriginMiles: number }
  const originStops: OriginStop[] = [];

  const nearBus = findStopsNear(originLat, originLng, 75, gtfs.bus);
  for (const s of nearBus) {
    const dist = haversineMiles(originLat, originLng, s.stop_lat, s.stop_lon);
    originStops.push({ stop: s, index: gtfs.bus, driveMinFromOrigin: estimateDriveMinutes(originLat, originLng, s.stop_lat, s.stop_lon), distFromOriginMiles: dist });
  }

  if (gtfs.amtrak) {
    const nearTrain = findStopsNear(originLat, originLng, 75, gtfs.amtrak);
    for (const s of nearTrain) {
      const dist = haversineMiles(originLat, originLng, s.stop_lat, s.stop_lon);
      originStops.push({ stop: s, index: gtfs.amtrak, driveMinFromOrigin: estimateDriveMinutes(originLat, originLng, s.stop_lat, s.stop_lon), distFromOriginMiles: dist });
    }
  }

  // ── Phase B: Direct GTFS trips (0 transfers) ──

  for (const orig of originStops) {
    const tripsFromOrigin = orig.index.stopTrips.get(orig.stop.stop_id);
    if (!tripsFromOrigin) continue;

    for (const origEntry of tripsFromOrigin) {
      const trip = orig.index.trips.get(origEntry.trip_id);
      if (!trip) continue;

      // Check service active on game date or prev day (for overnight trips)
      const activeToday = isServiceActive(trip.service_id, gameDateYMD, orig.index);
      const activePrev = isServiceActive(trip.service_id, prevDay, orig.index);
      if (!activeToday && !activePrev) continue;

      const tripStopList = orig.index.tripStops.get(origEntry.trip_id);
      if (!tripStopList) continue;

      // Check if any dest stop is on this trip after origin
      for (const dest of destStops) {
        if (dest.index !== orig.index) continue; // must be same network

        const destEntry = tripStopList.find(
          (ts) => ts.stop_id === dest.stop.stop_id && ts.stop_sequence > origEntry.stop_sequence
        );
        if (!destEntry) continue;

        const departMin = parseGtfsTime(origEntry.departure);
        const arriveMin = parseGtfsTime(destEntry.arrival_time);

        // Check which day this service runs
        const isOvernight = arriveMin >= 1440;
        const useDate = activeToday ? gameDateYMD : (activePrev && isOvernight ? prevDay : null);
        if (!useDate) continue;

        // Convert arrival to EST
        const destTz = dest.stop.stop_timezone || "America/New_York";
        const arriveEst = gtfsTimeToEst(arriveMin % 1440, destTz) + (isOvernight && useDate === gameDateYMD ? 0 : 0);

        // Last mile time
        const lastMileMin = estimateDriveMinutes(dest.stop.stop_lat, dest.stop.stop_lon, venueLat, venueLng);
        const totalArrivalEst = arriveEst + lastMileMin;

        if (totalArrivalEst > arrivalDeadline) continue; // too late

        // First mile
        const firstMileMin = orig.driveMinFromOrigin;
        const departEst = gtfsTimeToEst(departMin % 1440, orig.stop.stop_timezone || "America/New_York");
        const leaveHomeEst = departEst - firstMileMin;

        // Skip if departure is in the past
        if (leaveHomeEst < earliestDepartEst) continue;

        // Trip details
        const tripMiles = haversineMiles(orig.stop.stop_lat, orig.stop.stop_lon, dest.stop.stop_lat, dest.stop.stop_lon);
        const route = orig.index.routes.get(trip.route_id);
        const agencyId = route?.agency_id ?? "";
        const mode: "bus" | "train" = orig.index.provider === "amtrak" ? "train" : "bus";
        const cost = mode === "train" ? estimateTrainFare(tripMiles) : estimateBusFare(tripMiles, agencyId);
        const firstMileMiles = orig.distFromOriginMiles;
        const lastMileMiles = dest.distToVenueMiles;
        const firstMileCost = estimateRideFare(firstMileMiles * 1.4, firstMileMin);
        const lastMileCost = estimateRideFare(lastMileMiles * 1.4, lastMileMin);

        const totalMinutes = totalArrivalEst - leaveHomeEst;
        if (totalMinutes <= 0 || totalMinutes > 2880) continue; // sanity

        const legs: Leg[] = [];

        // First mile (rideshare to station)
        if (firstMileMin > 5) {
          legs.push({
            mode: "rideshare",
            from: "Your location",
            fromLat: originLat, fromLng: originLng,
            to: orig.stop.stop_name,
            toLat: orig.stop.stop_lat, toLng: orig.stop.stop_lon,
            depart: toIso(useDate, leaveHomeEst),
            arrive: toIso(useDate, departEst),
            minutes: firstMileMin,
            cost: firstMileCost,
            miles: Math.round(firstMileMiles * 1.4),
          });
        }

        // Main GTFS leg
        legs.push({
          mode,
          carrier: carrierName(agencyId),
          routeName: route?.route_short_name || route?.route_long_name || "",
          from: orig.stop.stop_name,
          fromLat: orig.stop.stop_lat, fromLng: orig.stop.stop_lon,
          to: dest.stop.stop_name,
          toLat: dest.stop.stop_lat, toLng: dest.stop.stop_lon,
          depart: toIso(useDate, departEst),
          arrive: toIso(useDate, arriveEst),
          minutes: arriveMin - departMin,
          cost,
          bookingUrl: bookingUrl(agencyId) || (mode === "train" ? "https://www.amtrak.com" : undefined),
          miles: Math.round(tripMiles),
        });

        // Last mile (rideshare to venue)
        if (lastMileMin > 5) {
          legs.push({
            mode: "rideshare",
            from: dest.stop.stop_name,
            fromLat: dest.stop.stop_lat, fromLng: dest.stop.stop_lon,
            to: venueName,
            toLat: venueLat, toLng: venueLng,
            depart: toIso(useDate, arriveEst),
            arrive: toIso(useDate, totalArrivalEst),
            minutes: lastMileMin,
            cost: lastMileCost,
            miles: Math.round(lastMileMiles * 1.4),
          });
        }

        itineraries.push({
          id: `gtfs-${idCounter++}`,
          totalMinutes,
          totalCost: legs.reduce((s, l) => s + l.cost, 0),
          departureTime: legs[0].depart,
          arrivalTime: legs[legs.length - 1].arrive,
          bufferMinutes: gameMinutesEst - totalArrivalEst,
          legs,
        });
      }
    }
  }

  // ── Phase C: 1-transfer trips ──

  if (maxTransfers >= 1 && originStops.length > 0 && destStops.length > 0) {
    // Bounding box for intermediate stops
    const minLat = Math.min(originLat, venueLat) - 2;
    const maxLat = Math.max(originLat, venueLat) + 2;
    const minLng = Math.min(originLng, venueLng) - 2;
    const maxLng = Math.max(originLng, venueLng) + 2;

    for (const orig of originStops.slice(0, 20)) { // limit origin stops
      const tripsFromOrigin = orig.index.stopTrips.get(orig.stop.stop_id);
      if (!tripsFromOrigin) continue;

      for (const origEntry of tripsFromOrigin.slice(0, 50)) { // limit trips
        const trip1 = orig.index.trips.get(origEntry.trip_id);
        if (!trip1) continue;
        if (!isServiceActive(trip1.service_id, gameDateYMD, orig.index)) continue;

        const trip1Stops = orig.index.tripStops.get(origEntry.trip_id);
        if (!trip1Stops) continue;

        // Get intermediate stops after origin
        const intermediates = trip1Stops.filter(
          (ts) => ts.stop_sequence > origEntry.stop_sequence
        );

        for (const mid of intermediates.slice(0, 15)) { // limit intermediates
          const midStop = orig.index.stops.get(mid.stop_id);
          if (!midStop) continue;

          // Bounding box filter
          if (midStop.stop_lat < minLat || midStop.stop_lat > maxLat || midStop.stop_lon < minLng || midStop.stop_lon > maxLng) continue;

          const midArriveMin = parseGtfsTime(mid.arrival_time);
          const minDepartMin = midArriveMin + 30; // 30min transfer time

          // Look for connecting trips from midStop to any dest
          for (const destInfo of destStops) {
            const connectTrips = destInfo.index.stopTrips.get(midStop.stop_id);
            if (!connectTrips) continue;

            for (const conn of connectTrips.slice(0, 20)) {
              if (parseGtfsTime(conn.departure) < minDepartMin) continue;

              const trip2 = destInfo.index.trips.get(conn.trip_id);
              if (!trip2) continue;
              if (!isServiceActive(trip2.service_id, gameDateYMD, destInfo.index)) continue;

              // Check forbidden transfer
              const route1 = orig.index.routes.get(trip1.route_id);
              const route2 = destInfo.index.routes.get(trip2.route_id);
              if (orig.index.forbiddenTransfers.has(`${midStop.stop_id}:${trip1.route_id}→${trip2.route_id}`)) continue;

              // Check if trip2 reaches dest
              const trip2Stops = destInfo.index.tripStops.get(conn.trip_id);
              if (!trip2Stops) continue;

              const destEntry = trip2Stops.find(
                (ts) => ts.stop_id === destInfo.stop.stop_id && ts.stop_sequence > conn.stop_sequence
              );
              if (!destEntry) continue;

              const destArriveMin = parseGtfsTime(destEntry.arrival_time);
              const destTz = destInfo.stop.stop_timezone || "America/New_York";
              const destArriveEst = gtfsTimeToEst(destArriveMin % 1440, destTz);

              const lastMileMin = estimateDriveMinutes(destInfo.stop.stop_lat, destInfo.stop.stop_lon, venueLat, venueLng);
              if (destArriveEst + lastMileMin > arrivalDeadline) continue;

              // Build itinerary
              const departMin = parseGtfsTime(origEntry.departure);
              const origTz = orig.stop.stop_timezone || "America/New_York";
              const departEst = gtfsTimeToEst(departMin % 1440, origTz);
              const firstMileMin = orig.driveMinFromOrigin;
              const leaveHomeEst = departEst - firstMileMin;

              // Skip if departure is in the past
              if (leaveHomeEst < earliestDepartEst) continue;

              const totalArrivalEst = destArriveEst + lastMileMin;
              const totalMinutes = totalArrivalEst - leaveHomeEst;
              if (totalMinutes <= 0 || totalMinutes > 2880) continue;

              const legs: Leg[] = [];

              // First mile
              if (firstMileMin > 5) {
                const firstMileMiles = orig.distFromOriginMiles;
                legs.push({
                  mode: "rideshare",
                  from: "Your location", fromLat: originLat, fromLng: originLng,
                  to: orig.stop.stop_name, toLat: orig.stop.stop_lat, toLng: orig.stop.stop_lon,
                  depart: toIso(gameDateYMD, leaveHomeEst), arrive: toIso(gameDateYMD, departEst),
                  minutes: firstMileMin, cost: estimateRideFare(firstMileMiles * 1.4, firstMileMin),
                  miles: Math.round(firstMileMiles * 1.4),
                });
              }

              // Leg 1
              const leg1Miles = haversineMiles(orig.stop.stop_lat, orig.stop.stop_lon, midStop.stop_lat, midStop.stop_lon);
              const mode1: "bus" | "train" = orig.index.provider === "amtrak" ? "train" : "bus";
              const midArriveEst = gtfsTimeToEst(midArriveMin % 1440, midStop.stop_timezone || "America/New_York");
              legs.push({
                mode: mode1,
                carrier: carrierName(route1?.agency_id ?? ""),
                routeName: route1?.route_short_name || "",
                from: orig.stop.stop_name, fromLat: orig.stop.stop_lat, fromLng: orig.stop.stop_lon,
                to: midStop.stop_name, toLat: midStop.stop_lat, toLng: midStop.stop_lon,
                depart: toIso(gameDateYMD, departEst), arrive: toIso(gameDateYMD, midArriveEst),
                minutes: midArriveMin - departMin,
                cost: mode1 === "train" ? estimateTrainFare(leg1Miles) : estimateBusFare(leg1Miles, route1?.agency_id ?? ""),
                bookingUrl: bookingUrl(route1?.agency_id ?? "") || (mode1 === "train" ? "https://www.amtrak.com" : undefined),
                miles: Math.round(leg1Miles),
              });

              // Leg 2
              const connDepartMin = parseGtfsTime(conn.departure);
              const connDepartEst = gtfsTimeToEst(connDepartMin % 1440, midStop.stop_timezone || "America/New_York");
              const leg2Miles = haversineMiles(midStop.stop_lat, midStop.stop_lon, destInfo.stop.stop_lat, destInfo.stop.stop_lon);
              const mode2: "bus" | "train" = destInfo.index.provider === "amtrak" ? "train" : "bus";
              legs.push({
                mode: mode2,
                carrier: carrierName(route2?.agency_id ?? ""),
                routeName: route2?.route_short_name || "",
                from: midStop.stop_name, fromLat: midStop.stop_lat, fromLng: midStop.stop_lon,
                to: destInfo.stop.stop_name, toLat: destInfo.stop.stop_lat, toLng: destInfo.stop.stop_lon,
                depart: toIso(gameDateYMD, connDepartEst), arrive: toIso(gameDateYMD, destArriveEst),
                minutes: destArriveMin - connDepartMin,
                cost: mode2 === "train" ? estimateTrainFare(leg2Miles) : estimateBusFare(leg2Miles, route2?.agency_id ?? ""),
                bookingUrl: bookingUrl(route2?.agency_id ?? "") || (mode2 === "train" ? "https://www.amtrak.com" : undefined),
                miles: Math.round(leg2Miles),
              });

              // Last mile
              if (lastMileMin > 5) {
                const lastMileMiles = destInfo.distToVenueMiles;
                legs.push({
                  mode: "rideshare",
                  from: destInfo.stop.stop_name, fromLat: destInfo.stop.stop_lat, fromLng: destInfo.stop.stop_lon,
                  to: venueName, toLat: venueLat, toLng: venueLng,
                  depart: toIso(gameDateYMD, destArriveEst), arrive: toIso(gameDateYMD, totalArrivalEst),
                  minutes: lastMileMin, cost: estimateRideFare(destInfo.distToVenueMiles * 1.4, lastMileMin),
                  miles: Math.round(lastMileMiles * 1.4),
                });
              }

              itineraries.push({
                id: `gtfs-1x-${idCounter++}`,
                totalMinutes,
                totalCost: legs.reduce((s, l) => s + l.cost, 0),
                departureTime: legs[0].depart,
                arrivalTime: legs[legs.length - 1].arrive,
                bufferMinutes: gameMinutesEst - totalArrivalEst,
                legs,
              });
            }
          }
        }
      }
    }
  }

  // ── Phase E: Flight itineraries ──

  if (stadium) {
    const destAirports = stadium.airports ?? [];
    // Find origin airports within 100mi
    const originAirports: { code: string; name: string; lat: number; lng: number }[] = [];
    const allAirports: { code: string; shortName: string; fullName: string; countryCode: string }[] = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "data", "airports.json"), "utf-8")
    );

    // Also add airports from nearby stadiums
    const stadiums = getStadiumData();
    const seenCodes = new Set<string>();
    for (const s of Object.values(stadiums)) {
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
        if (flightMiles < 100) continue; // too short to fly

        const flightMin = Math.round(flightMiles / 500 * 60 + 90); // speed + airport overhead
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
        const venueArriveEst = arrivalDeadline;
        const airportArriveEst = venueArriveEst - fromAirportMin;
        const flightDepartEst = airportArriveEst - flightMin;
        const leaveHomeEst = flightDepartEst - toAirportMin - 90; // 90min pre-flight buffer

        if (leaveHomeEst < 0) continue; // would need to leave before midnight

        // Skip if departure is in the past
        if (leaveHomeEst < earliestDepartEst) continue;

        const totalMinutes = venueArriveEst - leaveHomeEst;

        const legs: Leg[] = [];

        // First mile
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

        // Last mile
        if (fromAirportMin > 5) {
          legs.push({
            mode: "rideshare",
            from: destApt.name, fromLat: destApt.lat, fromLng: destApt.lng,
            to: venueName, toLat: venueLat, toLng: venueLng,
            depart: toIso(gameDateYMD, airportArriveEst),
            arrive: toIso(gameDateYMD, venueArriveEst),
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
          bufferMinutes: gameMinutesEst - venueArriveEst,
          legs,
        });
      }
    }
  }

  // ── Phase F: Drive-only itinerary ──

  {
    const driveMiles = haversineMiles(originLat, originLng, venueLat, venueLng);
    const roadMiles = driveMiles * 1.4;
    const driveMin = estimateDriveMinutes(originLat, originLng, venueLat, venueLng);
    const driveCost = estimateDriveCost(roadMiles);

    const arriveEst = arrivalDeadline;
    const departEst = arriveEst - driveMin;

    // Only add drive option if departure is not in the past
    if (departEst >= earliestDepartEst) {
      const gmapsLink = `https://www.google.com/maps/dir/?api=1&origin=${originLat},${originLng}&destination=${venueLat},${venueLng}&travelmode=driving`;

      itineraries.push({
        id: `drive-${idCounter++}`,
        totalMinutes: driveMin,
        totalCost: driveCost,
        departureTime: toIso(gameDateYMD, departEst),
        arrivalTime: toIso(gameDateYMD, arriveEst),
        bufferMinutes: gameMinutesEst - arriveEst,
        legs: [{
          mode: "drive",
          from: "Your location", fromLat: originLat, fromLng: originLng,
          to: venueName, toLat: venueLat, toLng: venueLng,
          depart: toIso(gameDateYMD, departEst),
          arrive: toIso(gameDateYMD, arriveEst),
          minutes: driveMin, cost: driveCost,
          bookingUrl: gmapsLink,
          miles: Math.round(roadMiles),
        }],
      });
    }
  }

  // ── Phase G: Score & rank ──

  return rankItineraries(itineraries, params.preference);
}

// ── Scoring ────────────────────────────────────────────────────────────────

const WEIGHTS: Record<Preference, { time: number; cost: number; transfers: number; modeBonus?: string }> = {
  balanced:      { time: 0.35, cost: 0.35, transfers: 0.30 },
  cheapest:      { time: 0.15, cost: 0.70, transfers: 0.15 },
  fastest:       { time: 0.70, cost: 0.15, transfers: 0.15 },
  prefer_bus:    { time: 0.25, cost: 0.30, transfers: 0.20, modeBonus: "bus" },
  prefer_train:  { time: 0.25, cost: 0.30, transfers: 0.20, modeBonus: "train" },
  prefer_plane:  { time: 0.25, cost: 0.30, transfers: 0.20, modeBonus: "flight" },
};

function rankItineraries(itineraries: Itinerary[], preference: Preference): Itinerary[] {
  if (itineraries.length === 0) return [];

  const w = WEIGHTS[preference];

  // Compute min/max for normalization
  const times = itineraries.map((i) => i.totalMinutes);
  const costs = itineraries.map((i) => i.totalCost);
  const transfers = itineraries.map((i) => Math.max(0, i.legs.filter((l) => l.mode !== "rideshare" && l.mode !== "walk").length - 1));

  const minTime = Math.min(...times), maxTime = Math.max(...times);
  const minCost = Math.min(...costs), maxCost = Math.max(...costs);
  const minTx = Math.min(...transfers), maxTx = Math.max(...transfers);

  const norm = (val: number, min: number, max: number) => max === min ? 0 : (val - min) / (max - min);

  const scored = itineraries.map((it, idx) => {
    const tNorm = norm(times[idx], minTime, maxTime);
    const cNorm = norm(costs[idx], minCost, maxCost);
    const xNorm = norm(transfers[idx], minTx, maxTx);

    let score = w.time * tNorm + w.cost * cNorm + w.transfers * xNorm;

    // Mode bonus: penalize if preferred mode not present
    if (w.modeBonus) {
      const hasMode = it.legs.some((l) => l.mode === w.modeBonus);
      if (!hasMode) score += 0.3;
    }

    return { it, score };
  });

  scored.sort((a, b) => a.score - b.score);

  // Ensure mode diversity: at least 1 of each available mode in top 10
  const top: Itinerary[] = [];
  const modes = new Set<string>();
  const usedIds = new Set<string>();

  // First, pick one of each mode
  for (const mode of ["drive", "bus", "train", "flight"]) {
    const entry = scored.find((s) => !usedIds.has(s.it.id) && s.it.legs.some((l) => l.mode === mode));
    if (entry) {
      top.push(entry.it);
      usedIds.add(entry.it.id);
      modes.add(mode);
    }
  }

  // Fill remaining from scored order
  for (const entry of scored) {
    if (top.length >= 10) break;
    if (usedIds.has(entry.it.id)) continue;
    top.push(entry.it);
    usedIds.add(entry.it.id);
  }

  return top;
}
