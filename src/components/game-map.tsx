"use client";

import { useEffect, useRef, useState } from "react";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";

let mapsReady: Promise<void> | null = null;

function ensureMaps(): Promise<void> {
  if (!mapsReady) {
    setOptions({ key: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "", v: "weekly" });
    mapsReady = Promise.all([
      importLibrary("maps"),
      importLibrary("marker"),
      importLibrary("routes"),
      importLibrary("places"),
    ]).then(() => {});
  }
  return mapsReady;
}

interface MapEvent {
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

export interface TransitStop {
  code: string;
  name: string;
  lat: number;
  lng: number;
  driveMinutes?: number;
  transitMinutes?: number | null;
}

export interface RouteFocus {
  venueLat: number;
  venueLng: number;
  airportLat: number;
  airportLng: number;
  airportCode: string;
  venueName: string;
  pinOnly?: boolean;
}

export interface VenueInfo {
  venue: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  games: {
    id: string;
    name: string;
    url: string;
    est_time: string | null;
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
  }[];
  airports: TransitStop[];
  trains: TransitStop[];
  buses: TransitStop[];
}

const directionsCache = new Map<string, google.maps.DirectionsResult>();

export function GameMap({
  events,
  routeFocus,
  selectedVenue,
  onMarkerClick,
  userLocation,
  bottomPadding = 0,
}: {
  events: MapEvent[];
  routeFocus?: RouteFocus | null;
  selectedVenue?: string | null;
  onMarkerClick?: (venue: VenueInfo) => void;
  userLocation?: { lat: number; lng: number } | null;
  bottomPadding?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<{ marker: google.maps.marker.AdvancedMarkerElement; venue: string; dot: HTMLDivElement }[]>([]);
  const overlayMarkersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const directionsRendererRef = useRef<google.maps.DirectionsRenderer | null>(null);
  const defaultBoundsRef = useRef<google.maps.LatLngBounds | null>(null);
  const userMarkerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const onMarkerClickRef = useRef(onMarkerClick);
  onMarkerClickRef.current = onMarkerClick;
  const bottomPaddingRef = useRef(bottomPadding);
  bottomPaddingRef.current = bottomPadding;
  const routeFocusRef = useRef(routeFocus);
  routeFocusRef.current = routeFocus;

  // Store events ref for building VenueInfo on click
  const eventsRef = useRef(events);
  eventsRef.current = events;

  // Initialize map once
  useEffect(() => {
    let cancelled = false;

    async function init() {
      await ensureMaps();
      if (cancelled || !containerRef.current || mapRef.current) return;

      const map = new google.maps.Map(containerRef.current, {
        mapId: "DEMO_MAP_ID",
        disableDefaultUI: true,
        zoomControl: false,
        gestureHandling: "greedy",
        colorScheme: "LIGHT",
        center: { lat: 39.8, lng: -98.5 },
        zoom: 4,
      });
      mapRef.current = map;
      directionsRendererRef.current = new google.maps.DirectionsRenderer({
        map,
        suppressMarkers: true,
        polylineOptions: {
          strokeColor: "#3b82f6",
          strokeWeight: 4,
          strokeOpacity: 0.8,
        },
      });
      setMapReady(true);
    }

    init();
    return () => { cancelled = true; };
  }, []);

  // Update markers when events change (or map becomes ready)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    // Clear old markers
    markersRef.current.forEach((m) => (m.marker.map = null));
    markersRef.current = [];

    const withCoords = events.filter(
      (e): e is MapEvent & { lat: number; lng: number } =>
        e.lat !== null && e.lng !== null
    );
    if (withCoords.length === 0) {
      defaultBoundsRef.current = null;
      return;
    }

    const bounds = new google.maps.LatLngBounds();

    // Group by venue
    const byVenue: Record<string, {
      lat: number; lng: number; venue: string; city: string; state: string;
      games: MapEvent[];
    }> = {};
    for (const e of withCoords) {
      const key = `${e.lat},${e.lng}`;
      if (!byVenue[key]) {
        byVenue[key] = { lat: e.lat, lng: e.lng, venue: e.venue, city: e.city, state: e.state, games: [] };
      }
      byVenue[key].games.push(e);
    }

    for (const v of Object.values(byVenue)) {
      const pos = { lat: v.lat, lng: v.lng };
      bounds.extend(pos);

      const dot = document.createElement("div");
      dot.style.cssText = "width:16px;height:16px;border-radius:50%;background:#1d4ed8;border:2.5px solid #fff;cursor:pointer;transition:all 150ms;";

      const marker = new google.maps.marker.AdvancedMarkerElement({
        map,
        position: pos,
        content: dot,
      });

      marker.addListener("click", () => {
        const currentEvents = eventsRef.current;
        const venueGames = currentEvents.filter((e) => e.venue === v.venue);
        const firstWithAirports = venueGames.find((e) => e.nearbyAirports?.length);
        const firstWithTrains = venueGames.find((e) => e.nearbyTrainStations?.length);
        const firstWithBuses = venueGames.find((e) => e.nearbyBusStations?.length);

        const venueInfo: VenueInfo = {
          venue: v.venue,
          city: v.city,
          state: v.state,
          lat: v.lat,
          lng: v.lng,
          games: venueGames.map((g) => ({
            id: g.id,
            name: g.name,
            url: g.url,
            est_time: g.est_time,
            min_price: g.min_price,
            odds: g.odds,
          })),
          airports: firstWithAirports?.nearbyAirports ?? [],
          trains: firstWithTrains?.nearbyTrainStations ?? [],
          buses: firstWithBuses?.nearbyBusStations ?? [],
        };
        onMarkerClickRef.current?.(venueInfo);
      });

      markersRef.current.push({ marker, venue: v.venue, dot });
    }

    defaultBoundsRef.current = bounds;

    if (Object.keys(byVenue).length === 1) {
      const only = Object.values(byVenue)[0];
      map.fitBounds(bounds, { top: 40, left: 40, right: 40, bottom: 40 + bottomPaddingRef.current });
    } else {
      map.fitBounds(bounds, { top: 40, left: 40, right: 40, bottom: 40 + bottomPaddingRef.current });
    }
  }, [events, mapReady]);

  // Highlight selected venue
  useEffect(() => {
    for (const { venue, dot } of markersRef.current) {
      if (selectedVenue && venue === selectedVenue) {
        dot.style.background = "#22c55e";
        dot.style.width = "22px";
        dot.style.height = "22px";
        dot.style.boxShadow = "0 0 12px #22c55e80";
      } else {
        dot.style.background = "#1d4ed8";
        dot.style.width = "16px";
        dot.style.height = "16px";
        dot.style.boxShadow = "none";
      }
    }
  }, [selectedVenue]);

  // User location marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    if (userMarkerRef.current) {
      userMarkerRef.current.map = null;
      userMarkerRef.current = null;
    }

    if (userLocation) {
      const dot = document.createElement("div");
      dot.className = "user-location-dot";

      const marker = new google.maps.marker.AdvancedMarkerElement({
        map,
        position: { lat: userLocation.lat, lng: userLocation.lng },
        content: dot,
        title: "Your location",
      });
      userMarkerRef.current = marker;
    }
  }, [userLocation, mapReady]);

  // Re-fit bounds when bottom padding changes (tray open/close)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const rf = routeFocusRef.current;
    if (rf) {
      // Route is active — re-fit the route bounds with new padding
      const bounds = new google.maps.LatLngBounds();
      bounds.extend({ lat: rf.venueLat, lng: rf.venueLng });
      bounds.extend({ lat: rf.airportLat, lng: rf.airportLng });
      map.fitBounds(bounds, { top: 50, left: 50, right: 50, bottom: 50 + bottomPadding });
    } else if (defaultBoundsRef.current) {
      map.fitBounds(defaultBoundsRef.current, { top: 40, left: 40, right: 40, bottom: 40 + bottomPadding });
    }
  }, [bottomPadding, mapReady]);

  // Route focus
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    overlayMarkersRef.current.forEach((m) => (m.map = null));
    overlayMarkersRef.current = [];
    directionsRendererRef.current?.setDirections({ routes: [] } as unknown as google.maps.DirectionsResult);

    if (!routeFocus) {
      if (defaultBoundsRef.current) {
        map.fitBounds(defaultBoundsRef.current, { top: 40, left: 40, right: 40, bottom: 40 + bottomPaddingRef.current });
      }
      return;
    }

    const venuePos = { lat: routeFocus.venueLat, lng: routeFocus.venueLng };
    const airportPos = { lat: routeFocus.airportLat, lng: routeFocus.airportLng };

    const venueDot = document.createElement("div");
    venueDot.style.cssText = "width:20px;height:20px;border-radius:50%;background:#22c55e;border:2px solid #fff;";
    const venueMarker = new google.maps.marker.AdvancedMarkerElement({
      map, position: venuePos, content: venueDot, title: routeFocus.venueName,
    });
    overlayMarkersRef.current.push(venueMarker);

    const airportDot = document.createElement("div");
    airportDot.style.cssText = "width:20px;height:20px;border-radius:50%;background:#f97316;border:2px solid #fff;";
    const airportMarker = new google.maps.marker.AdvancedMarkerElement({
      map, position: airportPos, content: airportDot, title: routeFocus.airportCode,
    });
    overlayMarkersRef.current.push(airportMarker);

    const bounds = new google.maps.LatLngBounds();
    bounds.extend(venuePos);
    bounds.extend(airportPos);
    map.fitBounds(bounds, { top: 50, left: 50, right: 50, bottom: 50 + bottomPaddingRef.current });

    if (!routeFocus.pinOnly) {
      const cacheKey = `${routeFocus.venueLat},${routeFocus.venueLng};${routeFocus.airportLat},${routeFocus.airportLng}`;
      const cached = directionsCache.get(cacheKey);
      if (cached) {
        directionsRendererRef.current?.setDirections(cached);
      } else {
        const svc = new google.maps.DirectionsService();
        svc.route(
          { origin: venuePos, destination: airportPos, travelMode: google.maps.TravelMode.DRIVING },
          (result, status) => {
            if (status === "OK" && result) {
              directionsCache.set(cacheKey, result);
              directionsRendererRef.current?.setDirections(result);
            }
          }
        );
      }
    }
  }, [routeFocus, mapReady]);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 w-dvw h-dvh z-0"
    />
  );
}
