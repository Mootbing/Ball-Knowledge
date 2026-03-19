import { NextRequest, NextResponse } from "next/server";
import { getTransitTime } from "@/lib/driving";

/**
 * POST /api/transit-check
 *
 * Returns transit time/fare for a specific mode (bus or rail).
 *
 * Body: { fromLat, fromLng, toLat, toLng, transitMode: "bus" | "rail", arriveBy?, departAfter? }
 * Response: { minutes, fare, departureTime, arrivalTime }
 */

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { fromLat, fromLng, toLat, toLng, transitMode, arriveBy, departAfter } = body;

    if ([fromLat, fromLng, toLat, toLng].some((v) => v == null || isNaN(v))) {
      return NextResponse.json({ error: "Invalid coordinates" }, { status: 400 });
    }
    if (!transitMode || !["bus", "rail"].includes(transitMode)) {
      return NextResponse.json(
        { error: "transitMode must be 'bus' or 'rail'" },
        { status: 400 }
      );
    }

    const constraint =
      arriveBy || departAfter
        ? {
            ...(arriveBy
              ? { arriveBy: Math.floor(new Date(arriveBy).getTime() / 1000) }
              : {}),
            ...(departAfter
              ? { departAfter: Math.floor(new Date(departAfter).getTime() / 1000) }
              : {}),
          }
        : undefined;

    const result = await getTransitTime(
      fromLat,
      fromLng,
      toLat,
      toLng,
      transitMode,
      constraint
    );
    return NextResponse.json(result);
  } catch (err) {
    console.error("[transit-check] Error:", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
