"use client";

import { useState, useMemo } from "react";
import routesRaw from "../../data/frontier-routes.json";
import { getAllCities } from "@/lib/pathfinder";
import { haversineKm, cityCoords } from "@/lib/frontier-coords";
import { cityToIata } from "@/lib/frontier";

const allCitiesAlpha = getAllCities(routesRaw as { from: string; to: string }[]);
export { allCitiesAlpha };

export function CityInputMulti({
  id,
  label,
  values,
  onChange,
  userCoords,
  suggestCoords,
}: {
  id: string;
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  userCoords: [number, number] | null;
  suggestCoords?: [number, number] | null;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const suggested = useMemo(() => {
    const ref: [number, number] | null =
      suggestCoords !== undefined
        ? suggestCoords
        : values.length > 0 && cityCoords[values[0]] ? cityCoords[values[0]] : null;
    if (!ref) return [];
    return allCitiesAlpha
      .filter((c) => !values.includes(c) && cityCoords[c])
      .map((c) => ({
        city: c,
        iata: cityToIata[c],
        distMi: Math.round(haversineKm(ref[0], ref[1], cityCoords[c][0], cityCoords[c][1]) * 0.621371),
      }))
      .sort((a, b) => a.distMi - b.distMi)
      .slice(0, 5);
  }, [values, suggestCoords]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return allCitiesAlpha
      .filter((c) => !values.includes(c))
      .map((c) => ({ city: c, iata: cityToIata[c] }))
      .filter((o) => !q || o.city.toLowerCase().includes(q) || (o.iata && o.iata.toLowerCase().startsWith(q)));
  }, [query, values]);

  function select(city: string) { onChange([...values, city]); setQuery(""); }
  function remove(city: string) { onChange(values.filter((c) => c !== city)); }

  const showSuggested = !query && suggested.length > 0;

  return (
    <div className="relative">
      <label htmlFor={id} className="block text-xs font-mono font-semibold text-[--color-dim] mb-1">{label.toUpperCase()}</label>
      <div
        className="min-h-[38px] w-full border border-white/8 rounded px-2.5 py-1.5 bg-white/5 focus-within:ring-2 focus-within:ring-[--primary]/50 flex flex-wrap gap-1.5 items-center cursor-text"
        onClick={() => setOpen(true)}
      >
        {values.map((city) => (
          <span key={city} className="flex items-center gap-1 bg-[--primary]/10 text-[--primary] border border-[--primary]/20 text-xs font-semibold rounded px-2 py-0.5 shrink-0">
            <span className="font-mono">{cityToIata[city] ?? city}</span>
            <button
              type="button"
              className="text-[--primary]/50 hover:text-[--primary] leading-none ml-0.5"
              onMouseDown={(e) => { e.stopPropagation(); remove(city); }}
            >
              x
            </button>
          </span>
        ))}
        <input
          id={id}
          type="text"
          value={query}
          autoComplete="off"
          placeholder={values.length === 0 ? "City or airport code..." : "Add more..."}
          className="flex-1 min-w-[80px] text-sm font-mono outline-none bg-transparent text-foreground placeholder:text-[--color-dim] py-0.5"
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
      </div>
      {open && (showSuggested || filtered.length > 0) && (
        <ul className="absolute z-20 w-full panel-elevated rounded mt-1 max-h-72 overflow-auto">
          {showSuggested && (
            <>
              <li className="px-3 py-1 text-[10px] font-mono font-semibold text-[--color-dim] uppercase tracking-widest">
                Suggested
              </li>
              {suggested.map((opt) => (
                <li
                  key={opt.city}
                  className="px-3 py-2 text-sm cursor-pointer hover:bg-[--primary]/10 hover:text-[--primary] flex items-center justify-between gap-2"
                  onMouseDown={() => select(opt.city)}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {opt.iata && (
                      <span className="text-xs font-mono font-bold text-[--primary] bg-[--primary]/10 border border-[--primary]/20 px-1.5 py-0.5 rounded shrink-0">
                        {opt.iata}
                      </span>
                    )}
                    <span className="truncate text-foreground">{opt.city}</span>
                  </div>
                  <span className="text-xs font-mono text-[--color-dim] shrink-0">{opt.distMi.toLocaleString()} mi</span>
                </li>
              ))}
              {filtered.length > 0 && (
                <li className="px-3 py-1 text-[10px] font-mono font-semibold text-[--color-dim] uppercase tracking-widest border-t border-white/5">
                  All airports
                </li>
              )}
            </>
          )}
          {filtered.map((opt) => (
            <li
              key={opt.city}
              className="px-3 py-2 text-sm cursor-pointer hover:bg-[--primary]/10 hover:text-[--primary] flex items-center gap-2"
              onMouseDown={() => select(opt.city)}
            >
              {opt.iata && (
                <span className="text-xs font-mono font-bold text-[--primary] bg-[--primary]/10 border border-[--primary]/20 px-1.5 py-0.5 rounded shrink-0">
                  {opt.iata}
                </span>
              )}
              <span className="truncate text-foreground">{opt.city}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
