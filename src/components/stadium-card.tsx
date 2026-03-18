"use client";

import type { VenueInfo } from "./game-map";
import {
  X,
  Clock,
  Plane,
  TrainFront,
  BusFront,
  ExternalLink,
  Maximize2,
} from "lucide-react";

function formatTimeEST(time: string | null) {
  if (!time) return "TBD";
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

function stubhubUrl(teamName: string): string {
  const slug = teamName.replace(/\s*\(.*?\)/g, "").trim().toLowerCase().replace(/\s+/g, "-");
  return `https://www.stubhub.com/${slug}-tickets`;
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
  onExpand,
  trayExpanded,
}: {
  venue: VenueInfo | null;
  onClose: () => void;
  onExpand: () => void;
  trayExpanded: boolean;
}) {
  if (!venue || trayExpanded) return null;

  return (
    <div className="fixed bottom-16 right-4 z-[15] pointer-events-none">
      <div className="glass rounded-2xl p-4 max-w-lg w-full pointer-events-auto slide-up">
        {/* Header — team matchup as title, venue as subtitle */}
        <div className="flex items-start justify-between mb-3">
          <div className="min-w-0">
            {venue.games.map((game) => {
              const parts = game.name.split(/\s+(?:vs?\.?|VS\.?)\s+/);
              const home = parts[0];
              const away = parts.length > 1 ? parts.slice(1).join(" vs ") : null;
              return (
                <h3 key={game.id} className="font-semibold text-base text-gray-900">
                  {away ? (
                    <>
                      {away}{game.away_record && <span className="text-gray-400 text-xs font-normal ml-1">[{game.away_record}]</span>}
                      {" @ "}
                      {home}{game.home_record && <span className="text-gray-400 text-xs font-normal ml-1">[{game.home_record}]</span>}
                    </>
                  ) : game.name}
                </h3>
              );
            })}
            <p className="text-xs text-gray-400">
              {venue.venue} &middot; {venue.city}, {venue.state}
            </p>
          </div>
          <div className="flex items-center gap-1 -mt-1 -mr-1">
            <button
              onClick={onExpand}
              className="p-1 rounded-lg hover:bg-black/5 transition-colors"
              title="Show details"
            >
              <Maximize2 className="size-4 text-gray-500" />
            </button>
            <button
              onClick={onClose}
              className="p-1 rounded-lg hover:bg-black/5 transition-colors"
            >
              <X className="size-4 text-gray-500" />
            </button>
          </div>
        </div>

        {/* Game details */}
        <div className="space-y-2.5">
          {venue.games.map((game) => {
            const parts = game.name.split(/\s+(?:vs?\.?|VS\.?)\s+/);
            const home = parts[0];
            const away = parts.length > 1 ? parts.slice(1).join(" vs ") : null;
            const price = formatPrice(game.min_price);
            const kalshiUrl = game.odds
              ? `https://kalshi.com/markets/KXNBAGAME/${game.odds.kalshi_event}`
              : null;

            return (
              <div key={game.id} className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <Clock className="size-3" />
                  {formatTimeEST(game.est_time)}
                  {price && (
                    <span className="text-emerald-600 font-mono">
                      {price}
                    </span>
                  )}
                  {game.odds && kalshiUrl && (
                    <a
                      href={kalshiUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-emerald-600 hover:underline"
                    >
                      {game.odds.away_win}%-{game.odds.home_win}%
                    </a>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {away && (
                    <a
                      href={stubhubUrl(home)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-blue-500 hover:underline"
                    >
                      StubHub <ExternalLink className="size-3" />
                    </a>
                  )}
                  <a
                    href="https://www.espn.com/nba/scoreboard"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-blue-500 hover:underline"
                  >
                    ESPN <ExternalLink className="size-3" />
                  </a>
                  <a
                    href={game.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-blue-500 hover:underline"
                  >
                    Tickets <ExternalLink className="size-3" />
                  </a>
                </div>
              </div>
            );
          })}
        </div>

        {/* Transport summary */}
        {(venue.airports.length > 0 || venue.trains.length > 0 || venue.buses.length > 0) && (
          <>
            <div className="h-px bg-gray-200 my-3" />
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-gray-500">
              {venue.airports.length > 0 && (
                <span className="flex items-center gap-1">
                  <Plane className="size-3" />
                  {venue.airports.length === 1 ? (
                    <span className="font-mono font-semibold">{venue.airports[0].code}</span>
                  ) : (
                    <span>{venue.airports.length} nearby</span>
                  )}
                </span>
              )}
              {venue.trains.length > 0 && (
                <span className="flex items-center gap-1">
                  <TrainFront className="size-3" />
                  {venue.trains.length === 1 ? (
                    <span className="font-mono font-semibold">{venue.trains[0].code}</span>
                  ) : (
                    <span>{venue.trains.length} nearby</span>
                  )}
                </span>
              )}
              {venue.buses.length > 0 && (
                <span className="flex items-center gap-1">
                  <BusFront className="size-3" />
                  {venue.buses.length === 1 ? (
                    <span className="font-mono font-semibold">{venue.buses[0].code}</span>
                  ) : (
                    <span>{venue.buses.length} nearby</span>
                  )}
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
