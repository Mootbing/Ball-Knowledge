"use client";

import { Search, X } from "lucide-react";

export function SearchBar({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative flex-1 max-w-lg">
      <div className="glass rounded-xl flex items-center px-3 py-3">
        <Search className="size-4 text-gray-400 shrink-0" />
        <input
          type="text"
          placeholder="Search teams, arenas, cities..."
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 bg-transparent border-none text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none ml-2"
        />
        {value && (
          <button
            onClick={() => onChange("")}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
