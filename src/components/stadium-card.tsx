"use client";

import type { VenueInfo } from "./game-map";
import type { RouteFocus } from "./game-map";
import {
  X,
  Clock,
  Plane,
  Car,
  Bus,
  TrainFront,
  ExternalLink,
} from "lucide-react";

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

function formatPrice(price: { amount: number; currency: string } | null) {
  if (!price) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: price.currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price.amount);
}

export function StadiumCard({
  venue,
  onClose,
  onRouteFocus,
  trayExpanded,
}: {
  venue: VenueInfo | null;
  onClose: () => void;
  onRouteFocus: (focus: RouteFocus | null) => void;
  trayExpanded: boolean;
}) {
  if (!venue || trayExpanded) return null;

  return (
    <div className="fixed bottom-16 left-4 right-4 z-[15] flex justify-center pointer-events-none">
      <div className="glass rounded-2xl p-4 max-w-lg w-full pointer-events-auto slide-up">
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="font-semibold text-base">{venue.venue}</h3>
            <p className="text-xs text-white/50">
              {venue.city}, {venue.state}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-white/10 transition-colors -mt-1 -mr-1"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Games */}
        <div className="space-y-2.5">
          {venue.games.map((game) => {
            const parts = game.name.split(/\s+(?:vs?\.?|VS\.?)\s+/);
            const away = parts[0];
            const home = parts.length > 1 ? parts.slice(1).join(" vs ") : null;
            const price = formatPrice(game.min_price);
            const kalshiUrl = game.odds
              ? `https://kalshi.com/markets/KXNBAGAME/${game.odds.kalshi_event}`
              : null;

            return (
              <div key={game.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">
                    {home ? `${away} @ ${home}` : game.name}
                  </p>
                  <div className="flex items-center gap-2 text-xs text-white/50">
                    <Clock className="size-3" />
                    {formatTimeEST(game.est_time)}
                    {price && (
                      <span className="text-emerald-400 font-mono">
                        {price}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {game.odds && kalshiUrl && (
                    <a
                      href={kalshiUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-mono text-emerald-400 hover:underline"
                    >
                      {game.odds.home_win}%-{game.odds.away_win}%
                    </a>
                  )}
                  <a
                    href={game.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-blue-400 hover:underline"
                  >
                    Tickets <ExternalLink className="size-3" />
                  </a>
                </div>
              </div>
            );
          })}
        </div>

        {/* Transport */}
        {(venue.airports.length > 0 || venue.trains.length > 0) && (
          <>
            <div className="h-px bg-white/10 my-3" />
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
              {venue.airports.map((apt) => {
                const focus: RouteFocus = {
                  venueLat: venue.lat,
                  venueLng: venue.lng,
                  airportLat: apt.lat,
                  airportLng: apt.lng,
                  airportCode: apt.code,
                  venueName: venue.venue,
                };
                return (
                  <div
                    key={apt.code}
                    className="flex items-center gap-1 text-white/60 cursor-pointer hover:text-white/90"
                    onMouseEnter={() => onRouteFocus(focus)}
                    onMouseLeave={() => onRouteFocus(null)}
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
                    <Car className="size-3 ml-0.5" />
                    {formatDriveTime(apt.driveMinutes)}
                    {apt.transitMinutes != null && (
                      <>
                        <Bus className="size-3 ml-0.5 text-blue-400" />
                        <span className="text-blue-400">
                          {formatDriveTime(apt.transitMinutes)}
                        </span>
                      </>
                    )}
                  </div>
                );
              })}
              {venue.trains.map((stn) => {
                const focus: RouteFocus = {
                  venueLat: venue.lat,
                  venueLng: venue.lng,
                  airportLat: stn.lat,
                  airportLng: stn.lng,
                  airportCode: stn.code,
                  venueName: venue.venue,
                };
                return (
                  <div
                    key={stn.code}
                    className="flex items-center gap-1 text-white/60 cursor-pointer hover:text-white/90"
                    onMouseEnter={() => onRouteFocus(focus)}
                    onMouseLeave={() => onRouteFocus(null)}
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
                    <Car className="size-3 ml-0.5" />
                    {formatDriveTime(stn.driveMinutes)}
                    {stn.transitMinutes != null && (
                      <>
                        <Bus className="size-3 ml-0.5 text-blue-400" />
                        <span className="text-blue-400">
                          {formatDriveTime(stn.transitMinutes)}
                        </span>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
