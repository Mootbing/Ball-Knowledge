# Ball Knowledge

A Next.js app that displays NBA game intelligence — Kalshi odds, Ticketmaster ticket links, venue maps, and nearby transit/airport info.

## Getting Started

### Prerequisites

Create a `.env.local` file with the required API keys:

```
TICKETMASTER_API_KEY=your_ticketmaster_key
GOOGLE_MAPS_API_KEY=your_google_maps_key
KALSHI_API_KEY=your_kalshi_key
```

### Install dependencies

```bash
npm install
```

### Run locally

```bash
npm run dev
```

### Build GTFS transit data (optional)

```bash
npm run gtfs
```

## Deployment (Vercel)

This project is configured for deployment on [Vercel](https://vercel.com). The `vercel.json` file in the root of this repository provides the build configuration.

To connect this repository to Vercel:
1. Go to [Vercel](https://vercel.com) and create a new project.
2. Import this GitHub repository.
3. Add the required environment variables in the Vercel project settings.
4. Deploy.

Subsequent pushes to the main branch will trigger automatic deployments.
