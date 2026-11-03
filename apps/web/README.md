# DingoGo website (`apps/web`)

Public marketing site + live trip tracking (`/track/:token`). Vite + React + react-router.

```bash
cp .env.example .env.local      # set VITE_API_URL (and VITE_TILE_URL for production maps)
npm run dev                      # http://localhost:5173  (API share links point here)
npm run build                    # static output in dist/ — serve with SPA fallback to index.html
```

Pages: home (live fare estimator), rides, parcels, tours, business & events, drive with us, advertise,
rewards & partners, safety, about, help, legal (privacy / terms / cancellations / prohibited items — all marked
"Draft for legal review"), track.

API endpoints used: `/public/config`, `/public/places`, `/public/estimate`, `/public/tours`, `/public/partners`,
`/public/track/:token` (+ `/ws?share=`), `/public/hire-requests`, `/public/driver-applications`, `/public/enquiries`.

Deploy: any static host (Vercel/Netlify/Cloudflare Pages) with a rewrite of all paths to `/index.html`.
Screenshots of every page at 1440 px and 390 px are in `screenshots/`.
