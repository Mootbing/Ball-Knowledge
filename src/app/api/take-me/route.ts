import { NextRequest, NextResponse } from "next/server";
import { searchRoutes, type Preference } from "@/lib/route-search";

const VALID_PREFS = new Set(["balanced", "cheapest", "fastest", "prefer_bus", "prefer_train", "prefer_plane"]);

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const originLat = parseFloat(sp.get("originLat") ?? "");
  const originLng = parseFloat(sp.get("originLng") ?? "");
  const venue = sp.get("venue") ?? "";
  const venueLat = parseFloat(sp.get("venueLat") ?? "");
  const venueLng = parseFloat(sp.get("venueLng") ?? "");
  const date = sp.get("date") ?? "";
  const time = sp.get("time") ?? "";
  const preference = (sp.get("preference") ?? "balanced") as Preference;
  const maxTransfers = parseInt(sp.get("maxTransfers") ?? "1", 10);

  if ([originLat, originLng, venueLat, venueLng].some(isNaN) || !venue || !date || !time) {
    return NextResponse.json({ error: "Missing or invalid parameters" }, { status: 400 });
  }

  if (!VALID_PREFS.has(preference)) {
    return NextResponse.json({ error: "Invalid preference" }, { status: 400 });
  }

  try {
    console.log("[take-me] Searching:", { originLat, originLng, venue, venueLat, venueLng, date, time, preference, maxTransfers });
    const results = await searchRoutes({
      originLat,
      originLng,
      venueName: venue,
      venueLat,
      venueLng,
      gameDate: date,
      gameTime: time,
      preference,
      maxTransfers: Math.min(maxTransfers, 2),
    });
    console.log("[take-me] Found", results.length, "itineraries");
    return NextResponse.json({ itineraries: results });
  } catch (err) {
    console.error("[take-me] Search error:", err);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
