"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
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

export function SearchBar({
  value,
  onChange,
  onLocationChange,
}: {
  value: string;
  onChange: (v: string) => void;
  onLocationChange?: (loc: { lat: number; lng: number }) => void;
}) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const autocompleteRef = useRef<google.maps.places.AutocompleteService | null>(null);
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (onLocationChange) {
      ensurePlaces().then(() => {
        autocompleteRef.current = new google.maps.places.AutocompleteService();
        sessionTokenRef.current = new google.maps.places.AutocompleteSessionToken();
        geocoderRef.current = new google.maps.Geocoder();
      });
    }
  }, [onLocationChange]);

  // Close dropdown on outside click
  useEffect(() => {
    if (suggestions.length === 0) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setSuggestions([]);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [suggestions.length]);

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
          predictions.slice(0, 3).map((p) => ({
            placeId: p.place_id,
            main: p.structured_formatting.main_text,
            secondary: p.structured_formatting.secondary_text,
          }))
        );
        setSelectedIdx(-1);
      }
    );
  }, []);

  function handleChange(val: string) {
    onChange(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (onLocationChange && val.length >= 2) {
      debounceRef.current = setTimeout(() => fetchSuggestions(val), 300);
    } else {
      setSuggestions([]);
    }
  }

  function selectSuggestion(s: Suggestion) {
    if (!geocoderRef.current || !onLocationChange) return;
    geocoderRef.current.geocode({ placeId: s.placeId }, (results, status) => {
      if (status === "OK" && results?.[0]?.geometry?.location) {
        const loc = results[0].geometry.location;
        onLocationChange({ lat: loc.lat(), lng: loc.lng() });
        sessionTokenRef.current = new google.maps.places.AutocompleteSessionToken();
        setSuggestions([]);
        onChange("");
      }
    });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter" && selectedIdx >= 0 && suggestions[selectedIdx]) {
      e.preventDefault();
      selectSuggestion(suggestions[selectedIdx]);
    } else if (e.key === "Escape") {
      setSuggestions([]);
    }
  }

  function handleClear() {
    onChange("");
    setSuggestions([]);
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center px-3 py-2.5">
        <Search className="size-4 text-[--color-dim] shrink-0" />
        <input
          type="text"
          placeholder="Search teams, cities..."
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 bg-transparent border-none text-sm text-foreground placeholder:text-[--color-dim] focus:outline-none ml-2"
        />
        {value && (
          <button
            onClick={handleClear}
            className="text-[--color-dim] hover:text-foreground transition-colors"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {suggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 panel-elevated rounded-lg py-1 z-50">
          <div className="px-3 py-1 text-[10px] font-mono text-[--color-dim] tracking-widest uppercase">
            Set Location
          </div>
          {suggestions.map((s, i) => (
            <button
              key={s.placeId}
              onClick={() => selectSuggestion(s)}
              className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                i === selectedIdx
                  ? "bg-[--primary]/10 text-[--primary]"
                  : "text-foreground hover:bg-white/5"
              }`}
            >
              <div className="font-medium text-xs">{s.main}</div>
              <div className="text-[11px] text-[--color-dim]">{s.secondary}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
