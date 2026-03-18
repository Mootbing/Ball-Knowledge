import { NextRequest, NextResponse } from "next/server";
import { getTravelTimes } from "@/lib/driving";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const fromLat = parseFloat(sp.get("fromLat") ?? "");
  const fromLng = parseFloat(sp.get("fromLng") ?? "");
  const toLat = parseFloat(sp.get("toLat") ?? "");
  const toLng = parseFloat(sp.get("toLng") ?? "");

  if ([fromLat, fromLng, toLat, toLng].some(isNaN)) {
    return NextResponse.json(
      { error: "Missing or invalid coordinates" },
      { status: 400 }
    );
  }

  const times = await getTravelTimes(fromLat, fromLng, toLat, toLng);
  return NextResponse.json(times);
}
