"use client";

import { useState, useMemo, useEffect, Suspense, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import routesRaw from "../../../data/frontier-routes.json";
import { buildAdjacency, findPaths, type Path } from "@/lib/pathfinder";
import { cityToIata, buildFrontierUrl, resolveCity } from "@/lib/frontier";
import { CityInputMulti, allCitiesAlpha } from "@/components/city-input";
import { haversineKm, cityCoords } from "@/lib/frontier-coords";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { ArrowLeft, Plane, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";

const routes = routesRaw as { from: string; to: string }[];

const FlightMap = dynamic(() => import("@/components/flight-map"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-[#12121a] rounded flex items-center justify-center">
      <span className="text-[--color-dim] text-sm font-mono">LOADING MAP...</span>
    </div>
  ),
});

function sliderLabel(v: number) {
  return v >= 5 ? "Unlimited" : String(v);
}
function sliderToMaxLayovers(v: number) {
  return v >= 5 ? 10 : v;
}

type RouteGroup = {
  from: string;
  to: string;
  paths: Path[];
};

function groupPathsByRoute(paths: Path[]): RouteGroup[] {
  const map = new Map<string, RouteGroup>();
  for (const path of paths) {
    const from = path.stops[0];
    const to = path.stops[path.stops.length - 1];
    const key = `${from}|${to}`;
    if (!map.has(key)) map.set(key, { from, to, paths: [] });
    map.get(key)!.paths.push(path);
  }
  return Array.from(map.values());
}

function pathDistanceKm(path: Path): number {
  let total = 0;
  for (let i = 0; i < path.stops.length - 1; i++) {
    const a = cityCoords[path.stops[i]];
    const b = cityCoords[path.stops[i + 1]];
    if (a && b) total += haversineKm(a[0], a[1], b[0], b[1]);
  }
  return total;
}

function RouteRow({
  path,
  selected,
  onSelect,
}: {
  path: Path;
  selected: boolean;
  onSelect: () => void;
}) {
  const distMi = Math.round(pathDistanceKm(path) * 0.621371);
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left px-3 py-2 flex items-center gap-2 transition-colors text-sm
        ${selected
          ? "bg-[--primary]/10 border-l-2 border-[--primary]"
          : "hover:bg-white/[0.02] border-l-2 border-transparent"
        }`}
    >
      <span className="flex flex-wrap items-center gap-0.5 flex-1 min-w-0">
        {path.stops.map((stop, i) => (
          <span key={i} className="flex items-center gap-0.5">
            <span className="font-mono text-sm font-bold text-foreground">
              {cityToIata[stop] ?? stop}
            </span>
            {i < path.stops.length - 1 && (
              <span className="text-[--color-dim] text-xs">›</span>
            )}
          </span>
        ))}
      </span>
      <span className="text-xs font-mono text-[--color-dim] shrink-0">{distMi.toLocaleString()} mi</span>
      <span className={`text-xs shrink-0 ${selected ? "text-[--primary] font-semibold" : "text-[--color-dim]/30"}`}>
        {selected ? "●" : "○"}
      </span>
    </button>
  );
}

function LayoverSection({
  layovers,
  paths,
  selectedPath,
  onSelectPath,
}: {
  layovers: number;
  paths: Path[];
  selectedPath: Path | null;
  onSelectPath: (path: Path | null) => void;
}) {
  const [open, setOpen] = useState(layovers < 2);
  const badgeClass = layovers === 0
    ? "bg-emerald-400/10 text-emerald-400 border border-emerald-400/20"
    : "bg-white/5 text-[--color-dim] border border-white/10";

  return (
    <div className="border-t border-white/5">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/[0.02] transition-colors"
      >
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${badgeClass}`}>
          {layovers === 0 ? "Direct" : `${layovers} stop${layovers > 1 ? "s" : ""}`}
        </span>
        <span className="text-xs font-mono text-[--color-dim]">
          {paths.length} route{paths.length !== 1 ? "s" : ""} {open ? "▲" : "▼"}
        </span>
      </button>
      {open && (
        <div>
          {paths.map((path, i) => (
            <RouteRow
              key={i}
              path={path}
              selected={selectedPath === path}
              onSelect={() => onSelectPath(selectedPath === path ? null : path)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RouteGroupCard({
  group,
  date,
  selectedPath,
  onSelectPath,
  booked,
  onBook,
}: {
  group: RouteGroup;
  date: string;
  selectedPath: Path | null;
  onSelectPath: (path: Path | null) => void;
  booked: boolean;
  onBook: () => void;
}) {
  const [expanded, setExpanded] = useState(!booked);
  const fromIata = cityToIata[group.from] ?? group.from;
  const toIata = cityToIata[group.to] ?? group.to;
  const bookingUrl = buildFrontierUrl(group.from, group.to, date);
  const hasSelected = !booked && group.paths.some((p) => p === selectedPath);

  const layoverMap = new Map<number, Path[]>();
  for (const path of group.paths) {
    if (!layoverMap.has(path.layovers)) layoverMap.set(path.layovers, []);
    layoverMap.get(path.layovers)!.push(path);
  }
  layoverMap.forEach((paths) => {
    paths.sort((a, b) => pathDistanceKm(a) - pathDistanceKm(b));
  });
  const layoverGroups = Array.from(layoverMap.entries()).sort((a, b) => a[0] - b[0]);

  return (
    <div
      className={`rounded overflow-hidden transition-all border ${
        booked
          ? "border-white/5 bg-white/[0.02] opacity-50"
          : hasSelected
            ? "border-[--primary]/30 panel-elevated"
            : "panel"
      }`}
    >
      <div className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className={`font-mono text-lg font-black ${booked ? "text-[--color-dim]" : "text-foreground"}`}>{fromIata}</span>
              <span className="text-[--color-dim]">→</span>
              <span className={`font-mono text-lg font-black ${booked ? "text-[--color-dim]" : "text-foreground"}`}>{toIata}</span>
              {booked && (
                <span className="text-xs font-mono text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 px-1.5 py-0.5 rounded">LOOKED</span>
              )}
            </div>
            <p className="text-xs font-mono text-[--color-dim] mt-0.5 truncate">
              {group.from} → {group.to}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {bookingUrl && (
              <a
                href={bookingUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => { onBook(); setExpanded(false); }}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-mono font-semibold transition-colors ${
                  booked
                    ? "bg-white/5 text-[--color-dim] hover:bg-white/10"
                    : "bg-[--primary] text-[--primary-foreground] hover:opacity-90"
                }`}
              >
                Book <ExternalLink className="size-3" />
              </a>
            )}
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs font-mono text-[--color-dim] hover:text-foreground px-2 py-1 rounded hover:bg-white/5 transition-colors whitespace-nowrap"
            >
              {group.paths.length} route{group.paths.length !== 1 ? "s" : ""}{" "}
              {expanded ? <ChevronUp className="size-3 inline" /> : <ChevronDown className="size-3 inline" />}
            </button>
          </div>
        </div>
      </div>

      {expanded && (
        <div>
          {layoverGroups.map(([layovers, paths]) => (
            <LayoverSection
              key={layovers}
              layovers={layovers}
              paths={paths}
              selectedPath={selectedPath}
              onSelectPath={onSelectPath}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FlightsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const validCities = useMemo(() => new Set(allCitiesAlpha), []);
  const fromParams = useMemo(() => searchParams.getAll("from").map((c) => resolveCity(c, validCities)).filter((c): c is string => c !== null), [searchParams, validCities]);
  const toParams = useMemo(() => searchParams.getAll("to").map((c) => resolveCity(c, validCities)).filter((c): c is string => c !== null), [searchParams, validCities]);
  const dateParam = searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
  const sliderParam = Math.min(5, Math.max(1, parseInt(searchParams.get("stops") ?? "2")));

  const [froms, setFroms] = useState<string[]>(fromParams);
  const [tos, setTos] = useState<string[]>(toParams);
  const [date, setDate] = useState(dateParam);
  const [slider, setSlider] = useState(sliderParam);
  const [searchOpen, setSearchOpen] = useState(fromParams.length === 0 || toParams.length === 0);
  const [selectedPath, setSelectedPath] = useState<Path | null>(null);
  const [results, setResults] = useState<Path[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [userCoords, setUserCoords] = useState<[number, number] | null>(null);
  const [hiddenLayovers, setHiddenLayovers] = useState<Set<number>>(() => {
    const set = new Set<number>();
    for (let i = 2; i <= 10; i++) set.add(i);
    return set;
  });
  const [bookedCards, setBookedCards] = useState<Set<string>>(new Set());

  const adj = useMemo(() => buildAdjacency(routes), []);

  useEffect(() => {
    setFroms(fromParams);
    setTos(toParams);
    setDate(dateParam);
    setSlider(sliderParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromParams.join(","), toParams.join(","), dateParam, sliderParam]);

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setUserCoords([pos.coords.latitude, pos.coords.longitude]),
      () => {},
      { timeout: 8000 }
    );
  }, []);

  // Run search when URL params change
  useEffect(() => {
    if (fromParams.length === 0 || toParams.length === 0) { setResults(null); return; }
    setLoading(true);
    setSelectedPath(null);
    const timer = setTimeout(() => {
      const seen = new Set<string>();
      const allPaths: Path[] = [];
      for (const from of fromParams) {
        for (const to of toParams) {
          if (from === to || !allCitiesAlpha.includes(from) || !allCitiesAlpha.includes(to)) continue;
          for (const p of findPaths(adj, from, to, sliderToMaxLayovers(sliderParam))) {
            const key = p.stops.join("→");
            if (!seen.has(key)) { seen.add(key); allPaths.push(p); }
          }
        }
      }
      allPaths.sort((a, b) => a.layovers - b.layovers || a.stops.length - b.stops.length);
      setResults(allPaths);
      setLoading(false);
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adj, fromParams.join(","), toParams.join(","), sliderParam]);

  const handleSearch = useCallback(() => {
    if (froms.length === 0 || tos.length === 0) return;
    const params = new URLSearchParams();
    froms.forEach((f) => params.append("from", f));
    tos.forEach((t) => params.append("to", t));
    params.set("date", date);
    params.set("stops", String(slider));
    router.push(`/flights?${params.toString()}`);
    setSearchOpen(false);
  }, [froms, tos, date, slider, router]);

  const toggleLayover = useCallback((n: number) => {
    setHiddenLayovers((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n); else next.add(n);
      return next;
    });
  }, []);

  const filteredResults = useMemo(() => {
    if (!results || hiddenLayovers.size === 0) return results;
    return results.filter((p) => !hiddenLayovers.has(p.layovers));
  }, [results, hiddenLayovers]);

  const groups = filteredResults ? groupPathsByRoute(filteredResults) : [];

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[#0a0a0f]">
      {/* Top bar */}
      <header className="shrink-0 panel border-b border-white/5 z-30">
        <div className="flex items-center gap-3 px-4 py-2">
          <a href="/" className="text-[--color-dim] hover:text-foreground transition-colors">
            <ArrowLeft className="size-5" />
          </a>
          <Plane className="size-5 text-[--primary]" />
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-bold text-foreground leading-tight font-mono">FRONTIER FLIGHTS</h1>
            {fromParams.length > 0 && toParams.length > 0 && (
              <p className="text-[--primary] text-xs font-mono truncate">
                {fromParams.map((c) => cityToIata[c] ?? c).join(", ")} → {toParams.map((c) => cityToIata[c] ?? c).join(", ")}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            {!loading && results && results.length > 0 && (
              <span className="text-xs font-mono text-[--color-dim] hidden md:block">
                {results.length} route{results.length !== 1 ? "s" : ""} found
              </span>
            )}
            <button
              onClick={() => setSearchOpen(!searchOpen)}
              className="flex flex-col justify-center items-center gap-1.5 w-8 h-8 rounded hover:bg-white/5 transition-colors"
              aria-label="Toggle search"
            >
              <span className={`block w-4 h-0.5 bg-[--color-dim] rounded transition-all duration-200 origin-center ${searchOpen ? "rotate-45 translate-y-[5px]" : ""}`} />
              <span className={`block w-4 h-0.5 bg-[--color-dim] rounded transition-all duration-200 ${searchOpen ? "opacity-0 scale-x-0" : ""}`} />
              <span className={`block w-4 h-0.5 bg-[--color-dim] rounded transition-all duration-200 origin-center ${searchOpen ? "-rotate-45 -translate-y-[5px]" : ""}`} />
            </button>
          </div>
        </div>

        {/* Collapsible search form */}
        {searchOpen && (
          <div className="border-t border-white/5 px-4 py-3 bg-[#0a0a0f]">
            <div className="max-w-4xl mx-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                <CityInputMulti id="f-from" label="From" values={froms} onChange={setFroms} userCoords={userCoords} suggestCoords={userCoords} />
                <CityInputMulti id="f-to" label="To" values={tos} onChange={setTos} userCoords={userCoords} />
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label htmlFor="f-date" className="block text-xs font-mono font-semibold text-[--color-dim] mb-1">TRAVEL DATE</label>
                  <input
                    id="f-date"
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="h-[38px] px-2.5 border border-white/8 rounded bg-white/5 text-sm text-foreground font-mono focus:ring-2 focus:ring-[--primary]/50 outline-none"
                  />
                </div>
                <div className="min-w-[140px]">
                  <label className="block text-xs font-mono font-semibold text-[--color-dim] mb-1">
                    MAX STOPS: <span className="text-[--primary] font-bold">{sliderLabel(slider)}</span>
                  </label>
                  <Slider
                    min={1}
                    max={5}
                    step={1}
                    value={[slider]}
                    onValueChange={([v]) => setSlider(v)}
                    className="w-full"
                  />
                </div>
                <button
                  onClick={handleSearch}
                  className="h-[38px] px-5 rounded bg-[--primary] text-[--primary-foreground] text-sm font-mono font-semibold hover:opacity-90 transition-colors"
                >
                  Search
                </button>
              </div>
            </div>
          </div>
        )}
      </header>

      {/* Split screen */}
      <div className="flex-1 flex overflow-hidden">
        {/* Map */}
        <div className="h-[40vh] md:h-auto md:w-1/2 relative p-2">
          <FlightMap selectedPath={selectedPath} results={filteredResults} />
        </div>

        {/* Results */}
        <ScrollArea className="flex-1 md:w-1/2 border-l border-white/5">
          <div className="p-4">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h2 className="text-sm font-bold font-mono text-foreground">
                {loading ? "Searching..." :
                  results === null ? "Enter a search above" :
                  results.length === 0 ? "No routes found" :
                  filteredResults && filteredResults.length !== results.length
                    ? `${groups.length} flight${groups.length !== 1 ? "s" : ""} · ${filteredResults.length}/${results.length} routes`
                    : `${groups.length} flight${groups.length !== 1 ? "s" : ""} · ${results.length} route${results.length !== 1 ? "s" : ""}`}
              </h2>
              {!loading && results && results.length > 0 && (
                <div className="flex gap-1.5 flex-wrap">
                  {(() => {
                    const layoverCounts = new Map<number, number>();
                    for (const p of results) {
                      layoverCounts.set(p.layovers, (layoverCounts.get(p.layovers) ?? 0) + 1);
                    }
                    const sorted = Array.from(layoverCounts.entries()).sort((a, b) => a[0] - b[0]);
                    return sorted.map(([n, count]) => {
                      const hidden = hiddenLayovers.has(n);
                      const label = n === 0 ? `${count} direct` : `${count} · ${n} stop${n > 1 ? "s" : ""}`;
                      const baseClass = n === 0
                        ? hidden
                          ? "bg-white/5 text-[--color-dim]/40 border-white/5 line-through"
                          : "bg-emerald-400/10 text-emerald-400 border-emerald-400/20"
                        : hidden
                          ? "bg-white/5 text-[--color-dim]/40 border-white/5 line-through"
                          : "bg-white/5 text-[--color-dim] border-white/10";
                      return (
                        <button
                          key={n}
                          onClick={() => toggleLayover(n)}
                          className={`text-xs font-semibold px-2 py-0.5 rounded-full border cursor-pointer transition-colors hover:opacity-80 ${baseClass}`}
                          title={hidden ? `Show ${label}` : `Hide ${label}`}
                        >
                          {label}
                        </button>
                      );
                    });
                  })()}
                </div>
              )}
            </div>

            {selectedPath && (
              <div className="mb-3 px-3 py-2 panel-inset rounded flex items-center gap-4 text-xs font-mono text-[--color-dim]">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 rounded-full bg-emerald-400 ring-2 ring-[#0a0a0f]" />
                  Origin
                </span>
                {selectedPath.layovers > 0 && (
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-3 rounded-full bg-[#facc15] ring-2 ring-[#0a0a0f]" />
                    Layover
                  </span>
                )}
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 rounded-full bg-[--color-train] ring-2 ring-[#0a0a0f]" />
                  Destination
                </span>
              </div>
            )}

            {loading ? (
              <div className="flex items-center justify-center py-16 text-[--color-dim] text-sm font-mono">SEARCHING...</div>
            ) : filteredResults && filteredResults.length === 0 && results && results.length > 0 ? (
              <div className="text-center py-16 text-[--color-dim]">
                <Plane className="size-10 mx-auto mb-3 text-[--color-dim]/30" />
                <p className="font-semibold font-mono text-foreground">ALL ROUTES HIDDEN</p>
                <p className="text-sm mt-1 font-mono">Click the badges above to show routes again.</p>
              </div>
            ) : results === null ? (
              <div className="text-center py-16 text-[--color-dim] text-sm font-mono">
                Use the search above to find Frontier routes.
              </div>
            ) : results.length === 0 ? (
              <div className="text-center py-16 text-[--color-dim]">
                <Plane className="size-10 mx-auto mb-3 text-[--color-dim]/30" />
                <p className="font-semibold font-mono text-foreground">NO ROUTES FOUND</p>
                <p className="text-sm mt-1 font-mono">Try increasing max stops or check city names.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {groups.map((group, i) => {
                  const cardKey = `${group.from}|${group.to}`;
                  return (
                    <RouteGroupCard
                      key={i}
                      group={group}
                      date={dateParam}
                      selectedPath={selectedPath}
                      onSelectPath={setSelectedPath}
                      booked={bookedCards.has(cardKey)}
                      onBook={() => setBookedCards((prev) => new Set(prev).add(cardKey))}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

export default function FlightsPage() {
  return (
    <Suspense fallback={
      <div className="h-screen flex items-center justify-center bg-[#0a0a0f] text-[--color-dim] text-sm font-mono">LOADING...</div>
    }>
      <FlightsContent />
    </Suspense>
  );
}
