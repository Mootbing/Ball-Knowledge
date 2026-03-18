"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import type { Path } from "@/lib/pathfinder";
import { cityCoords } from "@/lib/frontier-coords";

export default function FlightMap({ selectedPath, results }: { selectedPath: Path | null; results?: Path[] | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const overlaysRef = useRef<any[]>([]);

  useEffect(() => {
    let cancelled = false;

    import("leaflet").then((mod) => {
      if (cancelled || !containerRef.current) return;
      const L = mod.default;

      if (!mapRef.current) {
        mapRef.current = L.map(containerRef.current, { zoomControl: true }).setView([37.5, -96], 4);
        L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
          maxZoom: 19,
        }).addTo(mapRef.current);
      }

      const map = mapRef.current;
      overlaysRef.current.forEach((o) => map.removeLayer(o));
      overlaysRef.current = [];

      if (!selectedPath) {
        // Grey background pins for all airports
        Object.entries(cityCoords).forEach(([city, c]) => {
          const marker = L.circleMarker([c[0], c[1]], {
            radius: 5,
            fillColor: "#9ca3af",
            color: "#6b7280",
            weight: 1,
            fillOpacity: 0.45,
          }).bindPopup(city);
          marker.addTo(map);
          overlaysRef.current.push(marker);
        });

        if (results && results.length > 0) {
          const froms = new Set(results.map((p) => p.stops[0]));
          const tos = new Set(results.map((p) => p.stops[p.stops.length - 1]));
          tos.forEach((city) => {
            const c = cityCoords[city];
            if (!c) return;
            const marker = L.circleMarker([c[0], c[1]], {
              radius: 8,
              fillColor: "#60a5fa",
              color: "#ffffff",
              weight: 2,
              fillOpacity: 0.85,
            }).bindTooltip(city, { permanent: false, direction: "top" });
            marker.addTo(map);
            overlaysRef.current.push(marker);
          });
          froms.forEach((city) => {
            const c = cityCoords[city];
            if (!c) return;
            const marker = L.circleMarker([c[0], c[1]], {
              radius: 8,
              fillColor: "#34d399",
              color: "#ffffff",
              weight: 2,
              fillOpacity: 0.85,
            }).bindTooltip(city, { permanent: false, direction: "top" });
            marker.addTo(map);
            overlaysRef.current.push(marker);
          });
        } else {
          map.setView([37.5, -96], 4);
        }
        return;
      }

      const { stops } = selectedPath;
      const positions: [number, number][] = [];

      for (let i = 0; i < stops.length - 1; i++) {
        const a = cityCoords[stops[i]];
        const b = cityCoords[stops[i + 1]];
        if (!a || !b) continue;
        const line = L.polyline([[a[0], a[1]], [b[0], b[1]]], {
          color: "#34d399",
          weight: 2.5,
          opacity: 0.85,
          dashArray: "10 6",
        });
        line.addTo(map);
        overlaysRef.current.push(line);
      }

      stops.forEach((stop, i) => {
        const c = cityCoords[stop];
        if (!c) return;
        positions.push([c[0], c[1]]);
        const isOrigin = i === 0;
        const isDest = i === stops.length - 1;
        const color = isOrigin ? "#34d399" : isDest ? "#60a5fa" : "#d4a843";
        const marker = L.circleMarker([c[0], c[1]], {
          radius: isOrigin || isDest ? 10 : 7,
          fillColor: color,
          color: "#ffffff",
          weight: 2.5,
          fillOpacity: 1,
        }).bindTooltip(stop, { permanent: false, direction: "top" });
        marker.addTo(map);
        overlaysRef.current.push(marker);
      });

      if (positions.length > 0) {
        map.fitBounds(L.latLngBounds(positions), { padding: [50, 50], maxZoom: 10 });
      }
    });

    return () => { cancelled = true; };
  }, [selectedPath, results]);

  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%" }}
      className="bg-[#12121a] rounded"
    />
  );
}
