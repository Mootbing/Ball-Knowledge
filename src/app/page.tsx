"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { RouteFocus, VenueInfo } from "@/components/game-map";
import { TopBar } from "@/components/top-bar";
import { BottomTray } from "@/components/bottom-tray";

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
  away_record?: string | null;
  home_record?: string | null;
  espn_price?: { amount: number; available: number; url: string | null } | null;
  nearbyAirports?: { code: string; name: string; lat: number; lng: number; driveMinutes: number; transitMinutes: number | null }[];
  nearbyTrainStations?: { code: string; name: string; lat: number; lng: number; driveMinutes: number; transitMinutes: number | null }[];
}

interface DateGroup {
  date: string;
  events: GameEvent[];
}

interface AirportCoord {
  code: string;
  name: string;
  lat: number;
  lng: number;
}

interface EventsResponse {
  total: number;
  date_count: number;
  dates: DateGroup[];
  allAirports?: AirportCoord[];
  updated_at: string;
}

function todayEST(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
}

const LS_KEY = "balltastic_state";

function loadState(): { date?: string; search?: string; tray?: "collapsed" | "peek" | "expanded"; loc?: { lat: number; lng: number } } {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? "{}");
  } catch { return {}; }
}

function saveState(patch: Record<string, unknown>) {
  try {
    const prev = loadState();
    localStorage.setItem(LS_KEY, JSON.stringify({ ...prev, ...patch }));
  } catch { /* ignore */ }
}

export default function Home() {
  const [data, setData] = useState<EventsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(() => loadState().date ?? todayEST());
  const [search, setSearch] = useState(() => loadState().search ?? "");
  const [selectedVenue, setSelectedVenue] = useState<VenueInfo | null>(null);
  const [routeFocus, setRouteFocus] = useState<RouteFocus | null>(null);
  const [trayState, setTrayState] = useState<"collapsed" | "peek" | "expanded">(() => {
    const saved = loadState().tray;
    // Migrate old "half" to "peek"
    if (saved === "half" as string) return "peek";
    return saved ?? "collapsed";
  });
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(() => loadState().loc ?? null);
  const [vh, setVh] = useState(800);

  // Persist state changes
  useEffect(() => { saveState({ date: currentDate }); }, [currentDate]);
  useEffect(() => { saveState({ search }); }, [search]);
  useEffect(() => { saveState({ tray: trayState }); }, [trayState]);
  useEffect(() => { saveState({ loc: userLocation }); }, [userLocation]);

  // Track viewport height
  useEffect(() => {
    setVh(window.innerHeight);
    const onResize = () => setVh(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Request geolocation only if no saved location
  useEffect(() => {
    if (userLocation) return;
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {},
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
        const today = todayEST();
        const available = d.dates.map((g) => g.date);
        if (!available.includes(today) && available.length > 0) {
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
    setTrayState("peek");
  }, []);

  const handleRouteFocus = useCallback((focus: RouteFocus | null) => {
    setRouteFocus(focus);
  }, []);

  const handleTrayStateChange = useCallback((state: "collapsed" | "peek" | "expanded") => {
    setTrayState(state);
    if (state === "collapsed") {
      setRouteFocus(null);
    }
  }, []);

  const bottomPadding = trayState === "collapsed" ? 56 : trayState === "peek" ? Math.round(vh * 0.35) : Math.round(vh * 0.85);

  return (
    <main className="relative h-dvh w-dvw overflow-hidden">
      {/* Full-page map */}
      <GameMap
        events={todayGames}
        routeFocus={routeFocus}
        selectedVenue={selectedVenue?.venue ?? null}
        onMarkerClick={handleMarkerClick}
        userLocation={userLocation}
        bottomPadding={bottomPadding}
      />

      {/* Top bar: command bar */}
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

      {/* Bottom tray — intel panel */}
      {data && (
        <BottomTray
          games={todayGames}
          date={currentDate}
          selectedVenue={selectedVenue?.venue ?? null}
          onVenueClick={handleMarkerClick}
          onRouteFocus={handleRouteFocus}
          trayState={trayState}
          onTrayStateChange={handleTrayStateChange}
          userLocation={userLocation}
          allAirports={data.allAirports ?? []}
        />
      )}

      {/* Loading overlay — dark */}
      {loading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0a0a0f]/90">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-[--primary]/30 border-t-[--primary] rounded-full animate-spin" />
            <p className="text-sm font-mono text-[--primary] tracking-widest">LOADING INTEL...</p>
          </div>
        </div>
      )}

      {/* Error overlay — dark */}
      {error && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0a0a0f]/90">
          <div className="panel rounded-lg p-6 max-w-md text-center">
            <p className="font-mono font-semibold text-[--color-danger] mb-2 tracking-widest">ERROR</p>
            <p className="text-sm text-[--color-dim]">{error}</p>
            <p className="text-xs text-[--color-dim]/60 mt-3 font-mono">
              Check that TICKETMASTER_API_KEY is set in .env.local
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
