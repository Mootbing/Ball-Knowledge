const API_BASE = "https://app.ticketmaster.com/discovery/v2";

export interface TMEvent {
  id: string;
  name: string;
  url: string;
  dates: {
    start: {
      localDate: string;
      localTime?: string;
      dateTime?: string;
    };
    status: { code: string };
  };
  priceRanges?: Array<{
    type: string;
    currency: string;
    min: number;
    max: number;
  }>;
  _embedded?: {
    venues?: Array<{
      id: string;
      name: string;
      city: { name: string };
      state: { name: string; stateCode: string };
      country: { countryCode: string };
      address?: { line1: string };
      location?: { latitude: string; longitude: string };
    }>;
  };
}

interface TMResponse {
  _embedded?: { events?: TMEvent[] };
  page: { size: number; totalElements: number; totalPages: number; number: number };
}

export async function fetchNBAEvents(): Promise<TMEvent[]> {
  const apiKey = process.env.TICKETMASTER_API_KEY;
  if (!apiKey) {
    throw new Error("Missing TICKETMASTER_API_KEY in environment variables");
  }

  const allEvents: TMEvent[] = [];
  let page = 0;
  let totalPages = 1;

  while (page < totalPages) {
    const url = new URL(`${API_BASE}/events.json`);
    url.searchParams.set("apikey", apiKey);
    url.searchParams.set("subGenreId", "KZazBEonSMnZfZ7vFJA"); // NBA subgenre
    url.searchParams.set("countryCode", "US");
    url.searchParams.set("sort", "date,asc");
    url.searchParams.set("size", "100");
    url.searchParams.set("page", String(page));

    const res = await fetch(url.toString(), {
      next: { revalidate: 300 },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ticketmaster API error (${res.status}): ${text}`);
    }

    const data: TMResponse = await res.json();
    const events = data._embedded?.events ?? [];
    allEvents.push(...events);

    totalPages = Math.min(data.page.totalPages, 5); // cap at 5 pages (1000 events)
    page++;
  }

  return allEvents;
}
