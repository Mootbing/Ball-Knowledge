"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import routesRaw from "../../data/frontier-routes.json";
import { buildAdjacency, findPaths, type Path } from "@/lib/pathfinder";
import { cityToIata, buildFrontierUrl } from "@/lib/frontier";
import { CityInputMulti } from "@/components/city-input";
import { haversineKm, cityCoords } from "@/lib/frontier-coords";
import { Slider } from "@/components/ui/slider";
import { Plane } from "lucide-react";

const routes = routesRaw as { from: string; to: string }[];

function sliderLabel(v: number) {
  if (v === 0) return "Nonstop";
  return v >= 5 ? "Unlimited" : String(v);
}
function sliderToMaxLayovers(v: number) {
  if (v === 0) return 0;
  return v >= 5 ? 10 : v;
}

function findNearestCity(lat: number, lng: number): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  for (const [city, coords] of Object.entries(cityCoords)) {
    const d = haversineKm(lat, lng, coords[0], coords[1]);
    if (d < bestDist) { bestDist = d; best = city; }
  }
  return best;
}

// ── Types matching take-me page ────────────────────────────────────────────

interface Leg {
  mode: "flight" | "drive" | "rideshare" | "transit" | "bus" | "train";
  carrier?: string;
  routeName?: string;
  from: string;
  fromLat: number;
  fromLng: number;
  to: string;
  toLat: number;
  toLng: number;
  depart: string;
  arrive: string;
  minutes: number;
  cost: number | null;
  bookingUrl?: string;
  miles: number;
  enrichable?: boolean;
}

interface Itinerary {
  id: string;
  totalMinutes: number;
  totalCost: number | null;
  departureTime: string;
  arrivalTime: string;
  bufferMinutes: number;
  legs: Leg[];
  enriched?: boolean;
}

// ── Path → Itinerary conversion ────────────────────────────────────────────

const PRE_FLIGHT_MIN = 90;
const LAYOVER_MIN = 60;

function pathToItinerary(
  path: Path,
  originLat: number,
  originLng: number,
  venueLat: number,
  venueLng: number,
  venueName: string,
  date: string,
  gameTime: string,
): Itinerary | null {
  const firstStop = path.stops[0];
  const lastStop = path.stops[path.stops.length - 1];
  const firstCoords = cityCoords[firstStop];
  const lastCoords = cityCoords[lastStop];
  if (!firstCoords || !lastCoords) return null;

  // Drive to first airport
  const driveToKm = haversineKm(originLat, originLng, firstCoords[0], firstCoords[1]);
  const driveToMin = Math.max(10, Math.round(driveToKm * 0.621371 / 45 * 60));
  const driveToMi = Math.round(driveToKm * 0.621371);

  // Flight segments
  const flightMins: number[] = [];
  const flightMiles: number[] = [];
  for (let i = 0; i < path.stops.length - 1; i++) {
    const a = cityCoords[path.stops[i]];
    const b = cityCoords[path.stops[i + 1]];
    if (!a || !b) { flightMins.push(60); flightMiles.push(0); continue; }
    const km = haversineKm(a[0], a[1], b[0], b[1]);
    flightMins.push(Math.round(km / 800 * 60 + 45));
    flightMiles.push(Math.round(km * 0.621371));
  }

  // Drive from last airport to venue
  const driveFromKm = haversineKm(lastCoords[0], lastCoords[1], venueLat, venueLng);
  const driveFromMin = Math.max(10, Math.round(driveFromKm * 0.621371 / 45 * 60));
  const driveFromMi = Math.round(driveFromKm * 0.621371);

  // Total duration
  const totalFlightMin = flightMins.reduce((s, m) => s + m, 0);
  const connectLayoverMin = Math.max(0, path.stops.length - 2) * LAYOVER_MIN;
  const totalMin = driveToMin + PRE_FLIGHT_MIN + totalFlightMin + connectLayoverMin + driveFromMin;

  // Work backwards from game time
  const [h, m] = gameTime.split(":").map(Number);
  const gameMs = new Date(`${date}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`).getTime();
  const arriveMs = gameMs - 60 * 60000; // aim to arrive 1hr before game
  const departMs = arriveMs - totalMin * 60000;

  let t = departMs;
  const legs: Leg[] = [];

  // Leg 1: drive to departure airport
  legs.push({
    mode: "rideshare",
    from: "Your Location",
    fromLat: originLat,
    fromLng: originLng,
    to: firstStop,
    toLat: firstCoords[0],
    toLng: firstCoords[1],
    depart: new Date(t).toISOString(),
    arrive: new Date(t + driveToMin * 60000).toISOString(),
    minutes: driveToMin,
    cost: null,
    miles: driveToMi,
    enrichable: true,
  });
  t += driveToMin * 60000;

  // Pre-flight buffer (shows as layover gap in the timeline)
  t += PRE_FLIGHT_MIN * 60000;

  // Flight legs
  for (let i = 0; i < path.stops.length - 1; i++) {
    const from = path.stops[i];
    const to = path.stops[i + 1];
    const fromC = cityCoords[from]!;
    const toC = cityCoords[to]!;

    legs.push({
      mode: "flight",
      carrier: "Frontier",
      from,
      fromLat: fromC[0],
      fromLng: fromC[1],
      to,
      toLat: toC[0],
      toLng: toC[1],
      depart: new Date(t).toISOString(),
      arrive: new Date(t + flightMins[i] * 60000).toISOString(),
      minutes: flightMins[i],
      cost: 16,
      bookingUrl: buildFrontierUrl(from, to, date),
      miles: flightMiles[i],
      enrichable: false,
    });
    t += flightMins[i] * 60000;

    // Layover between connecting flights
    if (i < path.stops.length - 2) {
      t += LAYOVER_MIN * 60000;
    }
  }

  // Last leg: drive from arrival airport to venue
  legs.push({
    mode: "rideshare",
    from: lastStop,
    fromLat: lastCoords[0],
    fromLng: lastCoords[1],
    to: venueName,
    toLat: venueLat,
    toLng: venueLng,
    depart: new Date(t).toISOString(),
    arrive: new Date(t + driveFromMin * 60000).toISOString(),
    minutes: driveFromMin,
    cost: null,
    miles: driveFromMi,
    enrichable: true,
  });
  t += driveFromMin * 60000;

  const totalCost = legs.reduce((s, l) => s + (l.cost ?? 0), 0) || null;

  return {
    id: `frontier-${path.stops.map(s => cityToIata[s] ?? s).join("-")}`,
    totalMinutes: totalMin,
    totalCost,
    departureTime: new Date(departMs).toISOString(),
    arrivalTime: new Date(t).toISOString(),
    bufferMinutes: PRE_FLIGHT_MIN,
    legs,
  };
}

// ── Component ──────────────────────────────────────────────────────────────

export function FrontierPanel({
  date: initDate,
  gameTime,
  originLat,
  originLng,
  venueLat,
  venueLng,
  venueName,
  onResults,
}: {
  date?: string;
  gameTime?: string;
  originLat?: number;
  originLng?: number;
  venueLat?: number;
  venueLng?: number;
  venueName?: string;
  onResults: (itineraries: Itinerary[]) => void;
}) {
  const onResultsRef = useRef(onResults);
  onResultsRef.current = onResults;

  const autoFrom = useMemo(
    () => (originLat && originLng ? findNearestCity(originLat, originLng) : null),
    [originLat, originLng]
  );
  const autoTo = useMemo(
    () => (venueLat && venueLng ? findNearestCity(venueLat, venueLng) : null),
    [venueLat, venueLng]
  );

  const [froms, setFroms] = useState<string[]>(autoFrom ? [autoFrom] : []);
  const [tos, setTos] = useState<string[]>(autoTo ? [autoTo] : []);
  const [date, setDate] = useState(initDate ?? new Date().toISOString().slice(0, 10));
  const [slider, setSlider] = useState(1);
  const [loading, setLoading] = useState(false);
  const [resultCount, setResultCount] = useState<number | null>(null);

  const adj = useMemo(() => buildAdjacency(routes), []);

  const doSearch = useCallback((searchFroms: string[], searchTos: string[]) => {
    if (searchFroms.length === 0 || searchTos.length === 0) return;
    if (!originLat || !originLng || !venueLat || !venueLng) return;

    setLoading(true);
    setTimeout(() => {
      const seen = new Set<string>();
      const allPaths: Path[] = [];
      for (const from of searchFroms) {
        for (const to of searchTos) {
          if (from === to) continue;
          for (const p of findPaths(adj, from, to, sliderToMaxLayovers(slider))) {
            const key = p.stops.join("→");
            if (!seen.has(key)) { seen.add(key); allPaths.push(p); }
          }
        }
      }
      allPaths.sort((a, b) => a.layovers - b.layovers || a.stops.length - b.stops.length);

      const itineraries = allPaths
        .map(p => pathToItinerary(
          p, originLat!, originLng!, venueLat!, venueLng!,
          venueName ?? "Venue", date, gameTime ?? "19:00",
        ))
        .filter((it): it is Itinerary => it !== null);

      setResultCount(itineraries.length);
      onResultsRef.current(itineraries);
      setLoading(false);
    }, 0);
  }, [adj, slider, originLat, originLng, venueLat, venueLng, venueName, date, gameTime]);

  // Auto-search on mount when from/to are pre-filled
  const autoSearched = useRef(false);
  useEffect(() => {
    if (!autoSearched.current && autoFrom && autoTo && originLat && originLng && venueLat && venueLng) {
      autoSearched.current = true;
      doSearch([autoFrom], [autoTo]);
    }
  }, [autoFrom, autoTo, originLat, originLng, venueLat, venueLng, doSearch]);

  return (
    <div className="px-4 py-3 border-b border-white/5 bg-[#0a0a0f]">
      <div className="flex items-center gap-2 mb-3">
        <Plane className="size-4 text-[--color-flight]" />
        <span className="text-xs font-mono font-bold text-foreground tracking-wider">FRONTIER FLIGHTS</span>
        {loading && (
          <span className="text-xs font-mono text-[--color-dim] ml-auto animate-pulse">SEARCHING...</span>
        )}
        {!loading && resultCount !== null && (
          <span className="text-xs font-mono text-[--color-dim] ml-auto">
            {resultCount} route{resultCount !== 1 ? "s" : ""}
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <CityInputMulti id="fp-from" label="From" values={froms} onChange={setFroms} userCoords={null} />
        <CityInputMulti id="fp-to" label="To" values={tos} onChange={setTos} userCoords={null} />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="fp-date" className="block text-xs font-mono font-semibold text-[--color-dim] mb-1">TRAVEL DATE</label>
          <input
            id="fp-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-[38px] px-2.5 border border-white/8 rounded bg-white/5 text-sm text-foreground font-mono focus:ring-2 focus:ring-[--primary]/50 outline-none"
          />
        </div>
        <div className="min-w-[140px]">
          <label className="block text-xs font-mono font-semibold text-[--color-dim] mb-1">
            MAX STOPS: <span className="text-[--primary] font-bold">{sliderLabel(slider)}</span>
          </label>
          <Slider
            min={0}
            max={5}
            step={1}
            value={[slider]}
            onValueChange={([v]) => setSlider(v)}
            className="w-full"
          />
        </div>
        <button
          onClick={() => doSearch(froms, tos)}
          disabled={loading || froms.length === 0 || tos.length === 0}
          className="h-[38px] px-5 rounded bg-[--primary] text-[--primary-foreground] text-sm font-mono font-semibold hover:opacity-90 transition-colors disabled:opacity-50"
        >
          Search
        </button>
      </div>
    </div>
  );
}
