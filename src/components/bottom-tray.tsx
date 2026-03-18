"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
}: {
  games: GameEvent[];
  date: string;
  selectedVenue: string | null;
  onVenueClick: (venue: VenueInfo) => void;
  onRouteFocus: (focus: RouteFocus | null) => void;
  trayState: TrayState;
  onTrayStateChange: (state: TrayState) => void;
}) {
  const dragStartY = useRef(0);
  const isDragging = useRef(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const prevTrayState = useRef(trayState);

  // Enriched travel times: key = "venueLat,venueLng;stationLat,stationLng"
  const [enriched, setEnriched] = useState<Record<string, { driveMinutes: number; transitMinutes: number | null }>>({});
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
                  <th className="text-left py-2 px-2 font-medium">Odds</th>
                  <th className="text-left py-2 px-2 font-medium">Game</th>
                  <th className="text-left py-2 px-2 font-medium">Time</th>
                  <th className="text-left py-2 px-2 font-medium">Venue</th>
                  <th className="text-left py-2 px-2 font-medium">Airports</th>
                  <th className="text-left py-2 px-2 font-medium">Trains</th>
                  <th className="text-left py-2 px-2 font-medium">Buses</th>
                  <th className="text-left py-2 px-2 font-medium">Links</th>
                </tr>
              </thead>
              <tbody>
                {games.map((event) => {
                  const parts = event.name.split(/\s+(?:vs?\.?|VS\.?)\s+/);
                  const away = parts[0];
                  const home = parts.length > 1 ? parts.slice(1).join(" vs ") : null;
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
                          // Build venue info from this event row
                          const venueGames = games.filter(
                            (g) => g.venue === event.venue
                          );
                          onVenueClick({
                            venue: event.venue,
                            city: event.city,
                            state: event.state,
                            lat: event.lat!,
                            lng: event.lng!,
                            games: venueGames.map((g) => ({
                              id: g.id,
                              name: g.name,
                              url: g.url,
                              est_time: g.est_time,
                              min_price: g.min_price,
                              odds: g.odds,
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
                            <div className={event.odds.home_win > event.odds.away_win ? "text-emerald-600" : "text-gray-500"}>
                              H {event.odds.home_win}%
                            </div>
                            <div className={event.odds.away_win > event.odds.home_win ? "text-emerald-600" : "text-gray-500"}>
                              A {event.odds.away_win}%
                            </div>
                          </>
                        ) : (
                          <span className="text-gray-300">--</span>
                        )}
                      </td>
                      <td className="py-2 px-2">
                        {home ? (
                          <>
                            <div>{away}</div>
                            <div className="text-gray-500">@ {home}</div>
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
                                <div key={apt.code} className="flex items-center gap-1 hover:text-gray-800" onClick={(e) => e.stopPropagation()}>
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
                                      className="flex items-center gap-1 cursor-default"
                                      onMouseEnter={() => !isAnimating && baseFocus && onRouteFocus(baseFocus)}
                                      onMouseLeave={() => !isAnimating && onRouteFocus(null)}
                                    >
                                      <Car className="size-2.5" />
                                      {formatDriveTime(times.driveMinutes)}
                                      {times.transitMinutes != null && (
                                        <>
                                          <Bus className="size-2.5 text-blue-500" />
                                          <span className="text-blue-500">{formatDriveTime(times.transitMinutes)}</span>
                                        </>
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
                                <div key={stn.code} className="flex items-center gap-1 hover:text-gray-800" onClick={(e) => e.stopPropagation()}>
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
                                      className="flex items-center gap-1 cursor-default"
                                      onMouseEnter={() => !isAnimating && baseFocus && onRouteFocus(baseFocus)}
                                      onMouseLeave={() => !isAnimating && onRouteFocus(null)}
                                    >
                                      <Car className="size-2.5" />
                                      {formatDriveTime(times.driveMinutes)}
                                      {times.transitMinutes != null && (
                                        <>
                                          <Bus className="size-2.5 text-blue-500" />
                                          <span className="text-blue-500">{formatDriveTime(times.transitMinutes)}</span>
                                        </>
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
                                <div key={bus.code} className="flex items-center gap-1 hover:text-gray-800" onClick={(e) => e.stopPropagation()}>
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
                                      className="flex items-center gap-1 cursor-default"
                                      onMouseEnter={() => !isAnimating && baseFocus && onRouteFocus(baseFocus)}
                                      onMouseLeave={() => !isAnimating && onRouteFocus(null)}
                                    >
                                      <Car className="size-2.5" />
                                      {formatDriveTime(times.driveMinutes)}
                                      {times.transitMinutes != null && (
                                        <>
                                          <Bus className="size-2.5 text-blue-500" />
                                          <span className="text-blue-500">{formatDriveTime(times.transitMinutes)}</span>
                                        </>
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
