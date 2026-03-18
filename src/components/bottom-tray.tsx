"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RouteFocus, VenueInfo } from "./game-map";
import {
  ChevronUp,
  ChevronDown,
  Clock,
  MapPin,
  Plane,
  Car,
  Bus,
  TrainFront,
  ExternalLink,
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
  nearbyAirports?: { code: string; name: string; lat: number; lng: number; driveMinutes: number; transitMinutes: number | null }[];
  nearbyTrainStations?: { code: string; name: string; lat: number; lng: number; driveMinutes: number; transitMinutes: number | null }[];
}

function formatTimeEST(time: string | null) {
  if (!time) return "TBD";
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

function formatPrice(price: { amount: number; currency: string } | null) {
  if (!price) return "--";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: price.currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price.amount);
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
          <div className="w-10 h-1 rounded-full bg-white/30 mb-1.5" />
          <div className="flex items-center gap-2 text-xs text-white/60 px-4 w-full">
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
          <div className={`flex-1 overflow-y-auto px-3 pb-3 ${isAnimating ? "pointer-events-none" : ""}`}>
            <table className="w-full text-sm">
              <thead className="sticky top-0 glass">
                <tr className="text-xs text-white/50 border-b border-white/10">
                  <th className="text-left py-2 px-2 font-medium">Game</th>
                  <th className="text-left py-2 px-2 font-medium">Time</th>
                  <th className="text-left py-2 px-2 font-medium">Venue</th>
                  <th className="text-right py-2 px-2 font-medium">Price</th>
                  <th className="text-left py-2 px-2 font-medium">Odds</th>
                  <th className="text-left py-2 px-2 font-medium">Airports</th>
                  <th className="text-left py-2 px-2 font-medium">Trains</th>
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
                  const kalshiUrl = event.odds
                    ? `https://kalshi.com/markets/KXNBAGAME/${event.odds.kalshi_event}`
                    : null;

                  return (
                    <tr
                      key={event.id}
                      className={`border-b border-white/5 hover:bg-white/5 cursor-pointer transition-colors ${
                        isSelected ? "bg-white/10" : ""
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
                          });
                        }
                      }}
                    >
                      <td className="py-2 px-2">
                        <a
                          href={event.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {home ? (
                            <>
                              <div>{away}</div>
                              <div className="text-white/60">@ {home}</div>
                            </>
                          ) : (
                            event.name
                          )}
                        </a>
                      </td>
                      <td className="py-2 px-2 text-white/60">
                        <span className="flex items-center gap-1">
                          <Clock className="size-3" />
                          {formatTimeEST(event.est_time)}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-white/60">
                        <span className="flex items-center gap-1">
                          <MapPin className="size-3" />
                          {event.venue}
                        </span>
                        <span className="text-[10px] text-white/40">
                          {event.city}, {event.state}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-right font-mono text-emerald-400 text-xs">
                        {formatPrice(event.min_price)}
                      </td>
                      <td className="py-2 px-2 text-xs font-mono">
                        {event.odds && kalshiUrl ? (
                          <a
                            href={kalshiUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className={event.odds.home_win > event.odds.away_win ? "text-emerald-400" : "text-white/60"}>
                              H {event.odds.home_win}%
                            </div>
                            <div className={event.odds.away_win > event.odds.home_win ? "text-emerald-400" : "text-white/60"}>
                              A {event.odds.away_win}%
                            </div>
                          </a>
                        ) : (
                          <span className="text-white/30">--</span>
                        )}
                      </td>
                      <td className="py-2 px-2">
                        {airports.length > 0 ? (
                          <div className="flex flex-col gap-0.5 text-xs text-white/60">
                            {airports.map((apt) => {
                              const focus: RouteFocus | null =
                                event.lat != null && event.lng != null
                                  ? {
                                      venueLat: event.lat!,
                                      venueLng: event.lng!,
                                      airportLat: apt.lat,
                                      airportLng: apt.lng,
                                      airportCode: apt.code,
                                      venueName: event.venue,
                                    }
                                  : null;
                              return (
                                <div
                                  key={apt.code}
                                  className="flex items-center gap-1 hover:text-white/90"
                                  onMouseEnter={() =>
                                    !isAnimating && focus && onRouteFocus(focus)
                                  }
                                  onMouseLeave={() =>
                                    !isAnimating && onRouteFocus(null)
                                  }
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <Plane className="size-3" />
                                  <a
                                    href={`https://frontier-flight-search.vercel.app/?to=${apt.code}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-mono font-semibold hover:underline"
                                  >
                                    {apt.code}
                                  </a>
                                  <Car className="size-2.5" />
                                  {formatDriveTime(apt.driveMinutes)}
                                  {apt.transitMinutes != null && (
                                    <>
                                      <Bus className="size-2.5 text-blue-400" />
                                      <span className="text-blue-400">
                                        {formatDriveTime(apt.transitMinutes)}
                                      </span>
                                    </>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="text-xs text-white/30">--</span>
                        )}
                      </td>
                      <td className="py-2 px-2">
                        {trains.length > 0 ? (
                          <div className="flex flex-col gap-0.5 text-xs text-white/60">
                            {trains.map((stn) => {
                              const focus: RouteFocus | null =
                                event.lat != null && event.lng != null
                                  ? {
                                      venueLat: event.lat!,
                                      venueLng: event.lng!,
                                      airportLat: stn.lat,
                                      airportLng: stn.lng,
                                      airportCode: stn.code,
                                      venueName: event.venue,
                                    }
                                  : null;
                              return (
                                <div
                                  key={stn.code}
                                  className="flex items-center gap-1 hover:text-white/90"
                                  onMouseEnter={() =>
                                    !isAnimating && focus && onRouteFocus(focus)
                                  }
                                  onMouseLeave={() =>
                                    !isAnimating && onRouteFocus(null)
                                  }
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <TrainFront className="size-3" />
                                  <a
                                    href={`https://www.amtrak.com/stations/${stn.code.toLowerCase()}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-mono font-semibold hover:underline"
                                  >
                                    {stn.code}
                                  </a>
                                  <Car className="size-2.5" />
                                  {formatDriveTime(stn.driveMinutes)}
                                  {stn.transitMinutes != null && (
                                    <>
                                      <Bus className="size-2.5 text-blue-400" />
                                      <span className="text-blue-400">
                                        {formatDriveTime(stn.transitMinutes)}
                                      </span>
                                    </>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="text-xs text-white/30">--</span>
                        )}
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
