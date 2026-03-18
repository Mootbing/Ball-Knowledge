import { NextResponse } from "next/server";
import { fetchNBAEvents, type TMEvent } from "@/lib/ticketmaster";
import { fetchNBAOdds, matchOddsToEvent } from "@/lib/kalshi";

export const revalidate = 60; // revalidate every minute for fresh odds

function cheapestPrice(event: TMEvent) {
  if (!event.priceRanges?.length) return null;
  const lowest = event.priceRanges.reduce((min, pr) =>
    pr.min < min.min ? pr : min
  );
  return { amount: lowest.min, currency: lowest.currency };
}

function toEST(utcDateTime: string): { date: string; time: string } {
  const d = new Date(utcDateTime);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const timeFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return {
    date: formatter.format(d),
    time: timeFormatter.format(d).replace(/\u202f/g, " "),
  };
}

export async function GET() {
  try {
    // Fetch TM events and Kalshi odds in parallel
    const [events, odds] = await Promise.all([
      fetchNBAEvents(),
      fetchNBAOdds().catch(() => []), // don't fail if Kalshi is down
    ]);

    const now = new Date();
    const upcoming = events.filter((e) => {
      const eventTime = e.dates.start.dateTime
        ? new Date(e.dates.start.dateTime)
        : new Date(e.dates.start.localDate);
      if (eventTime < now) return false;
      if (e.dates.status.code === "cancelled" || e.dates.status.code === "canceled") return false;
      const nameLower = e.name.toLowerCase();
      if (nameLower.includes("vip package") || nameLower.includes("parking")) return false;
      return true;
    });

    const seen = new Set<string>();
    const unique = upcoming.filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });

    const mapped = unique.map((event) => {
      const venue = event._embedded?.venues?.[0];
      let estDate: string;
      let estTime: string | null;

      if (event.dates.start.dateTime) {
        const est = toEST(event.dates.start.dateTime);
        estDate = est.date;
        estTime = est.time;
      } else {
        estDate = event.dates.start.localDate;
        estTime = event.dates.start.localTime ?? null;
      }

      // Match Kalshi odds
      const matched = matchOddsToEvent(event.name, estDate, odds);

      return {
        id: event.id,
        name: event.name,
        url: event.url,
        est_date: estDate,
        est_time: estTime,
        venue: venue?.name ?? "Unknown Venue",
        city: venue?.city.name ?? "",
        state: venue?.state?.stateCode ?? "",
        lat: venue?.location ? parseFloat(venue.location.latitude) : null,
        lng: venue?.location ? parseFloat(venue.location.longitude) : null,
        min_price: cheapestPrice(event),
        status: event.dates.status.code,
        odds: matched
          ? {
              away_team: matched.away_team,
              home_team: matched.home_team,
              away_win: Math.round(matched.away_yes * 100),
              home_win: Math.round(matched.home_yes * 100),
              kalshi_event: matched.event_ticker,
            }
          : null,
      };
    });

    mapped.sort(
      (a, b) =>
        a.est_date.localeCompare(b.est_date) ||
        (a.est_time ?? "").localeCompare(b.est_time ?? "")
    );

    const grouped: Record<string, typeof mapped> = {};
    for (const event of mapped) {
      if (!grouped[event.est_date]) {
        grouped[event.est_date] = [];
      }
      grouped[event.est_date].push(event);
    }

    const dates = Object.entries(grouped)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, events]) => ({ date, events }));

    return NextResponse.json({
      total: mapped.length,
      date_count: dates.length,
      dates,
      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Failed to fetch NBA events:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to fetch events",
      },
      { status: 500 }
    );
  }
}
