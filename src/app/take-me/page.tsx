"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Plane,
  TrainFront,
  BusFront,
  Car,
  Clock,
  MapPin,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  ArrowLeft,
  Navigation,
  Loader2,
} from "lucide-react";
import Link from "next/link";

// ── Types ──────────────────────────────────────────────────────────────────

interface Leg {
  mode: "bus" | "train" | "flight" | "drive" | "rideshare" | "walk";
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
  cost: number;
  bookingUrl?: string;
  miles: number;
}

interface Itinerary {
  id: string;
  totalMinutes: number;
  totalCost: number;
  departureTime: string;
  arrivalTime: string;
  bufferMinutes: number;
  legs: Leg[];
}

type Preference = "balanced" | "cheapest" | "fastest" | "prefer_bus" | "prefer_train" | "prefer_plane";

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDuration(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

function modeIcon(mode: string) {
  switch (mode) {
    case "flight": return <Plane className="size-4" />;
    case "train": return <TrainFront className="size-4" />;
    case "bus": return <BusFront className="size-4" />;
    case "drive": return <Car className="size-4" />;
    case "rideshare": return <Car className="size-4" />;
    default: return <Navigation className="size-4" />;
  }
}

function modeColor(mode: string): string {
  switch (mode) {
    case "bus": return "text-emerald-600";
    case "train": return "text-blue-600";
    case "flight": return "text-violet-600";
    case "drive": return "text-gray-600";
    case "rideshare": return "text-gray-600";
    default: return "text-gray-500";
  }
}

function modeBgColor(mode: string): string {
  switch (mode) {
    case "bus": return "bg-emerald-50 text-emerald-700";
    case "train": return "bg-blue-50 text-blue-700";
    case "flight": return "bg-violet-50 text-violet-700";
    case "drive": return "bg-gray-100 text-gray-700";
    case "rideshare": return "bg-gray-100 text-gray-700";
    default: return "bg-gray-50 text-gray-600";
  }
}

function modeLabel(mode: string): string {
  switch (mode) {
    case "bus": return "Bus";
    case "train": return "Train";
    case "flight": return "Flight";
    case "drive": return "Drive";
    case "rideshare": return "Drive";
    case "walk": return "Walk";
    default: return mode;
  }
}

function uberUrl(fromLat: number, fromLng: number, toLat: number, toLng: number): string {
  return `https://m.uber.com/ul/?action=setPickup&pickup[latitude]=${fromLat}&pickup[longitude]=${fromLng}&dropoff[latitude]=${toLat}&dropoff[longitude]=${toLng}`;
}

function lyftUrl(fromLat: number, fromLng: number, toLat: number, toLng: number): string {
  return `https://lyft.com/ride?start[latitude]=${fromLat}&start[longitude]=${fromLng}&destination[latitude]=${toLat}&destination[longitude]=${toLng}`;
}

// ── Component ──────────────────────────────────────────────────────────────

export default function TakeMePageWrapper() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
        <Loader2 className="size-8 animate-spin text-gray-400" />
      </div>
    }>
      <TakeMePage />
    </Suspense>
  );
}

function TakeMePage() {
  const searchParams = useSearchParams();

  const originLat = searchParams.get("originLat") ?? "";
  const originLng = searchParams.get("originLng") ?? "";
  const venue = searchParams.get("venue") ?? "";
  const venueLat = searchParams.get("venueLat") ?? "";
  const venueLng = searchParams.get("venueLng") ?? "";
  const date = searchParams.get("date") ?? "";
  const time = searchParams.get("time") ?? "";
  const game = searchParams.get("game") ?? "";

  const [preference, setPreference] = useState<Preference>("balanced");
  const [maxTransfers, setMaxTransfers] = useState(1);
  const [itineraries, setItineraries] = useState<Itinerary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchItineraries = useCallback(async () => {
    if (!originLat || !originLng || !venue || !date || !time) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        originLat, originLng, venue, venueLat, venueLng, date, time,
        preference, maxTransfers: String(maxTransfers),
      });
      const res = await fetch(`/api/take-me?${params}`);
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const data = await res.json();
      setItineraries(data.itineraries ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load itineraries");
    } finally {
      setLoading(false);
    }
  }, [originLat, originLng, venue, venueLat, venueLng, date, time, preference, maxTransfers]);

  useEffect(() => { fetchItineraries(); }, [fetchItineraries]);

  const gameDisplay = game || `${venue}`;
  const dateDisplay = date ? new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "";
  const timeDisplay = time ? (() => {
    const [h, m] = time.split(":").map(Number);
    const p = h >= 12 ? "PM" : "AM";
    return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${p}`;
  })() : "";

  const prefs: { value: Preference; label: string }[] = [
    { value: "balanced", label: "Balanced" },
    { value: "cheapest", label: "Cheapest" },
    { value: "fastest", label: "Fastest" },
    { value: "prefer_bus", label: "Prefer Bus" },
    { value: "prefer_train", label: "Prefer Train" },
    { value: "prefer_plane", label: "Prefer Plane" },
  ];

  const transferOpts = [
    { value: 0, label: "Direct" },
    { value: 1, label: "1 Stop" },
    { value: 2, label: "2 Stops" },
  ];

  // Compute unique modes for each itinerary (merge drive/rideshare, exclude walk)
  const getMainModes = (it: Itinerary) =>
    [...new Set(it.legs.filter((l) => l.mode !== "walk").map((l) => l.mode === "rideshare" ? "drive" : l.mode))];

  const getTransferCount = (it: Itinerary) =>
    Math.max(0, it.legs.filter((l) => l.mode !== "rideshare" && l.mode !== "walk").length - 1);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      {/* Header */}
      <header className="glass sticky top-0 z-10 px-4 py-3 border-b border-gray-200">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center gap-3 mb-2">
            <Link href="/" className="text-gray-400 hover:text-gray-600 transition-colors">
              <ArrowLeft className="size-5" />
            </Link>
            <div className="flex-1 min-w-0">
              <h1 className="text-base font-semibold text-gray-900 truncate">{gameDisplay}</h1>
              <p className="text-xs text-gray-500">
                {dateDisplay} {timeDisplay && `· ${timeDisplay} EST`} {venue && `· ${venue}`}
              </p>
            </div>
          </div>

          {/* Controls */}
          <div className="flex flex-wrap gap-2 items-center">
            <div className="flex flex-wrap gap-1">
              {prefs.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setPreference(p.value)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                    preference === p.value
                      ? "bg-gray-900 text-white"
                      : "bg-white text-gray-600 hover:bg-gray-100 border border-gray-200"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="w-px h-5 bg-gray-300" />
            <div className="flex gap-1">
              {transferOpts.map((t) => (
                <button
                  key={t.value}
                  onClick={() => setMaxTransfers(t.value)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                    maxTransfers === t.value
                      ? "bg-gray-900 text-white"
                      : "bg-white text-gray-600 hover:bg-gray-100 border border-gray-200"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      {/* Results */}
      <main className="max-w-3xl mx-auto px-4 py-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <Loader2 className="size-8 animate-spin mb-3" />
            <p className="text-sm">Finding routes...</p>
            <p className="text-xs mt-1">First load may take a moment while transit data loads</p>
          </div>
        ) : error ? (
          <div className="text-center py-20">
            <p className="text-red-500 text-sm">{error}</p>
            <button onClick={fetchItineraries} className="mt-3 text-xs text-gray-500 hover:text-gray-700 underline">
              Retry
            </button>
          </div>
        ) : itineraries.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <Navigation className="size-8 mx-auto mb-3" />
            <p className="text-sm">No routes found</p>
            <p className="text-xs mt-1">Try increasing max transfers or adjusting your preferences</p>
          </div>
        ) : (
          <div className="space-y-3">
            {itineraries.map((it) => {
              const isExpanded = expandedId === it.id;
              const mainModes = getMainModes(it);
              const transferCount = getTransferCount(it);

              return (
                <div
                  key={it.id}
                  className="bg-white rounded-xl border border-gray-200 overflow-hidden hover:border-gray-300 transition-colors"
                >
                  {/* Collapsed header */}
                  <button
                    className="w-full px-4 py-3 text-left"
                    onClick={() => setExpandedId(isExpanded ? null : it.id)}
                  >
                    <div className="flex items-center gap-3">
                      {/* Mode icons */}
                      <div className="flex items-center gap-1">
                        {mainModes.map((mode, i) => (
                          <span key={i} className={`${modeColor(mode)}`}>
                            {modeIcon(mode)}
                          </span>
                        ))}
                      </div>

                      {/* Times */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 text-sm font-medium text-gray-900">
                          <span>{formatTime(it.departureTime)}</span>
                          <ArrowRight className="size-3 text-gray-400" />
                          <span>{formatTime(it.arrivalTime)}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                          <span>{formatDuration(it.totalMinutes)}</span>
                          <span>·</span>
                          <span className="text-emerald-600 font-medium">~${it.totalCost}</span>
                          {transferCount > 0 && (
                            <>
                              <span>·</span>
                              <span>{transferCount} transfer{transferCount > 1 ? "s" : ""}</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Mode badges */}
                      <div className="flex gap-1 flex-wrap">
                        {mainModes.map((mode, i) => (
                          <span key={i} className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${modeBgColor(mode)}`}>
                            {modeLabel(mode)}
                          </span>
                        ))}
                      </div>

                      {isExpanded ? <ChevronUp className="size-4 text-gray-400" /> : <ChevronDown className="size-4 text-gray-400" />}
                    </div>
                  </button>

                  {/* Expanded timeline */}
                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-gray-100">
                      <div className="mt-3 space-y-0">
                        {it.legs.map((leg, i) => {
                          const prevLeg = i > 0 ? it.legs[i - 1] : null;
                          const gap = prevLeg ? Math.round((new Date(leg.depart).getTime() - new Date(prevLeg.arrive).getTime()) / 60000) : 0;

                          return (
                            <div key={i}>
                              {/* Transfer gap */}
                              {gap > 5 && (
                                <div className="flex items-center gap-2 py-1.5 pl-6 text-xs text-amber-600">
                                  <Clock className="size-3" />
                                  <span>{formatDuration(gap)} layover at {leg.from}</span>
                                </div>
                              )}

                              {/* Leg */}
                              <div className="flex gap-3 py-2">
                                {/* Timeline line */}
                                <div className="flex flex-col items-center w-5">
                                  <div className={`w-2 h-2 rounded-full ${leg.mode === "rideshare" ? "bg-gray-300" : modeColor(leg.mode).replace("text-", "bg-")}`} />
                                  <div className="flex-1 w-0.5 bg-gray-200" />
                                </div>

                                {/* Leg details */}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className={modeColor(leg.mode)}>{modeIcon(leg.mode)}</span>
                                    <span className="text-sm font-medium text-gray-900">
                                      {leg.carrier || modeLabel(leg.mode)}
                                      {leg.routeName && <span className="text-gray-500 ml-1">{leg.routeName}</span>}
                                    </span>
                                  </div>

                                  <div className="mt-1 text-xs text-gray-500 space-y-0.5">
                                    <div className="flex items-center gap-1">
                                      <MapPin className="size-3" />
                                      <span>{leg.from}</span>
                                      <span className="text-gray-400">→</span>
                                      <span>{leg.to}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span>{formatTime(leg.depart)} → {formatTime(leg.arrive)}</span>
                                      <span>·</span>
                                      <span>{formatDuration(leg.minutes)}</span>
                                      <span>·</span>
                                      <span className="text-emerald-600">~${leg.cost}</span>
                                      {leg.miles > 0 && (
                                        <>
                                          <span>·</span>
                                          <span>{leg.miles} mi</span>
                                        </>
                                      )}
                                    </div>
                                  </div>

                                  {(leg.mode === "drive" || leg.mode === "rideshare") ? (
                                    <div className="flex gap-1.5 mt-1.5">
                                      <a
                                        href={uberUrl(leg.fromLat, leg.fromLng, leg.toLat, leg.toLng)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-black text-white hover:opacity-80 transition-opacity"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        Uber <ArrowRight className="size-3" />
                                      </a>
                                      <a
                                        href={lyftUrl(leg.fromLat, leg.fromLng, leg.toLat, leg.toLng)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-pink-600 text-white hover:opacity-80 transition-opacity"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        Lyft <ArrowRight className="size-3" />
                                      </a>
                                      {(() => {
                                        const driveLink = leg.bookingUrl || `https://www.google.com/maps/dir/?api=1&origin=${leg.fromLat},${leg.fromLng}&destination=${leg.toLat},${leg.toLng}&travelmode=driving`;
                                        return (
                                        <a
                                          href={driveLink}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700 hover:opacity-80 transition-opacity"
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          Drive <ArrowRight className="size-3" />
                                        </a>
                                        );
                                      })()}
                                    </div>
                                  ) : (
                                    <div className="flex gap-1.5 mt-1.5">
                                      {leg.bookingUrl && (
                                        <a
                                          href={leg.bookingUrl}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${modeBgColor(leg.mode)} hover:opacity-80 transition-opacity`}
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          Book <ArrowRight className="size-3" />
                                        </a>
                                      )}
                                      <a
                                        href={`https://www.google.com/maps/dir/?api=1&origin=${leg.fromLat},${leg.fromLng}&destination=${leg.toLat},${leg.toLng}&travelmode=transit`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 hover:opacity-80 transition-opacity"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        Directions <ArrowRight className="size-3" />
                                      </a>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}

                        {/* Arrival */}
                        <div className="flex gap-3 py-2">
                          <div className="flex flex-col items-center w-5">
                            <div className="w-2 h-2 rounded-full bg-gray-900" />
                          </div>
                          <div className="text-sm font-medium text-gray-900 flex items-center gap-2">
                            <MapPin className="size-4" />
                            Arrive at {venue}
                            <span className="text-xs text-gray-500 font-normal">
                              ({it.bufferMinutes}min before game)
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
