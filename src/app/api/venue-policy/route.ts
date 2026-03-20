import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { VenuePolicy } from "@/lib/venue-policies";

const cache = new Map<string, VenuePolicy>();

const client = new Anthropic();

/** Strip HTML tags, collapse whitespace, and trim to a reasonable length. */
function htmlToText(html: string): string {
  // Remove script/style blocks
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  // Convert common block elements to newlines
  text = text.replace(/<\/?(p|div|br|li|h[1-6]|tr)[^>]*>/gi, "\n");
  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, " ");
  // Decode common HTML entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
  // Collapse whitespace
  text = text.replace(/[ \t]+/g, " ").replace(/\n\s*\n/g, "\n").trim();
  // Limit to ~12k chars to stay within context
  return text.slice(0, 12000);
}

/** Search DuckDuckGo HTML for a query and return top result URLs. */
async function searchWeb(query: string): Promise<string[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });
  if (!res.ok) return [];
  const html = await res.text();
  // Extract result URLs from DuckDuckGo HTML results
  const urls: string[] = [];
  const regex = /class="result__a"[^>]*href="([^"]+)"/g;
  let match;
  while ((match = regex.exec(html)) !== null && urls.length < 5) {
    let href = match[1];
    // DDG wraps URLs in a redirect; extract the actual URL
    const udParam = href.match(/[?&]uddg=([^&]+)/);
    if (udParam) {
      href = decodeURIComponent(udParam[1]);
    }
    if (href.startsWith("http")) {
      urls.push(href);
    }
  }
  return urls;
}

/** Fetch a page's text content. */
async function fetchPageText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return "";
  const html = await res.text();
  return htmlToText(html);
}

/** Use Claude to extract structured policy from page text. */
async function extractPolicy(
  venueName: string,
  pageText: string,
  sourceUrl: string
): Promise<VenuePolicy | null> {
  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `You are extracting stadium bag/item policies from a webpage for "${venueName}".

Here is the page text:
---
${pageText}
---

Return ONLY valid JSON (no markdown, no explanation) with this exact structure:
{
  "websiteUrl": "the arena's main website URL (just the homepage, e.g. https://www.msg.com)",
  "policyUrl": "${sourceUrl}",
  "clearBagRequired": true or false,
  "maxBagSize": "dimensions string like 14x14x6 or empty string if not found",
  "items": [
    {"name": "item description", "allowed": true/false}
  ]
}

For the items array, include 6-12 of the most relevant items fans ask about:
- Bags: backpacks, purses, clear bags, fanny packs, diaper bags
- Electronics: power banks/portable chargers, cameras, laptops/tablets
- Other: outside food/drink, umbrellas, strollers, sealed water bottles

Mark each as allowed:true or allowed:false based on the policy. Only include items you can confirm from the text.
If you cannot determine the policy from the text, return {"error": "not_found"}.`,
      },
    ],
  });

  const text =
    message.content[0].type === "text" ? message.content[0].text : "";
  try {
    const parsed = JSON.parse(text);
    if (parsed.error) return null;
    return parsed as VenuePolicy;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const venue = searchParams.get("venue");
  if (!venue) {
    return NextResponse.json({ error: "venue param required" }, { status: 400 });
  }

  // Check cache
  if (cache.has(venue)) {
    return NextResponse.json(cache.get(venue));
  }

  try {
    // Search for the venue's bag policy page
    const query = `"${venue}" bag policy clear bag allowed prohibited`;
    const urls = await searchWeb(query);

    if (urls.length === 0) {
      return NextResponse.json(
        { error: "No results found" },
        { status: 404 }
      );
    }

    // Try fetching and parsing top results until we get a valid policy
    for (const url of urls.slice(0, 3)) {
      try {
        const pageText = await fetchPageText(url);
        if (pageText.length < 200) continue; // too short, probably not useful

        const policy = await extractPolicy(venue, pageText, url);
        if (policy && policy.items && policy.items.length > 0) {
          cache.set(venue, policy);
          return NextResponse.json(policy);
        }
      } catch {
        continue; // try next URL
      }
    }

    return NextResponse.json(
      { error: "Could not extract policy" },
      { status: 404 }
    );
  } catch (error) {
    console.error("venue-policy error:", error);
    return NextResponse.json(
      { error: "Internal error" },
      { status: 500 }
    );
  }
}
