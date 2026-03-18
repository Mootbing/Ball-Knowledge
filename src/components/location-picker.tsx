"use client";

import { useState } from "react";
import { Navigation, Loader2 } from "lucide-react";

export function LocationPicker({
  userLocation,
  onLocationChange,
}: {
  userLocation: { lat: number; lng: number } | null;
  onLocationChange: (loc: { lat: number; lng: number } | null) => void;
}) {
  const [loading, setLoading] = useState(false);

  function handleUseGPS() {
    if (!navigator.geolocation) return;
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onLocationChange({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
        setLoading(false);
      },
      () => {
        setLoading(false);
      },
      { enableHighAccuracy: false, timeout: 10000 }
    );
  }

  return (
    <button
      onClick={handleUseGPS}
      disabled={loading}
      className="flex items-center justify-center w-10 h-10 rounded hover:bg-white/5 transition-colors"
      title={userLocation ? "Update GPS location" : "Use GPS location"}
    >
      {loading ? (
        <Loader2 className="size-4 text-[--primary] animate-spin" />
      ) : (
        <Navigation
          className={`size-4 ${userLocation ? "text-[--primary]" : "text-[--color-dim]"}`}
        />
      )}
    </button>
  );
}
