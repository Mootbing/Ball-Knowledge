"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Plane,
  Bus,
  BusFront,
  Car,
  TrainFront,
  Clock,
  MapPin,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  ArrowLeft,
  Navigation,
  Loader2,
  Zap,
  ArrowLeftRight,
} from "lucide-react";
import Link from "next/link";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";
import { FrontierPanel } from "@/components/frontier-panel";

// ── Types ──────────────────────────────────────────────────────────────────

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

interface EnrichResult {
  driveMinutes: number;
  transitMinutes: number | null;
  transitFare: string | null;
  transitDepartureTime: string | null; // ISO from Google Directions
  transitArrivalTime: string | null;   // ISO from Google Directions
  uberEstimate: string | null;
  lyftEstimate: string | null;
}

const BUFFER_MINUTES = 20;

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDuration(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function modeIcon(mode: string) {
  switch (mode) {
    case "flight":
      return <Plane className="size-4" />;
    case "drive":
    case "rideshare":
      return <Car className="size-4" />;
    case "bus":
      return <BusFront className="size-4" />;
    case "train":
      return <TrainFront className="size-4" />;
    case "transit":
      return <Bus className="size-4" />;
    default:
      return <Navigation className="size-4" />;
  }
}

function modeColor(mode: string): string {
  switch (mode) {
    case "flight":
      return "text-[--color-flight]";
    case "drive":
    case "rideshare":
      return "text-[--color-drive]";
    case "bus":
      return "text-[--color-bus]";
    case "train":
      return "text-[--color-train]";
    case "transit":
      return "text-[--color-transit]";
    default:
      return "text-[--color-dim]";
  }
}

function modeBgColor(mode: string): string {
  switch (mode) {
    case "flight":
      return "bg-[--color-flight]/10 text-[--color-flight]";
    case "drive":
    case "rideshare":
      return "bg-[--color-drive]/10 text-[--color-drive]";
    case "bus":
      return "bg-[--color-bus]/10 text-[--color-bus]";
    case "train":
      return "bg-[--color-train]/10 text-[--color-train]";
    case "transit":
      return "bg-[--color-transit]/10 text-[--color-transit]";
    default:
      return "bg-white/5 text-[--color-dim]";
  }
}

function modeBorderColor(mode: string): string {
  switch (mode) {
    case "flight":
      return "border-l-[--color-flight]";
    case "drive":
    case "rideshare":
      return "border-l-[--color-drive]";
    case "bus":
      return "border-l-[--color-bus]";
    case "train":
      return "border-l-[--color-train]";
    case "transit":
      return "border-l-[--color-transit]";
    default:
      return "border-l-[--color-dim]";
  }
}

function modeLabel(mode: string): string {
  switch (mode) {
    case "flight":
      return "FLY";
    case "drive":
      return "DRIVE";
    case "rideshare":
      return "DRIVE";
    case "bus":
      return "BUS";
    case "train":
      return "TRAIN";
    case "transit":
      return "TRANSIT";
    default:
      return mode.toUpperCase();
  }
}

function extractUpperBound(estimate: string): string {
  const parts = estimate.split(/[-–]/);
  const last = parts[parts.length - 1].trim();
  return last.startsWith("$") ? last : `$${last.replace(/[^0-9.]/g, "")}`;
}

function modeMapColor(mode: string): string {
  switch (mode) {
    case "flight":
      return "#a78bfa";
    case "drive":
    case "rideshare":
      return "#e2e8f0";
    case "bus":
      return "#34d399";
    case "train":
      return "#60a5fa";
    case "transit":
      return "#22d3ee";
    default:
      return "#e2e8f0";
  }
}

function uberUrl(
  fromName: string,
  fromLat: number,
  fromLng: number,
  toName: string,
  toLat: number,
  toLng: number
): string {
  const pickup = encodeURIComponent(
    JSON.stringify({
      addressLine1: fromName,
      latitude: fromLat,
      longitude: fromLng,
      source: "SEARCH",
      provider: "uber_places",
    })
  );
  const drop = encodeURIComponent(
    JSON.stringify({
      addressLine1: toName,
      latitude: toLat,
      longitude: toLng,
      source: "SEARCH",
      provider: "uber_places",
    })
  );
  return `https://m.uber.com/go/product-selection?pickup=${pickup}&drop%5B0%5D=${drop}`;
}

function lyftUrl(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number
): string {
  return `https://lyft.com/ride?start[latitude]=${fromLat}&start[longitude]=${fromLng}&destination[latitude]=${toLat}&destination[longitude]=${toLng}`;
}

// ── Component ──────────────────────────────────────────────────────────────

export default function TakeMePageWrapper() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-[--primary]/30 border-t-[--primary] rounded-full animate-spin" />
        </div>
      }
    >
      <TakeMePage />
    </Suspense>
  );
}

function TakeMePage() {
  const searchParams = useSearchParams();

  const initOriginLat = searchParams.get("originLat") ?? "";
  const initOriginLng = searchParams.get("originLng") ?? "";
  const venue = searchParams.get("venue") ?? "";
  const venueLat = searchParams.get("venueLat") ?? "";
  const venueLng = searchParams.get("venueLng") ?? "";
  const date = searchParams.get("date") ?? "";
  const time = searchParams.get("time") ?? "";
  const game = searchParams.get("game") ?? "";

  // Editable origin location
  const [originLat, setOriginLat] = useState(initOriginLat);
  const [originLng, setOriginLng] = useState(initOriginLng);
  const [originInput, setOriginInput] = useState("");
  const [originLoading, setOriginLoading] = useState(false);
  const [originSuggestions, setOriginSuggestions] = useState<
    { placeId: string; main: string; secondary: string }[]
  >([]);
  const [sugIdx, setSugIdx] = useState(-1);
  const originDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autocompleteRef = useRef<google.maps.places.AutocompleteService | null>(null);
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);

  // Map state
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const overlaysRef = useRef<(google.maps.Polyline | google.maps.Marker)[]>([]);
  const directionsServiceRef = useRef<google.maps.DirectionsService | null>(null);

  // Init Google services + reverse-geocode initial coordinates
  useEffect(() => {
    const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
    if (!API_KEY) return;
    setOptions({ key: API_KEY, v: "weekly" });
    Promise.all([importLibrary("places"), importLibrary("maps")]).then(() => {
      autocompleteRef.current = new google.maps.places.AutocompleteService();
      sessionTokenRef.current = new google.maps.places.AutocompleteSessionToken();
      geocoderRef.current = new google.maps.Geocoder();
      directionsServiceRef.current = new google.maps.DirectionsService();
      // Init map
      if (mapContainerRef.current && !mapRef.current) {
        mapRef.current = new google.maps.Map(mapContainerRef.current, {
          center: {
            lat: parseFloat(venueLat) || 39.5,
            lng: parseFloat(venueLng) || -98.35,
          },
          zoom: 5,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: "greedy",
          colorScheme: "DARK",
        });
      }
      // Reverse-geocode initial location
      if (initOriginLat && initOriginLng) {
        geocoderRef.current.geocode(
          { location: { lat: parseFloat(initOriginLat), lng: parseFloat(initOriginLng) } },
          (results, status) => {
            if (status === "OK" && results?.[0]) {
              const city = results[0].address_components?.find((c) =>
                c.types.includes("locality")
              );
              const state = results[0].address_components?.find((c) =>
                c.types.includes("administrative_area_level_1")
              );
              if (city) {
                setOriginInput(
                  state ? `${city.long_name}, ${state.short_name}` : city.long_name
                );
              } else {
                setOriginInput(results[0].formatted_address?.split(",").slice(0, 2).join(",") ?? "");
              }
            }
          }
        );
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchOriginSuggestions = useCallback((input: string) => {
    if (!input.trim() || !autocompleteRef.current) {
      setOriginSuggestions([]);
      return;
    }
    autocompleteRef.current.getPlacePredictions(
      { input, types: ["geocode"], sessionToken: sessionTokenRef.current! },
      (predictions, status) => {
        if (status !== "OK" || !predictions) {
          setOriginSuggestions([]);
          return;
        }
        setOriginSuggestions(
          predictions.slice(0, 5).map((p) => ({
            placeId: p.place_id,
            main: p.structured_formatting.main_text,
            secondary: p.structured_formatting.secondary_text,
          }))
        );
        setSugIdx(-1);
      }
    );
  }, []);

  const selectOriginSuggestion = useCallback(
    (s: { placeId: string; main: string; secondary: string }) => {
      if (!geocoderRef.current) return;
      geocoderRef.current.geocode({ placeId: s.placeId }, (results, status) => {
        if (status === "OK" && results?.[0]?.geometry?.location) {
          const loc = results[0].geometry.location;
          setOriginLat(String(loc.lat()));
          setOriginLng(String(loc.lng()));
          setOriginInput(`${s.main}, ${s.secondary}`);
          setOriginSuggestions([]);
          sessionTokenRef.current = new google.maps.places.AutocompleteSessionToken();
        }
      });
    },
    []
  );

  const geocodeOriginInput = useCallback(() => {
    if (!originInput.trim() || !geocoderRef.current) return;
    setOriginLoading(true);
    geocoderRef.current.geocode({ address: originInput }, (results, status) => {
      if (status === "OK" && results?.[0]?.geometry?.location) {
        const loc = results[0].geometry.location;
        setOriginLat(String(loc.lat()));
        setOriginLng(String(loc.lng()));
        setOriginInput(results[0].formatted_address ?? originInput);
        setOriginSuggestions([]);
      }
      setOriginLoading(false);
    });
  }, [originInput]);

  const [resultLimit, setResultLimit] = useState(10);
  const [itineraries, setItineraries] = useState<Itinerary[]>([]);
  const [googleFlightsUrl, setGoogleFlightsUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [transitPref, setTransitPref] = useState<"all" | "bus" | "train" | "frontier">(
    "all"
  );

  // Enrichment state: itinerary id → leg index → enrichment data
  const [enrichments, setEnrichments] = useState<
    Record<string, Record<number, EnrichResult>>
  >({});
  const [enriching, setEnriching] = useState<Set<string>>(new Set());
  // Track which legs have been swapped to transit
  const [swappedToTransit, setSwappedToTransit] = useState<Set<string>>(
    new Set()
  );
  // Transit sub-mode toggles (Show Train / Show Bus)
  const [shownTransitModes, setShownTransitModes] = useState<Set<string>>(new Set());
  const [transitModeData, setTransitModeData] = useState<
    Record<string, { minutes: number | null; fare: string | null; departureTime: string | null; arrivalTime: string | null }>
  >({});
  const [transitModeLoading, setTransitModeLoading] = useState<Set<string>>(new Set());

  const handleFrontierResults = useCallback((results: Itinerary[]) => {
    setItineraries(results);
    setLoading(false);
  }, []);

  const fetchItineraries = useCallback(async () => {
    if (transitPref === "frontier") { setItineraries([]); setLoading(false); return; }
    if (!originLat || !originLng || !venue || !date || !time) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        originLat,
        originLng,
        venue,
        venueLat,
        venueLng,
        date,
        time,
        limit: String(resultLimit),
        transitPref,
      });
      const res = await fetch(`/api/take-me?${params}`);
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const data = await res.json();
      setItineraries(data.itineraries ?? []);
      setGoogleFlightsUrl(data.googleFlightsUrl ?? null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load itineraries"
      );
    } finally {
      setLoading(false);
    }
  }, [originLat, originLng, venue, venueLat, venueLng, date, time, resultLimit, transitPref]);

  useEffect(() => {
    fetchItineraries();
  }, [fetchItineraries]);

  // Enrich all drive/rideshare legs of an itinerary
  const enrichItinerary = useCallback(
    async (it: Itinerary) => {
      const enrichKey = it.id;
      if (enriching.has(enrichKey)) return;

      const enrichableLegs = it.legs
        .map((l, i) => ({ leg: l, idx: i }))
        .filter(({ leg }) => leg.enrichable);

      if (enrichableLegs.length === 0) return;

      setEnriching((prev) => new Set(prev).add(enrichKey));
      try {
        const res = await fetch("/api/enrich-itinerary", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            legs: enrichableLegs.map(({ leg, idx }) => {
              const nextLeg = idx < it.legs.length - 1 ? it.legs[idx + 1] : null;
              const prevLeg = idx > 0 ? it.legs[idx - 1] : null;
              return {
                fromLat: leg.fromLat,
                fromLng: leg.fromLng,
                toLat: leg.toLat,
                toLng: leg.toLng,
                // Transit should arrive with buffer before next leg departs
                ...(nextLeg ? { arriveBy: new Date(new Date(nextLeg.depart).getTime() - BUFFER_MINUTES * 60000).toISOString() } : {}),
                // Or depart with buffer after previous leg arrives (only if no next leg)
                ...(!nextLeg && prevLeg ? { departAfter: new Date(new Date(prevLeg.arrive).getTime() + BUFFER_MINUTES * 60000).toISOString() } : {}),
              };
            }),
          }),
        });
        if (res.ok) {
          const data = await res.json();
          const legEnrichments: Record<number, EnrichResult> = {};
          enrichableLegs.forEach(({ idx }, i) => {
            if (data.legs[i]) {
              legEnrichments[idx] = data.legs[i];
            }
          });
          setEnrichments((prev) => ({
            ...prev,
            [enrichKey]: legEnrichments,
          }));
        }
      } finally {
        setEnriching((prev) => {
          const next = new Set(prev);
          next.delete(enrichKey);
          return next;
        });
      }
    },
    [enriching]
  );

  // Auto-enrich when card expanded (500ms debounce)
  useEffect(() => {
    if (!expandedId) return;
    const it = itineraries.find((i) => i.id === expandedId);
    if (!it || enrichments[it.id] || enriching.has(it.id)) return;
    if (!it.legs.some((l) => l.enrichable)) return;
    const timer = setTimeout(() => enrichItinerary(it), 500);
    return () => clearTimeout(timer);
  }, [expandedId, itineraries, enrichments, enriching, enrichItinerary]);

  const toggleTransitSwap = useCallback((key: string) => {
    setSwappedToTransit((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleTransitModeView = useCallback((key: string) => {
    setShownTransitModes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const fetchTransitModeData = useCallback(async (
    key: string,
    fromLat: number, fromLng: number,
    toLat: number, toLng: number,
    transitMode: "bus" | "rail",
  ) => {
    setTransitModeLoading((prev) => new Set(prev).add(key));
    try {
      const res = await fetch("/api/transit-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromLat, fromLng, toLat, toLng, transitMode }),
      });
      if (res.ok) {
        const data = await res.json();
        setTransitModeData((prev) => ({ ...prev, [key]: data }));
      }
    } finally {
      setTransitModeLoading((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, []);

  // Draw itinerary legs on map when expanded itinerary changes
  useEffect(() => {
    if (!mapRef.current) return;

    // Clear previous overlays
    overlaysRef.current.forEach((o) => o.setMap(null));
    overlaysRef.current = [];

    if (!expandedId) {
      // Reset to overview
      const vlat = parseFloat(venueLat);
      const vlng = parseFloat(venueLng);
      const olat = parseFloat(originLat);
      const olng = parseFloat(originLng);
      if (vlat && vlng && olat && olng) {
        const bounds = new google.maps.LatLngBounds();
        bounds.extend({ lat: olat, lng: olng });
        bounds.extend({ lat: vlat, lng: vlng });
        mapRef.current.fitBounds(bounds, 60);
      } else if (vlat && vlng) {
        mapRef.current.setCenter({ lat: vlat, lng: vlng });
        mapRef.current.setZoom(5);
      }
      return;
    }

    const it = itineraries.find((i) => i.id === expandedId);
    if (!it || it.legs.length === 0) return;

    const bounds = new google.maps.LatLngBounds();

    for (let li = 0; li < it.legs.length; li++) {
      const leg = it.legs[li];
      const color = modeMapColor(leg.mode);
      const from = { lat: leg.fromLat, lng: leg.fromLng };
      const to = { lat: leg.toLat, lng: leg.toLng };
      bounds.extend(from);
      bounds.extend(to);

      // Draw a subtle glow line underneath for all modes
      const glowLine = new google.maps.Polyline({
        path: [from, to],
        geodesic: leg.mode === "flight",
        strokeColor: color,
        strokeWeight: 10,
        strokeOpacity: 0.15,
        map: mapRef.current,
      });
      overlaysRef.current.push(glowLine);

      if (leg.mode === "drive" || leg.mode === "rideshare") {
        if (directionsServiceRef.current) {
          directionsServiceRef.current.route(
            {
              origin: from,
              destination: to,
              travelMode: google.maps.TravelMode.DRIVING,
            },
            (result, status) => {
              if (status === "OK" && result) {
                const path = result.routes[0]?.overview_path;
                if (path) {
                  // Glow along road
                  const roadGlow = new google.maps.Polyline({
                    path,
                    strokeColor: color,
                    strokeWeight: 10,
                    strokeOpacity: 0.15,
                    map: mapRef.current,
                  });
                  overlaysRef.current.push(roadGlow);
                  const polyline = new google.maps.Polyline({
                    path,
                    strokeColor: color,
                    strokeWeight: 4,
                    strokeOpacity: 0.9,
                    map: mapRef.current,
                  });
                  overlaysRef.current.push(polyline);
                }
              } else {
                const polyline = new google.maps.Polyline({
                  path: [from, to],
                  strokeColor: color,
                  strokeWeight: 4,
                  strokeOpacity: 0.8,
                  map: mapRef.current,
                });
                overlaysRef.current.push(polyline);
              }
            }
          );
        }
      } else if (leg.mode === "flight") {
        const polyline = new google.maps.Polyline({
          path: [from, to],
          geodesic: true,
          strokeColor: color,
          strokeWeight: 3,
          strokeOpacity: 0,
          icons: [
            {
              icon: {
                path: "M 0,-1 0,1",
                strokeOpacity: 0.9,
                strokeColor: color,
                scale: 4,
              },
              offset: "0",
              repeat: "14px",
            },
          ],
          map: mapRef.current,
        });
        overlaysRef.current.push(polyline);
      } else {
        // Bus/train: solid colored polyline
        const polyline = new google.maps.Polyline({
          path: [from, to],
          strokeColor: color,
          strokeWeight: 5,
          strokeOpacity: 0.9,
          map: mapRef.current,
        });
        overlaysRef.current.push(polyline);
      }

      // Add glow ring behind marker
      const glowMarker = new google.maps.Marker({
        position: from,
        map: mapRef.current,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 12,
          fillColor: color,
          fillOpacity: 0.2,
          strokeColor: color,
          strokeWeight: 0,
        },
        title: leg.from,
        zIndex: 9,
      });
      overlaysRef.current.push(glowMarker);

      // Add leg start marker (colored circle)
      const marker = new google.maps.Marker({
        position: from,
        map: mapRef.current,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 7,
          fillColor: color,
          fillOpacity: 1,
          strokeColor: "#0a0a0f",
          strokeWeight: 2.5,
        },
        title: leg.from,
        zIndex: 10,
      });
      overlaysRef.current.push(marker);

      // Add end marker for last leg (same mode color)
      if (li === it.legs.length - 1) {
        const endColor = modeMapColor(leg.mode);
        const endGlow = new google.maps.Marker({
          position: to,
          map: mapRef.current,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 16,
            fillColor: endColor,
            fillOpacity: 0.2,
            strokeColor: endColor,
            strokeWeight: 0,
          },
          title: leg.to,
          zIndex: 10,
        });
        overlaysRef.current.push(endGlow);

        const endMarker = new google.maps.Marker({
          position: to,
          map: mapRef.current,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 9,
            fillColor: endColor,
            fillOpacity: 1,
            strokeColor: "#0a0a0f",
            strokeWeight: 2.5,
          },
          title: leg.to,
          zIndex: 11,
        });
        overlaysRef.current.push(endMarker);
      }
    }

    mapRef.current.fitBounds(bounds, 60);
  }, [expandedId, itineraries, venueLat, venueLng, originLat, originLng]);

  const gameDisplay = game || `${venue}`;
  const dateDisplay = date
    ? new Date(date + "T12:00:00").toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      })
    : "";
  const timeDisplay = time
    ? (() => {
        const [h, m] = time.split(":").map(Number);
        const p = h >= 12 ? "PM" : "AM";
        return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${p}`;
      })()
    : "";

  // Compute unique modes for each itinerary (merge drive/rideshare)
  const getMainModes = (it: Itinerary) => [
    ...new Set(
      it.legs.map((l) => (l.mode === "rideshare" ? "drive" : l.mode))
    ),
  ];

  return (
    <div className="h-screen flex flex-col bg-[#0a0a0f]">
      {/* Header */}
      <header className="panel z-10 px-4 py-3 border-b border-white/5 shrink-0">
        <div className="mx-auto">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-[--color-dim] hover:text-foreground transition-colors"
            >
              <ArrowLeft className="size-5" />
            </Link>
            <div className="flex-1 min-w-0">
              <h1 className="text-base font-semibold text-foreground truncate">
                {gameDisplay}
              </h1>
              <p className="text-xs font-mono text-[--color-dim]">
                {dateDisplay} {timeDisplay && `· ${timeDisplay} EST`}{" "}
                {venue && `· ${venue}`}
              </p>
            </div>
          </div>
          {/* Editable origin */}
          <div className="mt-2 relative">
            <div className="flex items-center gap-2">
              <MapPin className="size-3.5 text-[--color-dim] shrink-0" />
              <span className="text-xs font-mono text-[--color-dim] shrink-0">FROM:</span>
              <form
                className="flex-1 flex items-center gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (sugIdx >= 0 && originSuggestions[sugIdx]) {
                    selectOriginSuggestion(originSuggestions[sugIdx]);
                  } else {
                    geocodeOriginInput();
                  }
                }}
              >
                <input
                  type="text"
                  value={originInput}
                  onChange={(e) => {
                    setOriginInput(e.target.value);
                    if (originDebounce.current) clearTimeout(originDebounce.current);
                    originDebounce.current = setTimeout(
                      () => fetchOriginSuggestions(e.target.value),
                      200
                    );
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setSugIdx((i) => Math.min(i + 1, originSuggestions.length - 1));
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setSugIdx((i) => Math.max(i - 1, -1));
                    } else if (e.key === "Escape") {
                      setOriginSuggestions([]);
                    }
                  }}
                  onFocus={() => {
                    if (originInput) fetchOriginSuggestions(originInput);
                  }}
                  onBlur={() => {
                    // Delay to allow click on suggestions
                    setTimeout(() => setOriginSuggestions([]), 200);
                  }}
                  placeholder="Enter city or address"
                  className="flex-1 text-xs font-mono bg-white/5 border border-white/8 rounded px-2.5 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-[--primary]/50 placeholder:text-[--color-dim]"
                />
                <button
                  type="submit"
                  disabled={originLoading || !originInput.trim()}
                  className="px-2.5 py-1.5 rounded bg-[--primary] text-[--primary-foreground] text-xs font-mono font-semibold hover:opacity-90 disabled:opacity-40 transition-colors"
                >
                  {originLoading ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    "GO"
                  )}
                </button>
              </form>
            </div>
            {/* Autocomplete suggestions dropdown */}
            {originSuggestions.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 panel-elevated rounded-lg z-50 overflow-hidden">
                {originSuggestions.map((s, i) => (
                  <button
                    key={s.placeId}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => selectOriginSuggestion(s)}
                    className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                      i === sugIdx
                        ? "bg-[--primary]/10 text-[--primary]"
                        : "text-foreground hover:bg-white/5"
                    }`}
                  >
                    <div className="font-medium">{s.main}</div>
                    <div className="text-[10px] text-[--color-dim]">{s.secondary}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* 50/50 split: map + itinerary */}
      <div className="flex flex-col md:flex-row flex-1 min-h-0">
        {/* Map */}
        <div className="h-[40vh] md:h-auto md:w-1/2 relative">
          <div ref={mapContainerRef} className="absolute inset-0" />
        </div>

        {/* Itinerary list */}
        <div className="flex-1 md:w-1/2 overflow-y-auto">

      {/* Mode filter bar */}
      <div className="px-4 pt-3 pb-1 flex items-center gap-2">
        <span className="text-[10px] font-mono tracking-widest text-[--color-dim] mr-1">MODE:</span>
        {(
          [
            ["all", "ALL", null],
            ["bus", "BUS", BusFront],
            ["train", "TRAIN", TrainFront],
            ["frontier", "FRONTIER", Plane],
          ] as [
            "all" | "bus" | "train" | "frontier",
            string,
            typeof Bus | null,
          ][]
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTransitPref(key)}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-mono font-semibold tracking-wider transition-colors ${
              transitPref === key
                ? key === "bus"
                  ? "bg-[--color-bus]/10 text-[--color-bus] border border-[--color-bus]/30"
                  : key === "train"
                    ? "bg-[--color-train]/10 text-[--color-train] border border-[--color-train]/30"
                    : key === "frontier"
                      ? "bg-[--color-flight]/10 text-[--color-flight] border border-[--color-flight]/30"
                      : "bg-white/5 text-foreground border border-white/10"
                : "text-[--color-dim] hover:text-foreground border border-transparent hover:border-white/5"
            }`}
          >
            {Icon && <Icon className="size-3" />}
            {label}
          </button>
        ))}
      </div>

      {/* Frontier search form */}
      {transitPref === "frontier" && (
        <FrontierPanel
          date={date}
          gameTime={time}
          venueName={venue}
          originLat={parseFloat(originLat) || undefined}
          originLng={parseFloat(originLng) || undefined}
          venueLat={parseFloat(venueLat) || undefined}
          venueLng={parseFloat(venueLng) || undefined}
          onResults={handleFrontierResults}
        />
      )}

      {/* Google Flights box */}
      {transitPref !== "frontier" && googleFlightsUrl && !loading && (
        <div className="mx-4 mt-3 px-4 py-3 rounded-lg border border-[--color-flight]/20 bg-[--color-flight]/5">
          <div className="flex items-center gap-3">
            <Plane className="size-5 text-[--color-flight] shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-mono font-semibold text-foreground">Flying instead?</p>
              <p className="text-xs font-mono text-[--color-dim] mt-0.5">Check real-time prices and schedules on Google Flights</p>
            </div>
            <a
              href={googleFlightsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded bg-[--color-flight] text-black text-xs font-mono font-semibold hover:opacity-90 transition-opacity"
            >
              Google Flights <ArrowRight className="size-3" />
            </a>
          </div>
        </div>
      )}

      {/* Results */}
      <main className="px-4 py-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-[--color-dim]">
            <div className="w-8 h-8 border-2 border-[--primary]/30 border-t-[--primary] rounded-full animate-spin mb-3" />
            <p className="text-sm font-mono tracking-widest">FINDING ROUTES...</p>
          </div>
        ) : error ? (
          <div className="text-center py-20">
            <p className="text-[--color-danger] text-sm font-mono">{error}</p>
            <button
              onClick={fetchItineraries}
              className="mt-3 text-xs font-mono text-[--color-dim] hover:text-foreground underline"
            >
              RETRY
            </button>
          </div>
        ) : itineraries.length === 0 ? (
          <div className="text-center py-20 text-[--color-dim]">
            {transitPref === "frontier" ? (
              <>
                <Plane className="size-8 mx-auto mb-3" />
                <p className="text-sm font-mono">SEARCH FRONTIER ROUTES ABOVE</p>
              </>
            ) : (
              <>
                <Navigation className="size-8 mx-auto mb-3" />
                <p className="text-sm font-mono">NO ROUTES FOUND</p>
                <p className="text-xs mt-1 font-mono">
                  No bus, train, or drive options available for this game
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {itineraries.map((it) => {
              const isExpanded = expandedId === it.id;
              const mainModes = getMainModes(it);
              const itEnrichments = enrichments[it.id];
              const isEnriching = enriching.has(it.id);

              // Compute enriched totals for collapsed header
              let displayTotalMinutes = it.totalMinutes;
              let displayArrivalTime = it.arrivalTime;
              let displayTotalCost: number | null = null;
              if (itEnrichments) {
                let minutesDelta = 0;
                let costSum = 0;
                let hasCost = false;
                it.legs.forEach((leg, i) => {
                  const ed = itEnrichments[i];
                  const sk = `${it.id}:${i}`;
                  const sw = swappedToTransit.has(sk);
                  if (ed) {
                    const newMin =
                      sw && ed.transitMinutes != null
                        ? ed.transitMinutes
                        : ed.driveMinutes;
                    minutesDelta += newMin - leg.minutes;
                    // Cost: swapped = transit fare, else uber upper bound
                    if (sw && ed.transitFare) {
                      const fare = parseFloat(ed.transitFare.replace(/[^0-9.]/g, ""));
                      if (!isNaN(fare)) { costSum += fare; hasCost = true; }
                    } else if (!sw && ed.uberEstimate) {
                      const upper = parseFloat(extractUpperBound(ed.uberEstimate).replace(/[^0-9.]/g, ""));
                      if (!isNaN(upper)) { costSum += upper; hasCost = true; }
                    } else if (leg.cost != null) {
                      costSum += leg.cost; hasCost = true;
                    }
                  } else if (leg.cost != null) {
                    costSum += leg.cost; hasCost = true;
                  }
                });
                displayTotalMinutes = Math.max(0, it.totalMinutes + minutesDelta);
                displayArrivalTime = new Date(
                  new Date(it.departureTime).getTime() + displayTotalMinutes * 60000
                ).toISOString();
                if (hasCost) displayTotalCost = Math.round(costSum);
              }

              return (
                <div
                  key={it.id}
                  className={`panel rounded overflow-hidden transition-colors border-l-2 ${modeBorderColor(mainModes.find((m) => m !== "drive") ?? mainModes[0] ?? "drive")}`}
                >
                  {/* Collapsed header */}
                  <button
                    className="w-full px-4 py-3 text-left"
                    onClick={() =>
                      setExpandedId(isExpanded ? null : it.id)
                    }
                  >
                    <div className="flex items-center gap-3">
                      {/* Leg icons — one per leg */}
                      <div className="flex items-center gap-0.5">
                        {it.legs.map((leg, i) => (
                          <span key={i} className={`${modeColor(leg.mode === "rideshare" ? "drive" : leg.mode)}`}>
                            {modeIcon(leg.mode)}
                          </span>
                        ))}
                      </div>

                      {/* Times */}
                      <div className="flex-1 min-w-0">
                        {it.legs.some((l) => l.mode === "flight") ? (
                          <>
                            <div className="flex items-center gap-1.5 text-sm font-mono font-medium text-foreground">
                              VIA {it.legs.filter((l) => l.mode === "flight").map((l) => l.routeName).join(", ")}
                            </div>
                            <div className="flex items-center gap-2 text-xs font-mono text-[--color-dim] mt-0.5">
                              <span className="text-sky-400 font-semibold">UNKNOWN — Check Google Flights</span>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="flex items-center gap-1.5 text-sm font-mono font-medium text-foreground">
                              <span>{formatTime(it.departureTime)}</span>
                              <ArrowRight className="size-3 text-[--color-dim]" />
                              <span>{formatTime(displayArrivalTime)}</span>
                              {!it.enriched && !itEnrichments && it.legs.some((l) => l.enrichable) && (
                                <span className="text-[#facc15] text-[10px] font-mono">
                                  (ESTIMATE)
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-xs font-mono text-[--color-dim] mt-0.5">
                              <span>{formatDuration(displayTotalMinutes)}</span>
                              <span>·</span>
                              <span className="text-emerald-400 font-semibold">
                                ~&lt;${displayTotalCost ?? it.totalCost ?? it.legs.reduce((s, l) => s + (l.cost ?? 0), 0)}
                              </span>
                              {it.legs.length > 1 && (
                                <>
                                  <span>·</span>
                                  <span>
                                    {it.legs.filter(
                                      (l) =>
                                        l.mode === "bus" ||
                                        l.mode === "train" ||
                                        l.mode === "flight"
                                    ).length}{" "}
                                    leg
                                    {it.legs.filter(
                                      (l) =>
                                        l.mode === "bus" ||
                                        l.mode === "train" ||
                                        l.mode === "flight"
                                    ).length !== 1
                                      ? "s"
                                      : ""}
                                  </span>
                                </>
                              )}
                            </div>
                          </>
                        )}
                      </div>

                      {isExpanded ? (
                        <ChevronUp className="size-4 text-[--color-dim]" />
                      ) : (
                        <ChevronDown className="size-4 text-[--color-dim]" />
                      )}
                    </div>
                  </button>

                  {/* Expanded timeline */}
                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-white/5">
                      {/* Enrich button */}
                      {!itEnrichments &&
                        it.legs.some((l) => l.enrichable) && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              enrichItinerary(it);
                            }}
                            disabled={isEnriching}
                            className="mt-3 mb-1 flex items-center gap-1.5 w-full px-3 py-2 rounded border border-[--primary]/30 text-[--primary] text-xs font-mono font-semibold hover:bg-[--primary]/10 transition-colors disabled:opacity-50"
                          >
                            {isEnriching ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <Zap className="size-3" />
                            )}
                            {isEnriching
                              ? "GETTING REAL TIMES..."
                              : "ENRICH WITH LIVE DATA"}
                          </button>
                        )}
                      {itEnrichments && (
                        <div className="mt-3 mb-1 flex items-center gap-1.5 text-xs font-mono text-[--color-live]">
                          <Zap className="size-3" />
                          <span>ENRICHED WITH LIVE DATA</span>
                        </div>
                      )}

                      <div className="mt-3 space-y-0">
                        {it.legs.map((leg, i) => {
                          const enrichData = itEnrichments?.[i];
                          const swapKey = `${it.id}:${i}`;
                          const isSwapped = swappedToTransit.has(swapKey);
                          const isNativeTransit = leg.mode === "transit" && !isSwapped;

                          // If enriched and swapped to transit, show transit data instead
                          const displayMode =
                            isSwapped && enrichData?.transitMinutes != null
                              ? "transit"
                              : leg.mode;
                          const displayMinutes =
                            enrichData && !isSwapped
                              ? enrichData.driveMinutes
                              : isSwapped && enrichData?.transitMinutes != null
                                ? enrichData.transitMinutes
                                : leg.minutes;

                          // Compute display times using real Google transit times when available
                          let displayDepart = leg.depart;
                          let displayArrive = leg.arrive;
                          if (isSwapped && enrichData?.transitMinutes != null) {
                            if (enrichData.transitDepartureTime && enrichData.transitArrivalTime) {
                              // Use real Google Directions times (already constrained by arriveBy/departAfter)
                              displayDepart = enrichData.transitDepartureTime;
                              displayArrive = enrichData.transitArrivalTime;
                            } else {
                              // Fallback: compute from adjacent legs with buffer
                              const nextLeg = i < it.legs.length - 1 ? it.legs[i + 1] : null;
                              const prevLegRef = i > 0 ? it.legs[i - 1] : null;
                              if (nextLeg) {
                                const arriveBy = new Date(nextLeg.depart).getTime() - BUFFER_MINUTES * 60000;
                                displayArrive = new Date(arriveBy).toISOString();
                                displayDepart = new Date(arriveBy - enrichData.transitMinutes * 60000).toISOString();
                              } else if (prevLegRef) {
                                const departAfter = new Date(prevLegRef.arrive).getTime() + BUFFER_MINUTES * 60000;
                                displayDepart = new Date(departAfter).toISOString();
                                displayArrive = new Date(departAfter + enrichData.transitMinutes * 60000).toISOString();
                              } else {
                                displayArrive = new Date(new Date(leg.depart).getTime() + enrichData.transitMinutes * 60000).toISOString();
                              }
                            }
                          } else if (enrichData && !isSwapped) {
                            // Enriched drive: adjust arrive based on live drive time
                            displayArrive = new Date(new Date(leg.depart).getTime() + enrichData.driveMinutes * 60000).toISOString();
                          }

                          // Compute layover gap using display times (accounts for swaps)
                          let gap = 0;
                          if (i > 0) {
                            const prevLeg = it.legs[i - 1];
                            const prevEnrich = itEnrichments?.[i - 1];
                            const prevSwapKey = `${it.id}:${i - 1}`;
                            const prevIsSwapped = swappedToTransit.has(prevSwapKey);
                            let prevArrive = prevLeg.arrive;
                            if (prevIsSwapped && prevEnrich?.transitMinutes != null) {
                              if (prevEnrich.transitDepartureTime && prevEnrich.transitArrivalTime) {
                                prevArrive = prevEnrich.transitArrivalTime;
                              } else {
                                // Fallback estimate for prev leg transit arrive
                                const prevPrevLeg = i > 1 ? it.legs[i - 2] : null;
                                if (prevPrevLeg) {
                                  const dep = new Date(prevPrevLeg.arrive).getTime() + BUFFER_MINUTES * 60000;
                                  prevArrive = new Date(dep + prevEnrich.transitMinutes * 60000).toISOString();
                                } else {
                                  prevArrive = new Date(new Date(prevLeg.depart).getTime() + prevEnrich.transitMinutes * 60000).toISOString();
                                }
                              }
                            } else if (prevEnrich && !prevIsSwapped) {
                              prevArrive = new Date(new Date(prevLeg.depart).getTime() + prevEnrich.driveMinutes * 60000).toISOString();
                            }
                            gap = Math.round(
                              (new Date(displayDepart).getTime() - new Date(prevArrive).getTime()) / 60000
                            );
                          }

                          return (
                            <div key={i}>
                              {/* Transfer gap / layover */}
                              {gap > 5 && (
                                <div className="flex items-center gap-2 py-1.5 pl-6 text-xs font-mono text-[#facc15]">
                                  <Clock className="size-3" />
                                  <span>
                                    {formatDuration(gap)} layover at{" "}
                                    {leg.from}
                                  </span>
                                </div>
                              )}

                              {/* Leg */}
                              <div className={`flex gap-3 py-2 rounded-lg px-2 -mx-2 transition-colors ${isSwapped ? "bg-[--color-transit]/8" : ""}`}>
                                {/* Timeline line */}
                                <div className="flex flex-col items-center w-5">
                                  <div
                                    className="w-3 h-3 rounded-full ring-2 ring-black/30"
                                    style={{ background: modeMapColor(displayMode) }}
                                  />
                                  <div
                                    className="flex-1 w-0.5 rounded-full"
                                    style={{ background: modeMapColor(displayMode), opacity: 0.4 }}
                                  />
                                </div>

                                {/* Leg details */}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className={modeColor(displayMode)}>
                                      {modeIcon(displayMode)}
                                    </span>
                                    <span className={`text-sm font-medium font-mono ${isSwapped ? "text-[--color-transit]" : "text-foreground"}`}>
                                      {isSwapped ? modeLabel(displayMode) : (leg.carrier || modeLabel(displayMode))}
                                      {leg.routeName && !isSwapped && (
                                        <span className="text-[--color-dim] ml-1">
                                          {leg.routeName}
                                        </span>
                                      )}
                                    </span>
                                    {enrichData && !isSwapped && (
                                      <span className="text-[10px] font-mono text-[--color-live]">
                                        (LIVE)
                                      </span>
                                    )}
                                    {isSwapped && (
                                      <span className="text-[10px] font-mono text-[--color-transit]">
                                        (TRANSIT)
                                      </span>
                                    )}
                                    {isNativeTransit && (
                                      <>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            const key = `${it.id}:${i}:train`;
                                            toggleTransitModeView(key);
                                            if (!transitModeData[key]) {
                                              fetchTransitModeData(key, leg.fromLat, leg.fromLng, leg.toLat, leg.toLng, "rail");
                                            }
                                          }}
                                          className={`text-[10px] font-mono cursor-pointer transition-colors ${
                                            shownTransitModes.has(`${it.id}:${i}:train`)
                                              ? "text-[--color-train] font-semibold"
                                              : "text-[--color-dim] hover:text-[--color-train]"
                                          }`}
                                        >
                                          ({shownTransitModes.has(`${it.id}:${i}:train`) ? "Hide" : "Show"} Train)
                                        </button>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            const key = `${it.id}:${i}:bus`;
                                            toggleTransitModeView(key);
                                            if (!transitModeData[key]) {
                                              fetchTransitModeData(key, leg.fromLat, leg.fromLng, leg.toLat, leg.toLng, "bus");
                                            }
                                          }}
                                          className={`text-[10px] font-mono cursor-pointer transition-colors ${
                                            shownTransitModes.has(`${it.id}:${i}:bus`)
                                              ? "text-[--color-bus] font-semibold"
                                              : "text-[--color-dim] hover:text-[--color-bus]"
                                          }`}
                                        >
                                          ({shownTransitModes.has(`${it.id}:${i}:bus`) ? "Hide" : "Show"} Bus)
                                        </button>
                                      </>
                                    )}
                                  </div>

                                  {/* Train/Bus toggle sections for native transit legs */}
                                  {isNativeTransit && (
                                    <>
                                      {shownTransitModes.has(`${it.id}:${i}:train`) && (
                                        <div className="mt-2 ml-1 pl-2 border-l-2 border-[--color-train]/30">
                                          {transitModeLoading.has(`${it.id}:${i}:train`) ? (
                                            <div className="flex items-center gap-1.5 text-xs font-mono text-[--color-dim]">
                                              <Loader2 className="size-3 animate-spin" />
                                              <span>Calculating train time...</span>
                                            </div>
                                          ) : transitModeData[`${it.id}:${i}:train`]?.minutes != null ? (
                                            <div className="text-xs font-mono space-y-0.5 text-[--color-dim]">
                                              <div className="flex items-center gap-1.5 text-[--color-train] font-semibold">
                                                <TrainFront className="size-3" />
                                                <span>TRAIN</span>
                                              </div>
                                              <div className="flex items-center gap-1">
                                                <MapPin className="size-3" />
                                                <span>{leg.from}</span>
                                                <span>→</span>
                                                <span>{leg.to}</span>
                                              </div>
                                              <div className="flex items-center gap-2">
                                                {transitModeData[`${it.id}:${i}:train`]!.departureTime && (
                                                  <span>
                                                    {formatTime(transitModeData[`${it.id}:${i}:train`]!.departureTime!)} →{" "}
                                                    {formatTime(transitModeData[`${it.id}:${i}:train`]!.arrivalTime!)}
                                                  </span>
                                                )}
                                                <span>·</span>
                                                <span>~{formatDuration(transitModeData[`${it.id}:${i}:train`]!.minutes!)}</span>
                                                {transitModeData[`${it.id}:${i}:train`]!.fare && (
                                                  <>
                                                    <span>·</span>
                                                    <span className="text-emerald-400">{transitModeData[`${it.id}:${i}:train`]!.fare}</span>
                                                  </>
                                                )}
                                              </div>
                                              <a
                                                href={`https://www.google.com/maps/dir/?api=1&origin=${leg.fromLat},${leg.fromLng}&destination=${leg.toLat},${leg.toLng}&travelmode=transit`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded text-xs font-medium border border-[--color-train]/30 text-[--color-train] hover:bg-[--color-train]/10 transition-colors"
                                                onClick={(e) => e.stopPropagation()}
                                              >
                                                Directions <ArrowRight className="size-3" />
                                              </a>
                                            </div>
                                          ) : (
                                            <div className="text-xs font-mono text-[--color-dim]">No train route available</div>
                                          )}
                                        </div>
                                      )}
                                      {shownTransitModes.has(`${it.id}:${i}:bus`) && (
                                        <div className="mt-2 ml-1 pl-2 border-l-2 border-[--color-bus]/30">
                                          {transitModeLoading.has(`${it.id}:${i}:bus`) ? (
                                            <div className="flex items-center gap-1.5 text-xs font-mono text-[--color-dim]">
                                              <Loader2 className="size-3 animate-spin" />
                                              <span>Calculating bus time...</span>
                                            </div>
                                          ) : transitModeData[`${it.id}:${i}:bus`]?.minutes != null ? (
                                            <div className="text-xs font-mono space-y-0.5 text-[--color-dim]">
                                              <div className="flex items-center gap-1.5 text-[--color-bus] font-semibold">
                                                <BusFront className="size-3" />
                                                <span>BUS</span>
                                              </div>
                                              <div className="flex items-center gap-1">
                                                <MapPin className="size-3" />
                                                <span>{leg.from}</span>
                                                <span>→</span>
                                                <span>{leg.to}</span>
                                              </div>
                                              <div className="flex items-center gap-2">
                                                {transitModeData[`${it.id}:${i}:bus`]!.departureTime && (
                                                  <span>
                                                    {formatTime(transitModeData[`${it.id}:${i}:bus`]!.departureTime!)} →{" "}
                                                    {formatTime(transitModeData[`${it.id}:${i}:bus`]!.arrivalTime!)}
                                                  </span>
                                                )}
                                                <span>·</span>
                                                <span>~{formatDuration(transitModeData[`${it.id}:${i}:bus`]!.minutes!)}</span>
                                                {transitModeData[`${it.id}:${i}:bus`]!.fare && (
                                                  <>
                                                    <span>·</span>
                                                    <span className="text-emerald-400">{transitModeData[`${it.id}:${i}:bus`]!.fare}</span>
                                                  </>
                                                )}
                                              </div>
                                              <a
                                                href={`https://www.google.com/maps/dir/?api=1&origin=${leg.fromLat},${leg.fromLng}&destination=${leg.toLat},${leg.toLng}&travelmode=transit`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded text-xs font-medium border border-[--color-bus]/30 text-[--color-bus] hover:bg-[--color-bus]/10 transition-colors"
                                                onClick={(e) => e.stopPropagation()}
                                              >
                                                Directions <ArrowRight className="size-3" />
                                              </a>
                                            </div>
                                          ) : (
                                            <div className="text-xs font-mono text-[--color-dim]">No bus route available</div>
                                          )}
                                        </div>
                                      )}
                                    </>
                                  )}

                                  {!isNativeTransit && (<>
                                  <div className={`mt-1 text-xs font-mono space-y-0.5 ${isSwapped ? "text-[--color-transit]/70" : "text-[--color-dim]"}`}>
                                    <div className="flex items-center gap-1">
                                      <MapPin className="size-3" />
                                      <span>{leg.from}</span>
                                      <span>→</span>
                                      <span>{leg.to}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span>
                                        {formatTime(displayDepart)} →{" "}
                                        {formatTime(displayArrive)}
                                      </span>
                                      <span>·</span>
                                      <span>
                                        ~{formatDuration(displayMinutes)}
                                      </span>
                                      {/* Show real prices only from enrichment */}
                                      {enrichData && !isSwapped && (
                                        <>
                                          {enrichData.uberEstimate && (
                                            <>
                                              <span>·</span>
                                              <span>
                                                <span className="text-white">UBER</span>{" "}
                                                <span className="text-emerald-400">~&lt;{extractUpperBound(enrichData.uberEstimate)}</span>
                                              </span>
                                            </>
                                          )}
                                          {enrichData.lyftEstimate && (
                                            <>
                                              <span>·</span>
                                              <span>
                                                <span className="text-white">LYFT</span>{" "}
                                                <span className="text-emerald-400">~&lt;{extractUpperBound(enrichData.lyftEstimate)}</span>
                                              </span>
                                            </>
                                          )}
                                        </>
                                      )}
                                      {isSwapped &&
                                        enrichData?.transitFare && (
                                          <>
                                            <span>·</span>
                                            <span className="text-emerald-400">
                                              {enrichData.transitFare}
                                            </span>
                                          </>
                                        )}
                                      {!enrichData &&
                                        leg.cost != null &&
                                        leg.cost > 0 && (
                                          <>
                                            <span>·</span>
                                            <span>
                                              {leg.mode === "bus" && <span className="text-white">FLIXBUS </span>}
                                              {leg.mode === "train" && <span className="text-white">AMTRAK </span>}
                                              <span className="text-emerald-400">
                                                ~${leg.cost}
                                              </span>
                                            </span>
                                          </>
                                        )}
                                      {leg.miles > 0 && (
                                        <>
                                          <span>·</span>
                                          <span>{leg.miles} mi</span>
                                        </>
                                      )}
                                    </div>
                                  </div>

                                  {/* Action buttons */}
                                  <div className="flex gap-1.5 mt-1.5 flex-col sm:flex-row flex-wrap">
                                    {(displayMode === "drive" ||
                                      displayMode === "rideshare") && (
                                      <>
                                        <a
                                          href={uberUrl(
                                            leg.from,
                                            leg.fromLat,
                                            leg.fromLng,
                                            leg.to,
                                            leg.toLat,
                                            leg.toLng
                                          )}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono font-semibold bg-[#191919] text-white border border-white/10 hover:bg-[#2a2a2a] transition-colors"
                                          onClick={(e) =>
                                            e.stopPropagation()
                                          }
                                        >
                                          UBER{" "}
                                          <ArrowRight className="size-3" />
                                        </a>
                                        <a
                                          href={lyftUrl(
                                            leg.fromLat,
                                            leg.fromLng,
                                            leg.toLat,
                                            leg.toLng
                                          )}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono font-semibold bg-[#d4004c] text-white hover:bg-[#e0105a] transition-colors"
                                          onClick={(e) =>
                                            e.stopPropagation()
                                          }
                                        >
                                          LYFT{" "}
                                          <ArrowRight className="size-3" />
                                        </a>
                                        <a
                                          href={
                                            leg.bookingUrl ||
                                            `https://www.google.com/maps/dir/?api=1&origin=${leg.fromLat},${leg.fromLng}&destination=${leg.toLat},${leg.toLng}&travelmode=driving`
                                          }
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono font-semibold border border-white text-white hover:bg-white/10 transition-colors"
                                          onClick={(e) =>
                                            e.stopPropagation()
                                          }
                                        >
                                          DRIVE{" "}
                                          <ArrowRight className="size-3" />
                                        </a>
                                        {/* Swap to transit button */}
                                        {enrichData?.transitMinutes !=
                                          null && (
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              toggleTransitSwap(swapKey);
                                            }}
                                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-[--color-transit]/10 text-[--color-transit] hover:bg-[--color-transit]/20 transition-colors"
                                          >
                                            <ArrowLeftRight className="size-3" />
                                            {isSwapped
                                              ? `Back to drive (${formatDuration(enrichData.driveMinutes)}${enrichData.uberEstimate ? `, ~${enrichData.uberEstimate}` : ""})`
                                              : `Swap: transit (${formatDuration(enrichData.transitMinutes)}${enrichData.transitFare ? `, ~${enrichData.transitFare}` : ""})`}
                                          </button>
                                        )}
                                      </>
                                    )}
                                    {displayMode === "transit" &&
                                      isSwapped && (
                                        <>
                                          <a
                                            href={`https://www.google.com/maps/dir/?api=1&origin=${leg.fromLat},${leg.fromLng}&destination=${leg.toLat},${leg.toLng}&travelmode=transit`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border border-white text-white hover:bg-white/10 transition-colors"
                                            onClick={(e) =>
                                              e.stopPropagation()
                                            }
                                          >
                                            DIRECTIONS{" "}
                                            <ArrowRight className="size-3" />
                                          </a>
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              toggleTransitSwap(swapKey);
                                            }}
                                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border border-white/10 text-[--color-dim] hover:text-foreground transition-colors"
                                          >
                                            <ArrowLeftRight className="size-3" />
                                            {`Back to drive (${formatDuration(enrichData!.driveMinutes)}${enrichData!.uberEstimate ? `, ~${enrichData!.uberEstimate}` : ""})`}
                                          </button>
                                        </>
                                      )}
                                    {(displayMode === "bus" ||
                                      displayMode === "train") && (
                                      <>
                                        {leg.bookingUrl && (
                                          <a
                                            href={leg.bookingUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border border-white text-white hover:bg-white/10 transition-colors"
                                            onClick={(e) =>
                                              e.stopPropagation()
                                            }
                                          >
                                            BOOK{" "}
                                            <ArrowRight className="size-3" />
                                          </a>
                                        )}
                                      </>
                                    )}
                                    {displayMode === "transit" &&
                                      !isSwapped && (
                                        <a
                                          href={
                                            leg.bookingUrl ||
                                            `https://www.google.com/maps/dir/?api=1&origin=${leg.fromLat},${leg.fromLng}&destination=${leg.toLat},${leg.toLng}&travelmode=transit`
                                          }
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border border-white text-white hover:bg-white/10 transition-colors"
                                          onClick={(e) =>
                                            e.stopPropagation()
                                          }
                                        >
                                          Directions{" "}
                                          <ArrowRight className="size-3" />
                                        </a>
                                      )}
                                    {displayMode === "flight" && leg.bookingUrl && (
                                      <a
                                        href={leg.bookingUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded text-xs font-mono font-semibold bg-sky-500/15 text-sky-400 border border-sky-500/30 hover:bg-sky-500/25 transition-colors"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        Check Google Flights for prices <ArrowRight className="size-3" />
                                      </a>
                                    )}
                                  </div>
                                  </>)}
                                </div>
                              </div>
                            </div>
                          );
                        })}

                        {/* Arrival */}
                        <div className="flex gap-3 py-2">
                          <div className="flex flex-col items-center w-5">
                            <div
                              className="w-3 h-3 rounded-full ring-2 ring-black/30"
                              style={{ background: modeMapColor(it.legs[it.legs.length - 1]?.mode ?? "drive") }}
                            />
                          </div>
                          <div
                            className="text-sm font-mono font-medium flex items-center gap-2"
                            style={{ color: modeMapColor(it.legs[it.legs.length - 1]?.mode ?? "drive") }}
                          >
                            <MapPin className="size-4" />
                            ARRIVE AT {venue.toUpperCase()}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            <button
              onClick={() => setResultLimit((l) => l + 10)}
              className="w-full mt-3 py-2.5 rounded border border-white/10 font-mono text-sm font-semibold text-[--color-dim] hover:text-foreground hover:border-white/20 transition-colors"
            >
              SHOW MORE ROUTES
            </button>
          </div>
        )}
      </main>
        </div>{/* close right panel */}
      </div>{/* close flex split */}
    </div>
  );
}
