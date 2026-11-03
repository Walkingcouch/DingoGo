# DingoGo API reference

Base URL: `http://localhost:4000` in development. Auth: `Authorization: Bearer <JWT>` from `/auth/otp/verify`. Errors: `{ error, message, details? }`. Money in integer cents (AUD, GST-inclusive).


## Public (no sign-in)

| Method | Path |
| --- | --- |
| GET | `/health` |
| GET | `/public/config` |
| GET | `/public/places` |
| POST | `/public/estimate` |
| GET | `/public/tours` |
| GET | `/public/partners` |
| GET | `/public/track/:token` |
| POST | `/public/driver-applications` |
| POST | `/public/hire-requests` |
| POST | `/public/enquiries` |

## Auth & account

| Method | Path |
| --- | --- |
| POST | `/auth/otp/request` |
| POST | `/auth/otp/verify` |
| GET | `/me` |
| PATCH | `/me` |
| DELETE | `/me` |
| GET | `/me/export` |
| POST | `/me/push-token` |
| GET | `/me/notifications` |
| POST | `/me/notifications/read` |

## Rider

| Method | Path |
| --- | --- |
| GET | `/places/search` |
| POST | `/quotes` |
| POST | `/trips` |
| GET | `/trips` |
| GET | `/trips/:id` |
| GET | `/trips/:id/track` |
| POST | `/trips/:id/cancel` |
| POST | `/trips/:id/rate` |
| POST | `/trips/:id/tip` |
| GET | `/trips/:id/receipt` |
| POST | `/trips/:id/sos` |
| GET | `/loyalty` |
| POST | `/loyalty/rewards/:id/redeem` |
| GET | `/plans` |
| POST | `/subscriptions` |
| DELETE | `/subscriptions` |
| GET | `/payment-methods` |
| POST | `/payment-methods/setup` |
| POST | `/payment-methods` |
| DELETE | `/payment-methods/:id` |
| POST | `/wallet/topup` |
| POST | `/wallet/voucher` |
| POST | `/support` |
| GET | `/support` |
| GET | `/tours` |

## Driver

| Method | Path |
| --- | --- |
| GET | `/driver/me` |
| PATCH | `/driver/me` |
| POST | `/driver/documents` |
| POST | `/driver/online` |
| POST | `/driver/location` |
| GET | `/driver/offers` |
| POST | `/driver/offers/:tripId/accept` |
| POST | `/driver/offers/:tripId/decline` |
| GET | `/driver/trips/active` |
| GET | `/driver/trips` |
| POST | `/driver/trips/:id/arrive` |
| POST | `/driver/trips/:id/start` |
| POST | `/driver/trips/:id/complete` |
| POST | `/driver/trips/:id/cancel` |
| GET | `/driver/earnings` |
| POST | `/driver/charging` |
| GET | `/driver/charging` |
| POST | `/driver/battery` |
| POST | `/driver/sos` |

## Admin & dispatch (roles: admin, dispatcher)

| Method | Path |
| --- | --- |
| GET | `/admin/${path}` |
| POST | `/admin/${path}` |
| PATCH | `/admin/${path}/:id` |
| GET | `/admin/dashboard` |
| GET | `/admin/live` |
| GET | `/admin/trips` |
| GET | `/admin/trips/:id` |
| POST | `/admin/trips/:id/cancel` |
| POST | `/admin/trips/:id/redispatch` |
| POST | `/admin/trips/:id/refund` |
| POST | `/admin/bookings` |
| GET | `/admin/users` |
| PATCH | `/admin/users/:id` |
| GET | `/admin/drivers` |
| GET | `/admin/drivers/:id` |
| PATCH | `/admin/drivers/:id` |
| POST | `/admin/documents/:id/review` |
| POST | `/admin/vehicles/:id/display-key` |
| POST | `/admin/lease/run` |
| GET | `/admin/redemptions` |
| GET | `/admin/vouchers` |
| POST | `/admin/vouchers` |
| GET | `/admin/campaigns-report` |
| GET | `/admin/charging` |
| POST | `/admin/charging/reimburse` |
| GET | `/admin/payouts` |
| POST | `/admin/payouts/:driverId` |
| GET | `/admin/sos` |
| PATCH | `/admin/sos/:id` |
| GET | `/admin/support` |
| PATCH | `/admin/support/:id` |
| GET | `/admin/compliance` |
| PATCH | `/admin/compliance/:id` |
| GET | `/admin/reports/levy` |
| GET | `/admin/reports/gst` |
| POST | `/admin/corporate/:id/members` |
| GET | `/admin/corporate/:id/statement` |
| GET | `/admin/${path}` |
| PATCH | `/admin/${path}/:id` |
| GET | `/admin/settings` |
| PUT | `/admin/settings/:key` |
| POST | `/admin/broadcast` |
| GET | `/admin/audit` |
| GET / POST | `/admin/vehicles` (table `vehicles`) |
| PATCH | `/admin/vehicles/:id` |
| GET / POST | `/admin/fares` (table `fare_rules`) |
| PATCH | `/admin/fares/:id` |
| GET / POST | `/admin/zones` (table `zones`) |
| PATCH | `/admin/zones/:id` |
| GET / POST | `/admin/promos` (table `promo_codes`) |
| PATCH | `/admin/promos/:id` |
| GET / POST | `/admin/holidays` (table `public_holidays`) |
| PATCH | `/admin/holidays/:id` |
| GET / POST | `/admin/plans` (table `plans`) |
| PATCH | `/admin/plans/:id` |
| GET / POST | `/admin/tours` (table `tour_packages`) |
| PATCH | `/admin/tours/:id` |
| GET / POST | `/admin/partners` (table `partners`) |
| PATCH | `/admin/partners/:id` |
| GET / POST | `/admin/rewards` (table `rewards`) |
| PATCH | `/admin/rewards/:id` |
| GET / POST | `/admin/advertisers` (table `advertisers`) |
| PATCH | `/admin/advertisers/:id` |
| GET / POST | `/admin/campaigns` (table `ad_campaigns`) |
| PATCH | `/admin/campaigns/:id` |
| GET / POST | `/admin/corporate` (table `corporate_accounts`) |
| PATCH | `/admin/corporate/:id` |

## Partner portal

| Method | Path |
| --- | --- |
| GET | `/partner/me` |
| POST | `/partner/check` |
| POST | `/partner/redeem` |
| GET | `/partner/redemptions` |
| POST | `/partner/vouchers/sell` |

## Roof LED display (X-Display-Key header)

| Method | Path |
| --- | --- |
| GET | `/display/playlist` |
| POST | `/display/plays` |

## Uploads

| Method | Path |
| --- | --- |
| POST | `/uploads` |

## Realtime

`GET /ws?token=<JWT>` — auto-subscribes `user:<id>` (and `ops` for admin/dispatcher). Send `{"type":"subscribe","channel":"trip:<id>"}` to watch a trip you're part of. `GET /ws?share=<share_token>` gives read-only trip tracking for share links.

Events: `offer.new`, `offer.expired`, `trip.updated`, `driver.location`, `notification`, and on `ops`: `trip.created`, `trip.updated`, `driver.status`, `driver.location`, `sos.new`, `sos.updated`, `support.new`, `compliance.flag`, `safety.deviation`, `application.new`, `hire.new`.
