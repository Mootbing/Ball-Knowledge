import { NextRequest, NextResponse } from "next/server";
import { checkFrontierRoutes } from "@/lib/airlabs";

export async function POST(req: NextRequest) {
  const apiKey = process.env.AIRLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "AIRLABS_API_KEY not configured" },
      { status: 500 }
    );
  }

  try {
    const body = await req.json();
    const { legs, date } = body as {
      legs: { dep: string; arr: string }[];
      date: string;
    };

    if (!Array.isArray(legs) || legs.length === 0 || !date) {
      return NextResponse.json(
        { error: "Missing legs array or date" },
        { status: 400 }
      );
    }

    // Cap to 20 unique routes per request to prevent abuse
    const capped = legs.slice(0, 20);
    const results = await checkFrontierRoutes(capped, date, apiKey);

    return NextResponse.json({ results });
  } catch (err) {
    console.error("[frontier-check]", err);
    return NextResponse.json(
      { error: "Internal error" },
      { status: 500 }
    );
  }
}
