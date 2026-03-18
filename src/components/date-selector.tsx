"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

function formatDate(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatShortDate(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function gameLabel(n: number) {
  return `${n} game${n !== 1 ? "s" : ""}`;
}

export function DateSelector({
  currentDate,
  availableDates,
  onDateChange,
  gameCount,
  gameCountByDate,
}: {
  currentDate: string;
  availableDates: string[];
  onDateChange: (date: string) => void;
  gameCount: number;
  gameCountByDate: Record<string, number>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const idx = availableDates.indexOf(currentDate);
  const hasPrev = idx > 0;
  const hasNext = idx < availableDates.length - 1;
  const prevDate = hasPrev ? availableDates[idx - 1] : null;
  const nextDate = hasNext ? availableDates[idx + 1] : null;

  // Close dropdown on outside click
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

  return (
    <div ref={ref} className="relative">
      <div className="glass rounded-xl flex items-center gap-0.5 px-2 py-1.5 shrink-0">
        {/* Prev arrow */}
        <div className="flex flex-col items-center">
          <button
            onClick={() => {
              if (hasPrev) onDateChange(availableDates[idx - 1]);
            }}
            disabled={!hasPrev}
            className="p-1 rounded-lg hover:bg-white/10 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="size-4" />
          </button>
          {prevDate && (
            <span className="text-[9px] text-white/40 leading-none -mt-0.5">
              {gameCountByDate[prevDate] ?? 0}
            </span>
          )}
        </div>

        {/* Center date — clickable */}
        <button
          onClick={() => setOpen((o) => !o)}
          className="text-center min-w-[120px] px-1 rounded-lg hover:bg-white/10 transition-colors py-0.5"
        >
          <div className="text-sm font-medium leading-tight">
            {formatDate(currentDate)}
          </div>
          <div className="text-[10px] text-white/50 leading-tight">
            {gameLabel(gameCount)}
          </div>
        </button>

        {/* Next arrow */}
        <div className="flex flex-col items-center">
          <button
            onClick={() => {
              if (hasNext) onDateChange(availableDates[idx + 1]);
            }}
            disabled={!hasNext}
            className="p-1 rounded-lg hover:bg-white/10 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight className="size-4" />
          </button>
          {nextDate && (
            <span className="text-[9px] text-white/40 leading-none -mt-0.5">
              {gameCountByDate[nextDate] ?? 0}
            </span>
          )}
        </div>
      </div>

      {/* Dropdown date picker */}
      {open && (
        <div className="absolute top-full right-0 mt-2 glass rounded-xl p-2 max-h-[60vh] overflow-y-auto min-w-[200px] z-50">
          {availableDates.map((date) => {
            const count = gameCountByDate[date] ?? 0;
            const isActive = date === currentDate;
            return (
              <button
                key={date}
                onClick={() => {
                  onDateChange(date);
                  setOpen(false);
                }}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive
                    ? "bg-white/20 font-medium"
                    : "hover:bg-white/10"
                }`}
              >
                <span>{formatShortDate(date)}</span>
                <span className="text-[11px] text-white/50 ml-3">
                  {gameLabel(count)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
