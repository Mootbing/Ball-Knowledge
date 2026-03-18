"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { RouteFocus, VenueInfo } from "@/components/game-map";
import { TopBar } from "@/components/top-bar";
import { StadiumCard } from "@/components/stadium-card";
import { BottomTray } from "@/components/bottom-tray";
import { Loader2 } from "lucide-react";

const GameMap = dynamic(
  () => import("@/components/game-map").then((m) => m.GameMap),
  { ssr: false }
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
  nearbyAirports?: { code: string; name: string; lat: number; lng: number; driveMinutes: number; transitMinutes: number | null }[];
  nearbyTrainStations?: { code: string; name: string; lat: number; lng: number; driveMinutes: number; transitMinutes: number | null }[];
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

function todayEST(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
}

export default function Home() {
  const [data, setData] = useState<EventsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(todayEST());
  const [search, setSearch] = useState("");
  const [selectedVenue, setSelectedVenue] = useState<VenueInfo | null>(null);
  const [routeFocus, setRouteFocus] = useState<RouteFocus | null>(null);
  const [trayState, setTrayState] = useState<"collapsed" | "half">("collapsed");
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [vh, setVh] = useState(800);

  // Track viewport height
  useEffect(() => {
    setVh(window.innerHeight);
    const onResize = () => setVh(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Request geolocation
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {}, // silently ignore denial
      { enableHighAccuracy: false, timeout: 10000 }
    );
  }, []);

  // Fetch data
  useEffect(() => {
    fetch("/api/events")
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json();
          throw new Error(body.error || "Failed to fetch events");
        }
        return res.json();
      })
      .then((d: EventsResponse) => {
        setData(d);
        // Set current date to today if available, else first available date
        const today = todayEST();
        const available = d.dates.map((g) => g.date);
        if (!available.includes(today) && available.length > 0) {
          // Find nearest future date
          const future = available.find((date) => date >= today);
          setCurrentDate(future ?? available[0]);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const availableDates = useMemo(
    () => data?.dates.map((g) => g.date) ?? [],
    [data]
  );

  const gameCountByDate = useMemo(() => {
    const map: Record<string, number> = {};
    data?.dates.forEach((g) => {
      map[g.date] = g.events.length;
    });
    return map;
  }, [data]);

  const todayGames = useMemo(() => {
    const group = data?.dates.find((g) => g.date === currentDate);
    if (!group) return [];
    if (!search) return group.events;
    const q = search.toLowerCase();
    return group.events.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.venue.toLowerCase().includes(q) ||
        e.city.toLowerCase().includes(q) ||
        e.state.toLowerCase().includes(q)
    );
  }, [data, currentDate, search]);

  const handleDateChange = useCallback((date: string) => {
    setCurrentDate(date);
    setSelectedVenue(null);
    setRouteFocus(null);
    setTrayState("collapsed");
  }, []);

  const handleMarkerClick = useCallback((venue: VenueInfo) => {
    setSelectedVenue(venue);
    setRouteFocus(null);
  }, []);

  const handleRouteFocus = useCallback((focus: RouteFocus | null) => {
    setRouteFocus(focus);
  }, []);

  const handleTrayStateChange = useCallback((state: "collapsed" | "half") => {
    setTrayState(state);
  }, []);

  return (
    <main className="relative h-dvh w-dvw overflow-hidden">
      {/* Full-page map */}
      <GameMap
        events={todayGames}
        routeFocus={routeFocus}
        selectedVenue={selectedVenue?.venue ?? null}
        onMarkerClick={handleMarkerClick}
        userLocation={userLocation}
        bottomPadding={trayState === "half" ? Math.round(vh * 0.5) : 52}
      />

      {/* Top bar: search + date selector */}
      {data && (
        <TopBar
          search={search}
          onSearchChange={setSearch}
          currentDate={currentDate}
          availableDates={availableDates}
          onDateChange={handleDateChange}
          gameCount={todayGames.length}
          gameCountByDate={gameCountByDate}
          userLocation={userLocation}
          onLocationChange={setUserLocation}
        />
      )}

      {/* Stadium detail card */}
      <StadiumCard
        venue={selectedVenue}
        onClose={() => setSelectedVenue(null)}
        onExpand={() => setTrayState("half")}
        trayExpanded={trayState === "half"}
      />

      {/* Bottom tray */}
      {data && (
        <BottomTray
          games={todayGames}
          date={currentDate}
          selectedVenue={selectedVenue?.venue ?? null}
          onVenueClick={handleMarkerClick}
          onRouteFocus={handleRouteFocus}
          trayState={trayState}
          onTrayStateChange={handleTrayStateChange}
        />
      )}

      {/* Loading overlay */}
      {loading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/70">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="size-8 animate-spin text-gray-500" />
            <p className="text-sm text-gray-500">Loading games...</p>
          </div>
        </div>
      )}

      {/* Error overlay */}
      {error && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/70">
          <div className="glass rounded-2xl p-6 max-w-md text-center">
            <p className="font-medium text-red-500 mb-2">Error</p>
            <p className="text-sm text-gray-500">{error}</p>
            <p className="text-xs text-gray-400 mt-3">
              Check that TICKETMASTER_API_KEY is set in .env.local
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
