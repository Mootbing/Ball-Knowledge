"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RouteFocus, TransitStop, VenueInfo } from "./game-map";
import {
  ChevronUp,
  ChevronDown,
  Clock,
  MapPin,
  Plane,
  Car,
  Bus,
  TrainFront,
  BusFront,
  ArrowUpRight,
  RefreshCw,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from "lucide-react";

type TrayState = "collapsed" | "half";

interface GameEvent {
  id: string;
  name: string;
  url: string;
  est_time: string | null;
  venue: string;
  city: string;
  state: string;
  lat: number | null;
  lng: number | null;
  min_price: { amount: number; currency: string } | null;
  odds: {
    away_team: string;
    home_team: string;
    away_win: number;
    home_win: number;
    kalshi_event: string;
  } | null;
  away_record?: string | null;
  home_record?: string | null;
  espn_price?: { amount: number; available: number; url: string | null } | null;
  nearbyAirports?: TransitStop[];
  nearbyTrainStations?: TransitStop[];
  nearbyBusStations?: TransitStop[];
}

function formatTimeEST(time: string | null) {
  if (!time) return "TBD";
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

function formatDriveTime(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

function stubhubUrl(teamName: string): string {
  const slug = teamName.replace(/\s*\(.*?\)/g, "").trim().toLowerCase().replace(/\s+/g, "-");
  return `https://www.stubhub.com/${slug}-tickets`;
}

function gmapsUrl(fromLat: number, fromLng: number, toLat: number, toLng: number, mode: "driving" | "transit") {
  return `https://www.google.com/maps/dir/?api=1&origin=${fromLat},${fromLng}&destination=${toLat},${toLng}&travelmode=${mode}`;
}

function uberDeepLink(fromLat: number, fromLng: number, toLat: number, toLng: number) {
  return `https://m.uber.com/ul/?action=setPickup&pickup[latitude]=${fromLat}&pickup[longitude]=${fromLng}&dropoff[latitude]=${toLat}&dropoff[longitude]=${toLng}`;
}

function lyftDeepLink(fromLat: number, fromLng: number, toLat: number, toLng: number) {
  return `https://lyft.com/ride?pickup[latitude]=${fromLat}&pickup[longitude]=${fromLng}&destination[latitude]=${toLat}&destination[longitude]=${toLng}`;
}

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 3958.8; // Earth radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

type SortKey = "game" | "time" | "distance" | "spread" | "price" | null;
type SortDir = "asc" | "desc";

function formatDateHeading(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function BottomTray({
  games,
  date,
  selectedVenue,
  onVenueClick,
  onRouteFocus,
  trayState,
  onTrayStateChange,
  userLocation,
}: {
  games: GameEvent[];
  date: string;
  selectedVenue: string | null;
  onVenueClick: (venue: VenueInfo) => void;
  onRouteFocus: (focus: RouteFocus | null) => void;
  trayState: TrayState;
  onTrayStateChange: (state: TrayState) => void;
  userLocation: { lat: number; lng: number } | null;
}) {
  const dragStartY = useRef(0);
  const isDragging = useRef(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const prevTrayState = useRef(trayState);

  const [sortKey, setSortKey] = useState<SortKey>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Precompute distances
  const distanceMap = useMemo(() => {
    const map: Record<string, number> = {};
    if (!userLocation) return map;
    for (const g of games) {
      if (g.lat != null && g.lng != null) {
        map[g.id] = haversineMiles(userLocation.lat, userLocation.lng, g.lat, g.lng);
      }
    }
    return map;
  }, [games, userLocation]);

  const handleSort = useCallback((key: SortKey) => {
    if (key === "distance" && !userLocation) return;
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setSortDir("asc");
      return key;
    });
  }, [userLocation]);

  const sortedGames = useMemo(() => {
    if (!sortKey) return games;
    const sorted = [...games].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "game": {
          const nameA = a.name.toLowerCase();
          const nameB = b.name.toLowerCase();
          cmp = nameA.localeCompare(nameB);
          break;
        }
        case "time": {
          const tA = a.est_time ?? "99:99";
          const tB = b.est_time ?? "99:99";
          cmp = tA.localeCompare(tB);
          break;
        }
        case "distance": {
          const dA = distanceMap[a.id] ?? Infinity;
          const dB = distanceMap[b.id] ?? Infinity;
          cmp = dA - dB;
          break;
        }
        case "spread": {
          const sA = a.odds ? Math.abs(a.odds.away_win - a.odds.home_win) : Infinity;
          const sB = b.odds ? Math.abs(b.odds.away_win - b.odds.home_win) : Infinity;
          cmp = sA - sB;
          break;
        }
        case "price": {
          const pA = a.espn_price?.amount ?? a.min_price?.amount ?? Infinity;
          const pB = b.espn_price?.amount ?? b.min_price?.amount ?? Infinity;
          cmp = pA - pB;
          break;
        }
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [games, sortKey, sortDir, distanceMap]);

  // Enriched travel times: key = "venueLat,venueLng;stationLat,stationLng"
  const [enriched, setEnriched] = useState<Record<string, { driveMinutes: number; transitMinutes: number | null; transitFare: string | null; uberEstimate: string | null; lyftEstimate: string | null }>>({});
  const [enriching, setEnriching] = useState<Set<string>>(new Set());

  const enrichKey = (vLat: number, vLng: number, sLat: number, sLng: number) =>
    `${vLat},${vLng};${sLat},${sLng}`;

  const handleEnrich = useCallback(async (venueLat: number, venueLng: number, stop: TransitStop) => {
    const key = enrichKey(venueLat, venueLng, stop.lat, stop.lng);
    if (enriched[key] || enriching.has(key)) return;
    setEnriching((prev) => new Set(prev).add(key));
    try {
      const res = await fetch(
        `/api/travel-times?fromLat=${venueLat}&fromLng=${venueLng}&toLat=${stop.lat}&toLng=${stop.lng}`
      );
      if (res.ok) {
        const data = await res.json();
        setEnriched((prev) => ({ ...prev, [key]: data }));
      }
    } finally {
      setEnriching((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, [enriched, enriching]);

  const enrichAllOfType = useCallback(async (type: "airports" | "trains" | "buses") => {
    const field = type === "airports" ? "nearbyAirports" : type === "trains" ? "nearbyTrainStations" : "nearbyBusStations";
    const stops: { vLat: number; vLng: number; stop: TransitStop }[] = [];
    for (const event of games) {
      if (event.lat == null || event.lng == null) continue;
      for (const s of event[field] ?? []) {
        const key = enrichKey(event.lat!, event.lng!, s.lat, s.lng);
        if (!enriched[key] && !enriching.has(key) && !stops.some((x) => enrichKey(x.vLat, x.vLng, x.stop.lat, x.stop.lng) === key)) {
          stops.push({ vLat: event.lat!, vLng: event.lng!, stop: s });
        }
      }
    }
    await Promise.all(stops.map((s) => handleEnrich(s.vLat, s.vLng, s.stop)));
  }, [games, enriched, enriching, handleEnrich]);

  // Track tray state changes → disable hover during animation
  useEffect(() => {
    if (prevTrayState.current !== trayState) {
      prevTrayState.current = trayState;
      setIsAnimating(true);
      const timer = setTimeout(() => setIsAnimating(false), 400);
      return () => clearTimeout(timer);
    }
  }, [trayState]);

  const toggle = useCallback(() => {
    onTrayStateChange(trayState === "collapsed" ? "half" : "collapsed");
  }, [trayState, onTrayStateChange]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    dragStartY.current = e.clientY;
    isDragging.current = false;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const delta = Math.abs(e.clientY - dragStartY.current);
    if (delta > 10) isDragging.current = true;
  }, []);

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      const delta = dragStartY.current - e.clientY;
      if (isDragging.current) {
        if (delta > 50) {
          onTrayStateChange("half");
        } else if (delta < -50) {
          onTrayStateChange("collapsed");
        }
      } else {
        toggle();
      }
    },
    [toggle, onTrayStateChange]
  );

  const height = trayState === "collapsed" ? "52px" : "50vh";

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-10 tray-transition pointer-events-auto"
      style={{ height }}
    >
      <div className="h-full glass rounded-t-2xl flex flex-col">
        {/* Drag handle */}
        <div
          className="flex flex-col items-center pt-2 pb-1 cursor-grab active:cursor-grabbing select-none touch-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          <div className="w-10 h-1 rounded-full bg-gray-300 mb-1.5" />
          <div className="flex items-center gap-2 text-xs text-gray-500 px-4 w-full">
            <span className="font-medium">
              {games.length} game{games.length !== 1 ? "s" : ""} &middot;{" "}
              {formatDateHeading(date)}
            </span>
            <span className="flex-1" />
            {trayState === "collapsed" ? (
              <ChevronUp className="size-3.5" />
            ) : (
              <ChevronDown className="size-3.5" />
            )}
          </div>
        </div>

        {/* Scrollable game list */}
        {trayState === "half" && (
          <div className={`flex-1 overflow-y-auto no-scrollbar px-3 pb-3 ${isAnimating ? "pointer-events-none" : ""}`}>
            <table className="w-full text-sm">
              <thead className="sticky top-0 glass">
                <tr className="text-xs text-gray-400 border-b border-gray-200">
                  <th className="text-left py-2 px-2 font-medium">
                    <button onClick={() => handleSort("spread")} className="flex items-center gap-0.5 hover:text-gray-600">
                      Odds
                      {sortKey === "spread" ? (sortDir === "asc" ? <ArrowUp className="size-2.5" /> : <ArrowDown className="size-2.5" />) : <ArrowUpDown className="size-2.5" />}
                    </button>
                  </th>
                  <th className="text-left py-2 px-2 font-medium">
                    <button onClick={() => handleSort("price")} className="flex items-center gap-0.5 hover:text-gray-600">
                      Tickets
                      {sortKey === "price" ? (sortDir === "asc" ? <ArrowUp className="size-2.5" /> : <ArrowDown className="size-2.5" />) : <ArrowUpDown className="size-2.5" />}
                    </button>
                  </th>
                  <th className="text-left py-2 px-2 font-medium">
                    <button onClick={() => handleSort("game")} className="flex items-center gap-0.5 hover:text-gray-600">
                      Game
                      {sortKey === "game" ? (sortDir === "asc" ? <ArrowUp className="size-2.5" /> : <ArrowDown className="size-2.5" />) : <ArrowUpDown className="size-2.5" />}
                    </button>
                  </th>
                  <th className="text-left py-2 px-2 font-medium">
                    <button onClick={() => handleSort("time")} className="flex items-center gap-0.5 hover:text-gray-600">
                      Time
                      {sortKey === "time" ? (sortDir === "asc" ? <ArrowUp className="size-2.5" /> : <ArrowDown className="size-2.5" />) : <ArrowUpDown className="size-2.5" />}
                    </button>
                  </th>
                  <th className="text-left py-2 px-2 font-medium">
                    <button onClick={() => handleSort("distance")} className={`flex items-center gap-0.5 ${userLocation ? "hover:text-gray-600" : "opacity-40 cursor-not-allowed"}`} title={userLocation ? "Sort by distance" : "Set location to sort by distance"}>
                      Venue
                      {sortKey === "distance" ? (sortDir === "asc" ? <ArrowUp className="size-2.5" /> : <ArrowDown className="size-2.5" />) : <ArrowUpDown className="size-2.5" />}
                    </button>
                  </th>
                  <th className="text-left py-2 px-2 font-medium">
                    <span className="flex items-center gap-1">
                      Airports
                      <button onClick={() => enrichAllOfType("airports")} title="Enrich all airports" className="text-gray-400 hover:text-gray-600">
                        <RefreshCw className="size-2.5" />
                      </button>
                    </span>
                  </th>
                  <th className="text-left py-2 px-2 font-medium">
                    <span className="flex items-center gap-1">
                      Trains
                      <button onClick={() => enrichAllOfType("trains")} title="Enrich all trains" className="text-gray-400 hover:text-gray-600">
                        <RefreshCw className="size-2.5" />
                      </button>
                    </span>
                  </th>
                  <th className="text-left py-2 px-2 font-medium">
                    <span className="flex items-center gap-1">
                      Buses
                      <button onClick={() => enrichAllOfType("buses")} title="Enrich all buses" className="text-gray-400 hover:text-gray-600">
                        <RefreshCw className="size-2.5" />
                      </button>
                    </span>
                  </th>
                  <th className="text-left py-2 px-2 font-medium">Links</th>
                </tr>
              </thead>
              <tbody>
                {sortedGames.map((event) => {
                  const parts = event.name.split(/\s+(?:vs?\.?|VS\.?)\s+/);
                  // TM names are "Home vs Away" (home team listed first, since the event is at their venue)
                  const home = parts[0];
                  const away = parts.length > 1 ? parts.slice(1).join(" vs ") : null;
                  const isSelected = selectedVenue === event.venue;
                  const airports = event.nearbyAirports ?? [];
                  const trains = event.nearbyTrainStations ?? [];
                  const buses = event.nearbyBusStations ?? [];
                  const kalshiUrl = event.odds
                    ? `https://kalshi.com/markets/KXNBAGAME/${event.odds.kalshi_event}`
                    : null;

                  return (
                    <tr
                      key={event.id}
                      className={`border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors ${
                        isSelected ? "bg-blue-50" : ""
                      }`}
                      onClick={() => {
                        if (event.lat != null && event.lng != null) {
                          const vLat = event.lat!;
                          const vLng = event.lng!;
                          // Enrich all transport for this venue
                          for (const s of [...airports, ...trains, ...buses]) {
                            handleEnrich(vLat, vLng, s);
                          }
                          // Build venue info from this event row
                          const venueGames = games.filter(
                            (g) => g.venue === event.venue
                          );
                          onVenueClick({
                            venue: event.venue,
                            city: event.city,
                            state: event.state,
                            lat: vLat,
                            lng: vLng,
                            games: venueGames.map((g) => ({
                              id: g.id,
                              name: g.name,
                              url: g.url,
                              est_time: g.est_time,
                              min_price: g.min_price,
                              odds: g.odds,
                              away_record: g.away_record,
                              home_record: g.home_record,
                            })),
                            airports: event.nearbyAirports ?? [],
                            trains: event.nearbyTrainStations ?? [],
                            buses: event.nearbyBusStations ?? [],
                          });
                        }
                      }}
                    >
                      <td className="py-2 px-2 text-xs font-mono">
                        {event.odds ? (
                          <>
                            <div className={event.odds.away_win > event.odds.home_win ? "text-emerald-600" : "text-gray-500"}>
                              A {event.odds.away_win}%
                            </div>
                            <div className={event.odds.home_win > event.odds.away_win ? "text-emerald-600" : "text-gray-500"}>
                              H {event.odds.home_win}%
                            </div>
                            <div className={Math.abs(event.odds.away_win - event.odds.home_win) <= 10 ? "text-amber-600 font-semibold" : "text-gray-400"}>
                              ±{Math.abs(event.odds.away_win - event.odds.home_win)}%
                            </div>
                          </>
                        ) : (
                          <span className="text-gray-300">--</span>
                        )}
                      </td>
                      <td className="py-2 px-2 text-xs" onClick={(e) => e.stopPropagation()}>
                        {event.espn_price ? (
                          <div className="flex flex-col gap-0.5">
                            {event.espn_price.url ? (
                              <a href={event.espn_price.url} target="_blank" rel="noopener noreferrer" className="text-emerald-600 font-semibold hover:underline">
                                ${event.espn_price.amount}
                              </a>
                            ) : (
                              <span className="text-emerald-600 font-semibold">${event.espn_price.amount}</span>
                            )}
                            <span className="text-[10px] text-gray-400">{event.espn_price.available.toLocaleString()} avail</span>
                          </div>
                        ) : event.min_price ? (
                          <span className="text-gray-500">${event.min_price.amount}</span>
                        ) : (
                          <span className="text-gray-300">--</span>
                        )}
                      </td>
                      <td className="py-2 px-2">
                        {away ? (
                          <>
                            <div>{away}{event.away_record && <span className="text-gray-400 text-xs ml-1">[{event.away_record}]</span>}</div>
                            <div className="text-gray-500">@ {home}{event.home_record && <span className="text-gray-400 text-xs ml-1">[{event.home_record}]</span>}</div>
                          </>
                        ) : (
                          event.name
                        )}
                      </td>
                      <td className="py-2 px-2 text-gray-500">
                        <span className="flex items-center gap-1">
                          <Clock className="size-3" />
                          {formatTimeEST(event.est_time)}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-gray-500">
                        <span className="flex items-center gap-1">
                          <MapPin className="size-3" />
                          {event.venue}
                          {distanceMap[event.id] != null && (
                            <span className="text-[10px] text-gray-400">
                              ({Math.round(distanceMap[event.id])} mi)
                            </span>
                          )}
                        </span>
                        <span className="text-[10px] text-gray-400">
                          {event.city}, {event.state}
                        </span>
                      </td>
                      <td className="py-2 px-2">
                        {airports.length > 0 ? (
                          <div className="flex flex-col gap-0.5 text-xs text-gray-500">
                            {airports.map((apt) => {
                              const vLat = event.lat!, vLng = event.lng!;
                              const ek = event.lat != null && event.lng != null ? enrichKey(vLat, vLng, apt.lat, apt.lng) : null;
                              const times = ek ? enriched[ek] : null;
                              const loading = ek ? enriching.has(ek) : false;
                              const baseFocus =
                                event.lat != null && event.lng != null
                                  ? { venueLat: vLat, venueLng: vLng, airportLat: apt.lat, airportLng: apt.lng, airportCode: apt.code, venueName: event.venue }
                                  : null;
                              return (
                                <div key={apt.code} className="flex items-center gap-1 flex-wrap hover:text-gray-800" onClick={(e) => e.stopPropagation()}>
                                  <Plane className="size-3" />
                                  <a
                                    href={`https://frontier-flight-search.vercel.app/?to=${apt.code}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-mono font-semibold hover:underline"
                                    onMouseEnter={() => !isAnimating && baseFocus && onRouteFocus({ ...baseFocus, pinOnly: true })}
                                    onMouseLeave={() => !isAnimating && onRouteFocus(null)}
                                  >
                                    {apt.code}
                                  </a>
                                  {times ? (
                                    <span
                                      className="flex items-center gap-1"
                                      onMouseEnter={() => !isAnimating && baseFocus && onRouteFocus(baseFocus)}
                                      onMouseLeave={() => !isAnimating && onRouteFocus(null)}
                                    >
                                      <a href={gmapsUrl(vLat, vLng, apt.lat, apt.lng, "driving")} target="_blank" rel="noopener noreferrer" className="flex items-center gap-0.5 hover:underline">
                                        <Car className="size-2.5" />
                                        {formatDriveTime(times.driveMinutes)}
                                      </a>
                                      {times.uberEstimate && (
                                        <a href={uberDeepLink(vLat, vLng, apt.lat, apt.lng)} target="_blank" rel="noopener noreferrer" className="text-[10px] text-gray-500 hover:underline">
                                          Uber {times.uberEstimate}
                                        </a>
                                      )}
                                      {times.lyftEstimate && (
                                        <a href={lyftDeepLink(vLat, vLng, apt.lat, apt.lng)} target="_blank" rel="noopener noreferrer" className="text-[10px] text-pink-500 hover:underline">
                                          Lyft {times.lyftEstimate}
                                        </a>
                                      )}
                                      {times.transitMinutes != null && (
                                        <a href={gmapsUrl(vLat, vLng, apt.lat, apt.lng, "transit")} target="_blank" rel="noopener noreferrer" className="flex items-center gap-0.5 text-blue-500 hover:underline">
                                          <Bus className="size-2.5" />
                                          {formatDriveTime(times.transitMinutes)}
                                          {times.transitFare && <span className="text-emerald-600 ml-0.5">{times.transitFare}</span>}
                                        </a>
                                      )}
                                    </span>
                                  ) : (
                                    <button
                                      className={`flex items-center gap-0.5 text-gray-400 hover:text-gray-600 ${loading ? "animate-spin" : ""}`}
                                      onClick={(e) => { e.stopPropagation(); event.lat != null && event.lng != null && handleEnrich(vLat, vLng, apt); }}
                                      title="Enrich"
                                    >
                                      <RefreshCw className="size-2.5" />
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="text-xs text-gray-300">--</span>
                        )}
                      </td>
                      <td className="py-2 px-2">
                        {trains.length > 0 ? (
                          <div className="flex flex-col gap-0.5 text-xs text-gray-500">
                            {trains.map((stn) => {
                              const vLat = event.lat!, vLng = event.lng!;
                              const ek = event.lat != null && event.lng != null ? enrichKey(vLat, vLng, stn.lat, stn.lng) : null;
                              const times = ek ? enriched[ek] : null;
                              const loading = ek ? enriching.has(ek) : false;
                              const baseFocus =
                                event.lat != null && event.lng != null
                                  ? { venueLat: vLat, venueLng: vLng, airportLat: stn.lat, airportLng: stn.lng, airportCode: stn.code, venueName: event.venue }
                                  : null;
                              return (
                                <div key={stn.code} className="flex items-center gap-1 flex-wrap hover:text-gray-800" onClick={(e) => e.stopPropagation()}>
                                  <TrainFront className="size-3" />
                                  <a
                                    href={`https://www.amtrak.com/stations/${stn.code.toLowerCase()}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-mono font-semibold hover:underline"
                                    onMouseEnter={() => !isAnimating && baseFocus && onRouteFocus({ ...baseFocus, pinOnly: true })}
                                    onMouseLeave={() => !isAnimating && onRouteFocus(null)}
                                  >
                                    {stn.code}
                                  </a>
                                  {times ? (
                                    <span
                                      className="flex items-center gap-1"
                                      onMouseEnter={() => !isAnimating && baseFocus && onRouteFocus(baseFocus)}
                                      onMouseLeave={() => !isAnimating && onRouteFocus(null)}
                                    >
                                      <a href={gmapsUrl(vLat, vLng, stn.lat, stn.lng, "driving")} target="_blank" rel="noopener noreferrer" className="flex items-center gap-0.5 hover:underline">
                                        <Car className="size-2.5" />
                                        {formatDriveTime(times.driveMinutes)}
                                      </a>
                                      {times.uberEstimate && (
                                        <a href={uberDeepLink(vLat, vLng, stn.lat, stn.lng)} target="_blank" rel="noopener noreferrer" className="text-[10px] text-gray-500 hover:underline">
                                          Uber {times.uberEstimate}
                                        </a>
                                      )}
                                      {times.lyftEstimate && (
                                        <a href={lyftDeepLink(vLat, vLng, stn.lat, stn.lng)} target="_blank" rel="noopener noreferrer" className="text-[10px] text-pink-500 hover:underline">
                                          Lyft {times.lyftEstimate}
                                        </a>
                                      )}
                                      {times.transitMinutes != null && (
                                        <a href={gmapsUrl(vLat, vLng, stn.lat, stn.lng, "transit")} target="_blank" rel="noopener noreferrer" className="flex items-center gap-0.5 text-blue-500 hover:underline">
                                          <Bus className="size-2.5" />
                                          {formatDriveTime(times.transitMinutes)}
                                          {times.transitFare && <span className="text-emerald-600 ml-0.5">{times.transitFare}</span>}
                                        </a>
                                      )}
                                    </span>
                                  ) : (
                                    <button
                                      className={`flex items-center gap-0.5 text-gray-400 hover:text-gray-600 ${loading ? "animate-spin" : ""}`}
                                      onClick={(e) => { e.stopPropagation(); event.lat != null && event.lng != null && handleEnrich(vLat, vLng, stn); }}
                                      title="Enrich"
                                    >
                                      <RefreshCw className="size-2.5" />
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="text-xs text-gray-300">--</span>
                        )}
                      </td>
                      <td className="py-2 px-2">
                        {buses.length > 0 ? (
                          <div className="flex flex-col gap-0.5 text-xs text-gray-500">
                            {buses.map((bus) => {
                              const vLat = event.lat!, vLng = event.lng!;
                              const ek = event.lat != null && event.lng != null ? enrichKey(vLat, vLng, bus.lat, bus.lng) : null;
                              const times = ek ? enriched[ek] : null;
                              const loading = ek ? enriching.has(ek) : false;
                              const baseFocus =
                                event.lat != null && event.lng != null
                                  ? { venueLat: vLat, venueLng: vLng, airportLat: bus.lat, airportLng: bus.lng, airportCode: bus.code, venueName: event.venue }
                                  : null;
                              return (
                                <div key={bus.code} className="flex items-center gap-1 flex-wrap hover:text-gray-800" onClick={(e) => e.stopPropagation()}>
                                  <BusFront className="size-3" />
                                  <span
                                    className="font-mono font-semibold cursor-default"
                                    onMouseEnter={() => !isAnimating && baseFocus && onRouteFocus({ ...baseFocus, pinOnly: true })}
                                    onMouseLeave={() => !isAnimating && onRouteFocus(null)}
                                  >
                                    {bus.code}
                                  </span>
                                  {times ? (
                                    <span
                                      className="flex items-center gap-1"
                                      onMouseEnter={() => !isAnimating && baseFocus && onRouteFocus(baseFocus)}
                                      onMouseLeave={() => !isAnimating && onRouteFocus(null)}
                                    >
                                      <a href={gmapsUrl(vLat, vLng, bus.lat, bus.lng, "driving")} target="_blank" rel="noopener noreferrer" className="flex items-center gap-0.5 hover:underline">
                                        <Car className="size-2.5" />
                                        {formatDriveTime(times.driveMinutes)}
                                      </a>
                                      {times.uberEstimate && (
                                        <a href={uberDeepLink(vLat, vLng, bus.lat, bus.lng)} target="_blank" rel="noopener noreferrer" className="text-[10px] text-gray-500 hover:underline">
                                          Uber {times.uberEstimate}
                                        </a>
                                      )}
                                      {times.lyftEstimate && (
                                        <a href={lyftDeepLink(vLat, vLng, bus.lat, bus.lng)} target="_blank" rel="noopener noreferrer" className="text-[10px] text-pink-500 hover:underline">
                                          Lyft {times.lyftEstimate}
                                        </a>
                                      )}
                                      {times.transitMinutes != null && (
                                        <a href={gmapsUrl(vLat, vLng, bus.lat, bus.lng, "transit")} target="_blank" rel="noopener noreferrer" className="flex items-center gap-0.5 text-blue-500 hover:underline">
                                          <Bus className="size-2.5" />
                                          {formatDriveTime(times.transitMinutes)}
                                          {times.transitFare && <span className="text-emerald-600 ml-0.5">{times.transitFare}</span>}
                                        </a>
                                      )}
                                    </span>
                                  ) : (
                                    <button
                                      className={`flex items-center gap-0.5 text-gray-400 hover:text-gray-600 ${loading ? "animate-spin" : ""}`}
                                      onClick={(e) => { e.stopPropagation(); event.lat != null && event.lng != null && handleEnrich(vLat, vLng, bus); }}
                                      title="Enrich"
                                    >
                                      <RefreshCw className="size-2.5" />
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="text-xs text-gray-300">--</span>
                        )}
                      </td>
                      <td className="py-2 px-2">
                        <div className="flex flex-col gap-0.5 text-xs">
                          <a
                            href={event.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-0.5 text-gray-500 hover:text-gray-800"
                            onClick={(e) => e.stopPropagation()}
                          >
                            Ticketmaster
                            <ArrowUpRight className="size-3" />
                          </a>
                          {away && (
                            <a
                              href={stubhubUrl(home)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-0.5 text-gray-500 hover:text-gray-800"
                              onClick={(e) => e.stopPropagation()}
                            >
                              StubHub
                              <ArrowUpRight className="size-3" />
                            </a>
                          )}
                          {event.espn_price?.url && (
                            <a
                              href={event.espn_price.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-0.5 text-gray-500 hover:text-gray-800"
                              onClick={(e) => e.stopPropagation()}
                            >
                              VividSeats
                              <ArrowUpRight className="size-3" />
                            </a>
                          )}
                          {kalshiUrl && (
                            <a
                              href={kalshiUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-0.5 text-gray-500 hover:text-gray-800"
                              onClick={(e) => e.stopPropagation()}
                            >
                              Kalshi
                              <ArrowUpRight className="size-3" />
                            </a>
                          )}
                          <a
                            href={`https://www.espn.com/nba/scoreboard/_/date/${date.replace(/-/g, "")}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-0.5 text-gray-500 hover:text-gray-800"
                            onClick={(e) => e.stopPropagation()}
                          >
                            ESPN
                            <ArrowUpRight className="size-3" />
                          </a>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
