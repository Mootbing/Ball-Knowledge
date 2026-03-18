"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MapPin, Navigation, X } from "lucide-react";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

let placesReady: Promise<void> | null = null;
function ensurePlaces(): Promise<void> {
  if (!placesReady) {
    setOptions({ key: API_KEY, v: "weekly" });
    placesReady = importLibrary("places").then(() => {});
  }
  return placesReady;
}

interface Suggestion {
  placeId: string;
  main: string;
  secondary: string;
}

export function LocationPicker({
  userLocation,
  onLocationChange,
}: {
  userLocation: { lat: number; lng: number } | null;
  onLocationChange: (loc: { lat: number; lng: number } | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [label, setLabel] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autocompleteRef = useRef<google.maps.places.AutocompleteService | null>(null);
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);

  // Init services
  useEffect(() => {
    ensurePlaces().then(() => {
      autocompleteRef.current = new google.maps.places.AutocompleteService();
      sessionTokenRef.current = new google.maps.places.AutocompleteSessionToken();
      geocoderRef.current = new google.maps.Geocoder();
    });
  }, []);

  // Reverse geocode user location to get a city name
  useEffect(() => {
    if (!userLocation) {
      setLabel(null);
      return;
    }
    ensurePlaces().then(() => {
      if (!geocoderRef.current) geocoderRef.current = new google.maps.Geocoder();
      geocoderRef.current.geocode(
        { location: { lat: userLocation.lat, lng: userLocation.lng } },
        (results, status) => {
          if (status !== "OK" || !results?.length) return;
          const locality = results.find((r) => r.types.includes("locality"));
          const best = locality ?? results[0];
          const city = best.address_components?.find((c) =>
            c.types.includes("locality")
          );
          const state = best.address_components?.find((c) =>
            c.types.includes("administrative_area_level_1")
          );
          if (city) {
            setLabel(state ? `${city.short_name}, ${state.short_name}` : city.short_name);
          } else {
            setLabel(best.formatted_address?.split(",")[0] ?? "Unknown");
          }
        }
      );
    });
  }, [userLocation]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setSuggestions([]);
      setQuery("");
      setSelectedIdx(-1);
    }
  }, [open]);

  // Fetch autocomplete predictions via JS SDK
  const fetchSuggestions = useCallback((input: string) => {
    if (!input.trim() || !autocompleteRef.current) {
      setSuggestions([]);
      return;
    }
    autocompleteRef.current.getPlacePredictions(
      {
        input,
        types: ["(regions)"],
        sessionToken: sessionTokenRef.current!,
      },
      (predictions, status) => {
        if (status !== "OK" || !predictions) {
          setSuggestions([]);
          return;
        }
        setSuggestions(
          predictions.slice(0, 5).map((p) => ({
            placeId: p.place_id,
            main: p.structured_formatting.main_text,
            secondary: p.structured_formatting.secondary_text,
          }))
        );
        setSelectedIdx(-1);
      }
    );
  }, []);

  function handleInputChange(val: string) {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(val), 200);
  }

  function selectSuggestion(s: Suggestion) {
    if (!geocoderRef.current) return;
    geocoderRef.current.geocode({ placeId: s.placeId }, (results, status) => {
      if (status === "OK" && results?.[0]?.geometry?.location) {
        const loc = results[0].geometry.location;
        onLocationChange({ lat: loc.lat(), lng: loc.lng() });
        sessionTokenRef.current = new google.maps.places.AutocompleteSessionToken();
        setOpen(false);
      }
    });
  }

  function handleGeocode() {
    if (!query.trim() || !geocoderRef.current) return;
    geocoderRef.current.geocode({ address: query }, (results, status) => {
      if (status === "OK" && results?.[0]?.geometry?.location) {
        const loc = results[0].geometry.location;
        onLocationChange({ lat: loc.lat(), lng: loc.lng() });
        setOpen(false);
      }
    });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (selectedIdx >= 0 && suggestions[selectedIdx]) {
        selectSuggestion(suggestions[selectedIdx]);
      } else {
        handleGeocode();
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  function handleUseMyLocation() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onLocationChange({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
        setOpen(false);
      },
      () => {},
      { enableHighAccuracy: false, timeout: 10000 }
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="glass rounded-xl flex items-center gap-2 px-3 py-2 text-sm hover:bg-black/5 transition-colors"
      >
        <MapPin className="size-4 text-blue-500 shrink-0" />
        <span className="truncate max-w-[120px] text-gray-700">
          {label ?? (userLocation ? "My Location" : "Set Location")}
        </span>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-2 glass rounded-xl p-3 min-w-[280px] z-50">
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              placeholder="Search city or address..."
              value={query}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-1 bg-gray-100 rounded-lg px-3 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-300"
            />
            {query && (
              <button
                onClick={() => { setQuery(""); setSuggestions([]); }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          {/* Autocomplete suggestions */}
          {suggestions.length > 0 && (
            <div className="mt-2 flex flex-col">
              {suggestions.map((s, i) => (
                <button
                  key={s.placeId}
                  onClick={() => selectSuggestion(s)}
                  className={`text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                    i === selectedIdx ? "bg-blue-50 text-blue-700" : "text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  <div className="font-medium text-xs">{s.main}</div>
                  <div className="text-[11px] text-gray-400">{s.secondary}</div>
                </button>
              ))}
            </div>
          )}

          <div className="flex gap-2 mt-2">
            <button
              onClick={handleUseMyLocation}
              className="flex items-center gap-1.5 bg-gray-100 text-gray-600 text-xs rounded-lg px-3 py-1.5 hover:bg-gray-200 hover:text-gray-800 transition-colors"
            >
              <Navigation className="size-3" />
              Use GPS
            </button>
          </div>

          {userLocation && label && (
            <div className="mt-2 pt-2 border-t border-gray-200 text-[11px] text-gray-400">
              Current: {label}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
