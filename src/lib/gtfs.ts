import fs from "fs";
import path from "path";
import Papa from "papaparse";

// ── Types ──────────────────────────────────────────────────────────────────

export interface GtfsStop {
  stop_id: string;
  stop_name: string;
  stop_lat: number;
  stop_lon: number;
  stop_code: string;
  stop_timezone: string;
}

export interface GtfsStopTime {
  trip_id: string;
  stop_id: string;
  arrival_time: string;
  departure_time: string;
  stop_sequence: number;
}

export interface GtfsTrip {
  route_id: string;
  trip_id: string;
  service_id: string;
}

export interface GtfsCalendar {
  service_id: string;
  days: boolean[]; // [mon, tue, wed, thu, fri, sat, sun]
  start_date: string; // YYYYMMDD
  end_date: string;
}

export interface GtfsCalendarDate {
  service_id: string;
  date: string; // YYYYMMDD
  exception_type: number; // 1=added, 2=removed
}

export interface GtfsRoute {
  route_id: string;
  route_short_name: string;
  route_long_name: string;
  agency_id: string;
}

export interface GtfsIndex {
  provider: "bus" | "amtrak";
  stops: Map<string, GtfsStop>;
  stopsByCode: Map<string, GtfsStop>;
  routes: Map<string, GtfsRoute>;
  trips: Map<string, GtfsTrip>;
  calendars: Map<string, GtfsCalendar>;
  calendarDates: Map<string, GtfsCalendarDate[]>;
  tripStops: Map<string, GtfsStopTime[]>; // trip_id → sorted stop_times
  stopTrips: Map<string, { trip_id: string; stop_sequence: number; arrival: string; departure: string }[]>;
  forbiddenTransfers: Set<string>; // "fromStopId:fromRouteId→toRouteId"
}

// ── Module-level cache ─────────────────────────────────────────────────────

let cached: { bus: GtfsIndex; amtrak: GtfsIndex | null } | null = null;

// ── CSV parsing helper ─────────────────────────────────────────────────────

function parseCSV<T>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, "utf-8");
  // Strip BOM if present
  const cleaned = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const result = Papa.parse<T>(cleaned, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false, // keep as strings, we parse numbers explicitly
  });
  return result.data;
}

// ── Build index from a GTFS directory ──────────────────────────────────────

function parseGtfsDir(dir: string, provider: "bus" | "amtrak"): GtfsIndex {
  const stops = new Map<string, GtfsStop>();
  const stopsByCode = new Map<string, GtfsStop>();
  const routes = new Map<string, GtfsRoute>();
  const trips = new Map<string, GtfsTrip>();
  const calendars = new Map<string, GtfsCalendar>();
  const calendarDates = new Map<string, GtfsCalendarDate[]>();
  const tripStops = new Map<string, GtfsStopTime[]>();
  const stopTrips = new Map<string, { trip_id: string; stop_sequence: number; arrival: string; departure: string }[]>();
  const forbiddenTransfers = new Set<string>();

  // Stops
  for (const row of parseCSV<Record<string, string>>(path.join(dir, "stops.txt"))) {
    // Amtrak GTFS has no stop_code column — the 3-letter station codes are in stop_id
    const code = row.stop_code || row.stop_id || "";
    const s: GtfsStop = {
      stop_id: row.stop_id ?? "",
      stop_name: row.stop_name ?? "",
      stop_lat: parseFloat(row.stop_lat ?? "0"),
      stop_lon: parseFloat(row.stop_lon ?? "0"),
      stop_code: code,
      stop_timezone: row.stop_timezone ?? "",
    };
    if (s.stop_id) stops.set(s.stop_id, s);
    if (code) stopsByCode.set(code, s);
  }

  // Routes
  for (const row of parseCSV<Record<string, string>>(path.join(dir, "routes.txt"))) {
    routes.set(row.route_id ?? "", {
      route_id: row.route_id ?? "",
      route_short_name: row.route_short_name ?? "",
      route_long_name: row.route_long_name ?? "",
      agency_id: row.agency_id ?? "",
    });
  }

  // Trips
  for (const row of parseCSV<Record<string, string>>(path.join(dir, "trips.txt"))) {
    trips.set(row.trip_id ?? "", {
      route_id: row.route_id ?? "",
      trip_id: row.trip_id ?? "",
      service_id: row.service_id ?? "",
    });
  }

  // Calendar
  for (const row of parseCSV<Record<string, string>>(path.join(dir, "calendar.txt"))) {
    calendars.set(row.service_id ?? "", {
      service_id: row.service_id ?? "",
      days: [
        row.monday === "1",
        row.tuesday === "1",
        row.wednesday === "1",
        row.thursday === "1",
        row.friday === "1",
        row.saturday === "1",
        row.sunday === "1",
      ],
      start_date: row.start_date ?? "",
      end_date: row.end_date ?? "",
    });
  }

  // Calendar dates (exceptions)
  for (const row of parseCSV<Record<string, string>>(path.join(dir, "calendar_dates.txt"))) {
    const sid = row.service_id ?? "";
    const entry: GtfsCalendarDate = {
      service_id: sid,
      date: row.date ?? "",
      exception_type: parseInt(row.exception_type ?? "0", 10),
    };
    const arr = calendarDates.get(sid);
    if (arr) arr.push(entry);
    else calendarDates.set(sid, [entry]);
  }

  // Stop times — build tripStops and stopTrips
  for (const row of parseCSV<Record<string, string>>(path.join(dir, "stop_times.txt"))) {
    const st: GtfsStopTime = {
      trip_id: row.trip_id ?? "",
      stop_id: row.stop_id ?? "",
      arrival_time: row.arrival_time ?? "",
      departure_time: row.departure_time ?? "",
      stop_sequence: parseInt(row.stop_sequence ?? "0", 10),
    };

    // tripStops
    let arr = tripStops.get(st.trip_id);
    if (!arr) { arr = []; tripStops.set(st.trip_id, arr); }
    arr.push(st);

    // stopTrips
    let sarr = stopTrips.get(st.stop_id);
    if (!sarr) { sarr = []; stopTrips.set(st.stop_id, sarr); }
    sarr.push({ trip_id: st.trip_id, stop_sequence: st.stop_sequence, arrival: st.arrival_time, departure: st.departure_time });
  }

  // Sort tripStops by stop_sequence
  for (const arr of tripStops.values()) {
    arr.sort((a, b) => a.stop_sequence - b.stop_sequence);
  }

  // Transfers (type=3 = forbidden)
  for (const row of parseCSV<Record<string, string>>(path.join(dir, "transfers.txt"))) {
    if (row.transfer_type === "3") {
      const key = `${row.from_stop_id}:${row.from_route_id}→${row.to_route_id}`;
      forbiddenTransfers.add(key);
    }
  }

  return { provider, stops, stopsByCode, routes, trips, calendars, calendarDates, tripStops, stopTrips, forbiddenTransfers };
}

// ── Amtrak GTFS download ──────────────────────────────────────────────────

const AMTRAK_GTFS_URL = "https://content.amtrak.com/content/gtfs/GTFS.zip";
const AMTRAK_DIR = path.join(process.cwd(), "gtfs_amtrak");

async function downloadAmtrakGtfs(): Promise<boolean> {
  try {
    const AdmZip = (await import("adm-zip")).default;
    console.log("[GTFS] Downloading Amtrak GTFS...");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const res = await fetch(AMTRAK_GTFS_URL, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) {
      console.error(`[GTFS] Amtrak download failed: ${res.status}`);
      return false;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const zip = new AdmZip(buffer);
    if (!fs.existsSync(AMTRAK_DIR)) fs.mkdirSync(AMTRAK_DIR, { recursive: true });
    zip.extractAllTo(AMTRAK_DIR, true);
    console.log("[GTFS] Amtrak GTFS extracted to", AMTRAK_DIR);
    return true;
  } catch (err) {
    console.error("[GTFS] Amtrak download error:", err);
    return false;
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function ensureGtfsLoaded(): Promise<{ bus: GtfsIndex; amtrak: GtfsIndex | null }> {
  if (cached) return cached;

  const busDir = path.join(process.cwd(), "gtfs_generic_us");
  console.log("[GTFS] Parsing bus GTFS...");
  const bus = parseGtfsDir(busDir, "bus");
  console.log(`[GTFS] Bus: ${bus.stops.size} stops, ${bus.tripStops.size} trips`);

  let amtrak: GtfsIndex | null = null;
  const amtrakStopsFile = path.join(AMTRAK_DIR, "stops.txt");
  if (!fs.existsSync(amtrakStopsFile)) {
    const ok = await downloadAmtrakGtfs();
    if (ok && fs.existsSync(amtrakStopsFile)) {
      console.log("[GTFS] Parsing Amtrak GTFS...");
      amtrak = parseGtfsDir(AMTRAK_DIR, "amtrak");
      console.log(`[GTFS] Amtrak: ${amtrak.stops.size} stops, ${amtrak.tripStops.size} trips`);
    }
  } else {
    console.log("[GTFS] Parsing Amtrak GTFS (cached)...");
    amtrak = parseGtfsDir(AMTRAK_DIR, "amtrak");
    console.log(`[GTFS] Amtrak: ${amtrak.stops.size} stops, ${amtrak.tripStops.size} trips`);
  }

  cached = { bus, amtrak };
  return cached;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Parse GTFS time like "25:35:00" → total minutes from midnight (1535) */
export function parseGtfsTime(t: string): number {
  const parts = t.split(":");
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

/** Check if a service is active on a given date (YYYYMMDD format) */
export function isServiceActive(serviceId: string, dateYYYYMMDD: string, index: GtfsIndex): boolean {
  // Check calendar_dates exceptions first
  const exceptions = index.calendarDates.get(serviceId);
  if (exceptions) {
    for (const ex of exceptions) {
      if (ex.date === dateYYYYMMDD) {
        return ex.exception_type === 1; // 1=added, 2=removed
      }
    }
  }

  // Check regular calendar
  const cal = index.calendars.get(serviceId);
  if (!cal) return false;

  // Date range check
  if (dateYYYYMMDD < cal.start_date || dateYYYYMMDD > cal.end_date) return false;

  // Day of week (0=mon..6=sun for our array)
  const y = parseInt(dateYYYYMMDD.substring(0, 4), 10);
  const m = parseInt(dateYYYYMMDD.substring(4, 6), 10) - 1;
  const d = parseInt(dateYYYYMMDD.substring(6, 8), 10);
  const dow = new Date(y, m, d).getDay(); // 0=sun, 1=mon, ..., 6=sat
  // Convert JS dow to our index: mon=0 ... sun=6
  const idx = dow === 0 ? 6 : dow - 1;
  return cal.days[idx];
}

/** Haversine distance in miles */
export function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Find stops within a radius (miles) */
export function findStopsNear(lat: number, lng: number, radiusMiles: number, index: GtfsIndex): GtfsStop[] {
  const results: GtfsStop[] = [];
  for (const stop of index.stops.values()) {
    if (haversineMiles(lat, lng, stop.stop_lat, stop.stop_lon) <= radiusMiles) {
      results.push(stop);
    }
  }
  return results;
}

// US timezone offsets from UTC (standard time — not handling DST here for simplicity,
// since game times & GTFS times are both in local tz, we mainly need this for cross-tz comparison)
const TZ_OFFSETS: Record<string, number> = {
  "America/New_York": -5,
  "America/Chicago": -6,
  "America/Denver": -7,
  "America/Los_Angeles": -8,
  "America/Phoenix": -7,
  "America/Edmonton": -7,
  "America/Winnipeg": -6,
  "America/Toronto": -5,
  "America/Vancouver": -8,
  "US/Eastern": -5,
  "US/Central": -6,
  "US/Mountain": -7,
  "US/Pacific": -8,
};

/** Convert a GTFS time (minutes from midnight in stop's local tz) to EST minutes */
export function gtfsTimeToEst(minutesFromMidnight: number, stopTimezone: string): number {
  const offset = TZ_OFFSETS[stopTimezone] ?? -5; // default to EST
  const estOffset = -5;
  const diff = (estOffset - offset) * 60; // positive if stop is west of EST
  return minutesFromMidnight + diff;
}
