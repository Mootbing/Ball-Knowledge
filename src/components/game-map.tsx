"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface MapEvent {
  id: string;
  name: string;
  est_time: string | null;
  venue: string;
  city: string;
  state: string;
  lat: number | null;
  lng: number | null;
}

export function GameMap({ events }: { events: MapEvent[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Clean up previous map
    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }

    const withCoords = events.filter(
      (e): e is MapEvent & { lat: number; lng: number } =>
        e.lat !== null && e.lng !== null
    );

    if (withCoords.length === 0) return;

    const map = L.map(containerRef.current, {
      scrollWheelZoom: false,
      attributionControl: false,
    });
    mapRef.current = map;

    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution: "",
      maxZoom: 19,
    }).addTo(map);

    const markers: L.LatLng[] = [];

    // Group events by venue so we can combine the popup
    const byVenue: Record<string, { lat: number; lng: number; venue: string; city: string; state: string; games: { name: string; est_time: string | null }[] }> = {};
    for (const e of withCoords) {
      const key = `${e.lat},${e.lng}`;
      if (!byVenue[key]) {
        byVenue[key] = { lat: e.lat, lng: e.lng, venue: e.venue, city: e.city, state: e.state, games: [] };
      }
      byVenue[key].games.push({ name: e.name, est_time: e.est_time });
    }

    for (const v of Object.values(byVenue)) {
      const latlng = L.latLng(v.lat, v.lng);
      markers.push(latlng);

      const gameLines = v.games
        .map((g) => {
          const time = g.est_time ? formatTimePopup(g.est_time) : "TBD";
          return `<div style="margin-bottom:4px"><strong>${time}</strong> ${g.name}</div>`;
        })
        .join("");

      const popup = `
        <div style="min-width:200px">
          <div style="font-weight:700;font-size:14px;margin-bottom:2px">${v.venue}</div>
          <div style="color:#666;font-size:12px;margin-bottom:8px">${v.city}, ${v.state}</div>
          ${gameLines}
        </div>
      `;

      L.circleMarker(latlng, {
        radius: 8,
        fillColor: "#1d4ed8",
        color: "#fff",
        weight: 2,
        fillOpacity: 0.9,
      })
        .bindPopup(popup)
        .addTo(map);
    }

    if (markers.length === 1) {
      map.setView(markers[0], 6);
    } else {
      const bounds = L.latLngBounds(markers);
      map.fitBounds(bounds, { padding: [40, 40] });
    }

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [events]);

  return (
    <div
      ref={containerRef}
      className="h-[300px] w-full rounded-lg border overflow-hidden"
    />
  );
}

function formatTimePopup(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}
