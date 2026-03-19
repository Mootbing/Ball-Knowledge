"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

function formatDateMono(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const mon = date.toLocaleDateString("en-US", { month: "short" }).toUpperCase();
  const day = String(d).padStart(2, "0");
  const wday = date.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
  return `${mon} ${day} ${wday}`;
}

const DAY_NAMES = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

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

  const [viewYear, setViewYear] = useState(() => {
    const [y] = currentDate.split("-").map(Number);
    return y;
  });
  const [viewMonth, setViewMonth] = useState(() => {
    const [, m] = currentDate.split("-").map(Number);
    return m - 1;
  });

  useEffect(() => {
    const [y, m] = currentDate.split("-").map(Number);
    setViewYear(y);
    setViewMonth(m - 1);
  }, [currentDate]);

  const availableSet = useMemo(() => new Set(availableDates), [availableDates]);

  const calendarDays = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const rows: (string | null)[][] = [];
    let week: (string | null)[] = [];

    for (let i = 0; i < firstDay; i++) week.push(null);

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      week.push(dateStr);
      if (week.length === 7) {
        rows.push(week);
        week = [];
      }
    }

    if (week.length > 0) {
      while (week.length < 7) week.push(null);
      rows.push(week);
    }

    return rows;
  }, [viewYear, viewMonth]);

  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  function prevMonth() {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  }

  function nextMonth() {
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  }

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
      <div className="flex items-center gap-0.5 px-2 py-1.5 shrink-0">
        {/* Prev arrow */}
        <div className="flex flex-col items-center">
          <button
            onClick={() => {
              if (hasPrev) onDateChange(availableDates[idx - 1]);
            }}
            disabled={!hasPrev}
            className="p-1 rounded hover:bg-white/5 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="size-4 text-[--color-dim]" />
          </button>
          {prevDate && (
            <span className="text-[9px] font-mono text-[--color-dim] leading-none -mt-0.5">
              {gameCountByDate[prevDate] ?? 0}
            </span>
          )}
        </div>

        {/* Center date — clickable */}
        <button
          onClick={() => setOpen((o) => !o)}
          className="text-center min-w-[120px] px-1 rounded hover:bg-white/5 transition-colors py-0.5"
        >
          <div className="text-sm font-mono font-medium leading-tight text-foreground tracking-wide">
            {formatDateMono(currentDate)}
          </div>
          <div className="text-[10px] font-mono text-[--primary] leading-tight tracking-widest uppercase">
            {gameCount} GAMES
          </div>
        </button>

        {/* Next arrow */}
        <div className="flex flex-col items-center">
          <button
            onClick={() => {
              if (hasNext) onDateChange(availableDates[idx + 1]);
            }}
            disabled={!hasNext}
            className="p-1 rounded hover:bg-white/5 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight className="size-4 text-[--color-dim]" />
          </button>
          {nextDate && (
            <span className="text-[9px] font-mono text-[--color-dim] leading-none -mt-0.5">
              {gameCountByDate[nextDate] ?? 0}
            </span>
          )}
        </div>
      </div>

      {/* Calendar dropdown */}
      {open && (
        <div className="absolute top-full right-0 mt-2 panel-elevated rounded-lg p-3 z-50 min-w-[280px]">
          {/* Month nav */}
          <div className="flex items-center justify-between mb-2">
            <button onClick={prevMonth} className="p-1 rounded hover:bg-white/5 transition-colors">
              <ChevronLeft className="size-4 text-[--color-dim]" />
            </button>
            <span className="text-sm font-semibold text-foreground">{monthLabel}</span>
            <button onClick={nextMonth} className="p-1 rounded hover:bg-white/5 transition-colors">
              <ChevronRight className="size-4 text-[--color-dim]" />
            </button>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 mb-1">
            {DAY_NAMES.map((d) => (
              <div key={d} className="text-center text-[10px] font-mono font-semibold text-[--color-dim] py-1">{d}</div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7">
            {calendarDays.flat().map((dateStr, i) => {
              if (!dateStr) {
                return <div key={`blank-${i}`} className="h-9" />;
              }
              const dayNum = parseInt(dateStr.split("-")[2]);
              const hasGames = availableSet.has(dateStr);
              const count = gameCountByDate[dateStr] ?? 0;
              const isSelected = dateStr === currentDate;
              const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
              const isToday = dateStr === today;

              return (
                <button
                  key={dateStr}
                  onClick={() => {
                    if (hasGames) {
                      onDateChange(dateStr);
                      setOpen(false);
                    }
                  }}
                  disabled={!hasGames}
                  className={`relative h-9 flex flex-col items-center justify-center rounded text-xs font-mono transition-colors ${
                    isSelected
                      ? "bg-[--primary] text-[--primary-foreground] font-bold"
                      : hasGames
                        ? "text-foreground font-medium hover:bg-white/5 cursor-pointer"
                        : "text-[--color-dim]/40 cursor-default"
                  } ${isToday && !isSelected ? "ring-1 ring-[--primary]/50" : ""}`}
                >
                  <span className="leading-none">{dayNum}</span>
                  {hasGames && count > 0 && (
                    <span className={`text-[8px] leading-none mt-0.5 ${isSelected ? "text-[--primary-foreground]/70" : "text-green-400"}`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
