"use client";

import dynamic from "next/dynamic";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Search,
  Calendar,
  MapPin,
  Clock,
  Ticket,
  Trophy,
  Loader2,
} from "lucide-react";

const GameMap = dynamic(
  () => import("@/components/game-map").then((m) => m.GameMap),
  {
    ssr: false,
    loading: () => (
      <div className="h-[300px] w-full animate-pulse rounded-lg border bg-muted" />
    ),
  }
);

interface GameEvent {
  id: string;
  name: string;
  url: string;
  est_date: string;
  est_time: string | null;
  venue: string;
  city: string;
  state: string;
  lat: number | null;
  lng: number | null;
  min_price: { amount: number; currency: string } | null;
  status: string;
  odds: {
    away_team: string;
    home_team: string;
    away_win: number;
    home_win: number;
    kalshi_event: string;
  } | null;
}

interface DateGroup {
  date: string;
  events: GameEvent[];
}

interface EventsResponse {
  total: number;
  date_count: number;
  dates: DateGroup[];
  updated_at: string;
}

function formatDateHeading(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatTimeEST(time: string | null) {
  if (!time) return "TBD";
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period} EST`;
}

function formatPrice(price: { amount: number; currency: string } | null) {
  if (!price) return "N/A";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: price.currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price.amount);
}

function useESTClock() {
  const [now, setNow] = useState("");
  useEffect(() => {
    function update() {
      setNow(
        new Date().toLocaleString("en-US", {
          timeZone: "America/New_York",
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          second: "2-digit",
          hour12: true,
        }) + " EST"
      );
    }
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

const DateCard = memo(function DateCard({ group }: { group: DateGroup }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-3">
          <Calendar className="size-4 text-primary" />
          <span>{formatDateHeading(group.date)}</span>
          <Badge variant="secondary">
            {group.events.length} game
            {group.events.length !== 1 ? "s" : ""}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        <div className="mb-4 px-4">
          <GameMap events={group.events} />
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Game</TableHead>
              <TableHead>Time</TableHead>
              <TableHead>Venue</TableHead>
              <TableHead>Kalshi Odds</TableHead>
              <TableHead className="text-right">Links</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {group.events.map((event) => (
              <TableRow key={event.id}>
                <TableCell className="font-medium">
                  <a
                    href={event.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline"
                  >
                    {event.name}
                  </a>
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Clock className="size-3.5" />
                    {formatTimeEST(event.est_time)}
                  </span>
                </TableCell>
                <TableCell>
                  <a
                    href={event.lat && event.lng ? `https://www.google.com/maps/?q=${event.lat},${event.lng}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${event.venue}, ${event.city}, ${event.state}`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground hover:underline"
                  >
                    <MapPin className="size-3.5 shrink-0" />
                    {event.venue} — {event.city}, {event.state}
                  </a>
                </TableCell>
                <TableCell>
                  {event.odds ? (
                    <a
                      href={`https://kalshi.com/markets/${event.odds.kalshi_event}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block hover:opacity-80"
                    >
                      <div className="flex flex-col gap-0.5 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-mono text-muted-foreground">
                            {event.odds.away_team}
                          </span>
                          <span
                            className={
                              event.odds.away_win > event.odds.home_win
                                ? "font-semibold text-green-500"
                                : "text-muted-foreground"
                            }
                          >
                            {event.odds.away_win}%
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-mono text-muted-foreground">
                            {event.odds.home_team}
                          </span>
                          <span
                            className={
                              event.odds.home_win > event.odds.away_win
                                ? "font-semibold text-green-500"
                                : "text-muted-foreground"
                            }
                          >
                            {event.odds.home_win}%
                          </span>
                        </div>
                      </div>
                    </a>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-2">
                    <a
                      href={event.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Buy on Ticketmaster"
                      className="rounded-md p-1.5 transition-colors hover:bg-muted"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src="/ticketmaster.svg"
                        alt="Ticketmaster"
                        width={24}
                        height={24}
                      />
                    </a>
                    {event.odds ? (
                      <a
                        href={`https://kalshi.com/markets/${event.odds.kalshi_event}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Trade on Kalshi"
                        className="rounded-md p-1.5 transition-colors hover:bg-muted"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src="/kalshi.svg"
                          alt="Kalshi"
                          width={24}
                          height={24}
                        />
                      </a>
                    ) : (
                      <span className="inline-block size-[24px] p-1.5" />
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
});

const DAYS_PER_BATCH = 3;

export default function Home() {
  const [data, setData] = useState<EventsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [visibleDays, setVisibleDays] = useState(DAYS_PER_BATCH);
  const estNow = useESTClock();
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/events")
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json();
          throw new Error(body.error || "Failed to fetch events");
        }
        return res.json();
      })
      .then((d) => setData(d))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(
    () =>
      data?.dates
        .map((group) => ({
          ...group,
          events: group.events.filter((e) => {
            if (!search) return true;
            const q = search.toLowerCase();
            return (
              e.name.toLowerCase().includes(q) ||
              e.venue.toLowerCase().includes(q) ||
              e.city.toLowerCase().includes(q) ||
              e.state.toLowerCase().includes(q)
            );
          }),
        }))
        .filter((group) => group.events.length > 0),
    [data, search]
  );

  const totalFiltered = filtered?.length ?? 0;
  const hasMore = visibleDays < totalFiltered;
  const visible = useMemo(
    () => filtered?.slice(0, visibleDays),
    [filtered, visibleDays]
  );

  // Reset visible count when search changes
  useEffect(() => {
    setVisibleDays(DAYS_PER_BATCH);
  }, [search]);

  // IntersectionObserver to auto-load more days on scroll
  const loadMore = useCallback(() => {
    setVisibleDays((v) => v + DAYS_PER_BATCH);
  }, []);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore();
      },
      { rootMargin: "400px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-baseline justify-between">
            <h1 className="flex items-center gap-2 text-4xl font-bold tracking-tight">
              <Trophy className="size-8 text-primary" />
              Ball Knowledge
            </h1>
            <span className="flex items-center gap-1.5 text-sm font-mono text-muted-foreground">
              <Clock className="size-3.5" />
              {estNow}
            </span>
          </div>
          <p className="mt-2 text-muted-foreground">
            NBA games sorted by date, grouped by game day. All times in EST.
          </p>
          <Separator className="mt-4" />
        </div>

        {/* Search */}
        <div className="relative mb-6 max-w-md">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by team, arena, or city..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Loading skeleton */}
        {loading && (
          <div className="space-y-6">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-6 w-64" />
                </CardHeader>
                <CardContent className="px-0">
                  <Skeleton className="mx-4 mb-4 h-[300px] w-[calc(100%-2rem)] rounded-lg" />
                  {[1, 2, 3, 4].map((j) => (
                    <div key={j} className="flex items-center gap-4 px-4 py-3">
                      <Skeleton className="h-4 w-[40%]" />
                      <Skeleton className="h-4 w-[15%]" />
                      <Skeleton className="h-4 w-[25%]" />
                      <Skeleton className="h-4 w-[10%]" />
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Error */}
        {error && (
          <Card className="border-destructive">
            <CardContent className="pt-6">
              <p className="font-medium text-destructive">Error: {error}</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Make sure your Ticketmaster API key is set in{" "}
                <code className="rounded bg-muted px-1 py-0.5">
                  .env.local
                </code>{" "}
                as{" "}
                <code className="rounded bg-muted px-1 py-0.5">
                  TICKETMASTER_API_KEY
                </code>
              </p>
            </CardContent>
          </Card>
        )}

        {/* Data loaded */}
        {data && (
          <>
            {/* Stats badges */}
            <div className="mb-4 flex items-center gap-3">
              <Badge variant="outline">
                <Ticket className="size-3" />
                {data.total} upcoming games
              </Badge>
              <Badge variant="outline">
                <Calendar className="size-3" />
                {data.date_count} game days
              </Badge>
            </div>

            {/* No results */}
            {filtered && filtered.length === 0 && (
              <div className="flex flex-col items-center py-12 text-muted-foreground">
                <Search className="mb-3 size-8" />
                <p>No matches found for &quot;{search}&quot;</p>
              </div>
            )}

            {/* Game listings */}
            <div className="space-y-6">
              {visible?.map((group) => (
                <DateCard key={group.date} group={group} />
              ))}

              {/* Lazy load sentinel */}
              {hasMore && (
                <div ref={sentinelRef} className="flex justify-center py-6">
                  <Button
                    variant="outline"
                    onClick={loadMore}
                    className="gap-2"
                  >
                    <Loader2 className="size-4 animate-spin" />
                    Loading more days...
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
