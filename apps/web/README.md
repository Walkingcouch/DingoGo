# DingoGo website (`apps/web`)

Public marketing site + live trip tracking (`/track/:token`). Vite + React + react-router.

```bash
cp .env.example .env.local      # set VITE_API_URL (and VITE_TILE_URL for production maps)
npm run dev                      # http://localhost:5173  (API share links point here)
npm run build                    # static output in dist/ — serve with SPA fallback to index.html
```

Pages: home (live fare estimator), check a fare (`/fares`, shareable link), airport transfers, hospital and clinic trips, rides, parcels, tours, business & events, drive with us, advertise,
rewards & partners, invite links (`/invite/:code`), driver application status (`/drive/status/:token`), safety, about, help, legal (privacy / terms / cancellations / prohibited items — all marked
"Draft for legal review"), track.

API endpoints used: `/public/config`, `/public/places`, `/public/estimate`, `/public/tours`, `/public/partners`,
`/public/track/:token` (+ `/ws?share=`), `/public/hire-requests`, `/public/driver-applications`, `/public/enquiries`.

SEO: `src/seo.ts` lists every public page; the build writes each as `<path>/index.html` with its own head tags, plus `app.html` (noindex), `sitemap.xml`
and `robots.txt`, and fails if the page-speed budget (entry JS/CSS, image sizes) is exceeded.

Deploy: any static host — serve `<path>/index.html` for prerendered pages and fall back to `/app.html` for everything else (see `deploy/Caddyfile`).
Screenshots of every page at 1440 px and 390 px are in `screenshots/`.
