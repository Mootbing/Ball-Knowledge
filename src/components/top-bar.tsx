"use client";

import { SearchBar } from "./search-bar";
import { DateSelector } from "./date-selector";
import { LocationPicker } from "./location-picker";

export function TopBar({
  search,
  onSearchChange,
  currentDate,
  availableDates,
  onDateChange,
  gameCount,
  gameCountByDate,
  userLocation,
  onLocationChange,
}: {
  search: string;
  onSearchChange: (v: string) => void;
  currentDate: string;
  availableDates: string[];
  onDateChange: (date: string) => void;
  gameCount: number;
  gameCountByDate: Record<string, number>;
  userLocation: { lat: number; lng: number } | null;
  onLocationChange: (loc: { lat: number; lng: number } | null) => void;
}) {
  return (
    <div className="fixed top-3 left-3 right-3 z-20 pointer-events-none">
      <div className="pointer-events-auto panel rounded-lg flex flex-col sm:flex-row items-stretch sm:items-center">
        {/* GPS */}
        <div className="shrink-0 border-b sm:border-b-0 sm:border-r border-white/5">
          <LocationPicker
            userLocation={userLocation}
            onLocationChange={onLocationChange}
          />
        </div>
        {/* Search (games + city) */}
        <div className="flex-1 min-w-0 border-b sm:border-b-0 sm:border-r border-white/5">
          <SearchBar value={search} onChange={onSearchChange} onLocationChange={onLocationChange} />
        </div>
        {/* Date */}
        <div className="shrink-0">
          <DateSelector
            currentDate={currentDate}
            availableDates={availableDates}
            onDateChange={onDateChange}
            gameCount={gameCount}
            gameCountByDate={gameCountByDate}
          />
        </div>
      </div>
    </div>
  );
}
