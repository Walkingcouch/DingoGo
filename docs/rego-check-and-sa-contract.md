# Rego/age check + South Australia — build contract (Nov 2026)

Owner decisions (4 Nov 2026):
- Rego check: **free now, paid later**. Free = VIN-decoded model year + compliance-plate photo + admin links to official checks. Paid plate lookup built in but off until a provider key is set.
- South Australia: **regional towns only** — Port Augusta, Coober Pedy, Whyalla, Port Pirie, Mount Gambier. **Built but hidden** ("coming soon") until DingoGo's SA accreditation is approved. Adelaide metro not included.

## Research facts (cite in copy only as "SA rules"/"NT rules", keep editable)
NT: car < 13 years old (by year of manufacture), rideshare CVL, roadworthy < 6 weeks at CVL application, H endorsement + CPVID, $1 NT passenger levy per trip.
SA (sa.gov.au operator accreditation page; Uber Adelaide; DIT):
- Rideshare allowed statewide since March 2025 (no separate country accreditation).
- Driver: SA **driver accreditation** (3-yearly, annual instalments) AND **operator accreditation** (5-yearly) for rideshare drivers; working with children check; commercial vehicle driver medical (< 3 months at application); national police certificate; ABN + GST; unrestricted licence held ≥ 6 months.
- Vehicle: **max 8 years old** (year of manufacture); **annual inspection** at an approved station (RAA or Rightway); SA-registered; 4 doors, seats 4 + driver; CTP upgraded to "small passenger vehicle"; third-party property insurance; operator **public liability ≥ $5M**.
- Levy: SA passenger levy ($2 since 1 July 2025) applies to trips **starting in metropolitan Adelaide** → $0 in our regional zones (keep configurable).
- DingoGo needs SA booking-service accreditation before launch (DIT: DIT.P2PEnquiries@sa.gov.au).

Official check links (admin): NT rego check https://nt.gov.au/driving/registration/rego-check · SA rego check https://www.sa.gov.au/topics/driving-and-transport/vehicles-and-registration/vehicle-registration/checking-that-a-vehicle-is-registered · PPSR (by VIN; stolen / written-off / finance owing) https://www.ppsr.gov.au/carcheck

## Database — migration `services/api/migrations/010_states_and_rego_checks.sql`
- `jurisdictions` table: `code text PK ('NT','SA')`, `name`, `vehicle_max_age_years int` (NT 13, SA 8), `levy_cents int` (NT 100, SA 0 — regional), `levy_label text` ('NT passenger levy' / 'SA passenger levy'), `inspection_months int null` (SA 12, NT null), `rego_check_url`, `regulator` text, `driver_docs jsonb` (array of doc types required), `vehicle_docs jsonb`, `notes text`, `active bool` (NT true, SA false).
  - NT driver_docs: licence, h_endorsement, cpvid, police_check, medical, abn, gst. NT vehicle_docs: vehicle_rego, insurance, vehicle_cvl, roadworthy, compliance_plate.
  - SA driver_docs: licence, sa_driver_accreditation, sa_operator_accreditation, wwcc, police_check, medical, abn, gst. SA vehicle_docs: vehicle_rego, ctp_spv, insurance, sa_inspection, public_liability, compliance_plate.
- `zones.state text NOT NULL DEFAULT 'NT' REFERENCES jurisdictions(code)`; existing zones NT. Insert SA zones (inactive, launch_note 'Coming soon — awaiting SA accreditation'): port-augusta (-32.4925, 137.7656, r 15), coober-pedy (-29.0135, 134.7544, r 10), whyalla (-33.0333, 137.5833, r 15), port-pirie (-33.1858, 138.0169, r 12), mount-gambier (-37.8284, 140.7804, r 15).
- `drivers.state text NOT NULL DEFAULT 'NT' REFERENCES jurisdictions(code)`.
- `vehicles`: `rego_state text NOT NULL DEFAULT 'NT'`, `vin_year int` (decoded), `verified_year int`, `verified_source text` ('vin'|'compliance_plate'|'rego_papers'|'plate_lookup'|'other'), `rego_checked_at timestamptz`, `ppsr_checked_at timestamptz`, `ppsr_clear boolean`, `inspection_expiry` already exists (use for SA annual inspection), `lookup jsonb` (last paid plate lookup result), `lookup_at timestamptz`.
- Fare levy: quotes use the pickup zone's jurisdiction `levy_cents` / `levy_label` instead of the global fare rule levy (keep fare_rules.levy_cents as fallback if no zone).

## API (Builder A owns `services/api/**`)
- `lib/vin.ts`: validate 17-char VIN (no I/O/Q), decode model year from position 10 (30-year cycle; pick the most recent year ≤ current year + 1). Return `{ valid, year | null, note }`. It's a hint, not proof (some markets don't encode year reliably).
- Vehicle create/edit (driver & admin): `rego_state` ('NT'|'SA', default driver's state), `vin` **required for driver-created cars** (17 chars), compute `vin_year`. Age rule uses the **driver's/car's jurisdiction** max age: min_year = current_year − (max_age − 1). Use `verified_year ?? year` for compliance. If `vin_year` exists and differs from `year` by > 1, include `checks.vin_year_mismatch=true` in the response (don't block).
- `GET /driver/vehicles` and `/public/config` include jurisdiction rules (`jurisdictions: [...]`, and per-driver `rules` for their state).
- `PATCH /driver/me` accepts `state` ('NT'|'SA') while status is applied/pending_documents.
- Document types add: `compliance_plate`, `sa_driver_accreditation`, `sa_operator_accreditation`, `sa_inspection`, `ctp_spv`, `public_liability`.
- `complianceIssues`: per-jurisdiction required docs (approved & not expired) using `jurisdictions.driver_docs`; vehicle age by jurisdiction; SA: `inspection_expiry` current; vehicle `rego_state` must equal driver state; driver state's jurisdiction must be active ("DingoGo isn't operating in SA yet").
- Dispatch: only drivers whose `state` equals the pickup zone's `state`. Quotes/requests in inactive zones already blocked — keep.
- Admin review `POST /admin/vehicles/:id/review` accepts `verified_year`, `verified_source`, `rego_checked: boolean`, `ppsr_clear: boolean`, `inspection_expiry`. Approve requires `verified_year` (or a year already verified) and `rego_checked=true`; reject if verified_year too old with a clear error `vehicle_too_old`.
- Paid plate lookup: `POST /admin/vehicles/:id/lookup` → if `REGCHECK_USERNAME` unset: 501 `{ code:'lookup_not_configured' }`. Else GET `https://www.regcheck.org.uk/api/reg.asmx/CheckAustralia?RegistrationNumber=<rego>&State=<state>&username=<user>`; parse `<vehicleJson>` (JSON string) → store `lookup`, `lookup_at`; return `{ lookup: { year, make, model, vin, description, expiry, raw } }`. Admin-triggered only (each lookup costs a credit). `GET /admin/integrations` (or extend settings) reports `plate_lookup: configured|not_configured`.
- Admin jurisdictions: `GET/PATCH /admin/jurisdictions[/:code]` (age, levy, inspection months, active, notes).
- Tests: VIN decode unit tests; SA driver can't go online while SA inactive; SA car 9 years old rejected, NT 9-year-old ok; levy is $0 for an SA-zone quote when SA active (activate in test), $1 NT; dispatch doesn't offer an NT trip to an SA driver.

## Apps (Builder B owns `apps/**`)
Driver app:
- Onboarding first asks "Where will you drive?" — Northern Territory / South Australia (SA shows "Coming soon — sign up now and we'll be in touch"). Requirement list and document checklist come from the jurisdiction (`driver_docs`, `vehicle_docs`), with plain-English labels and one-line help each (e.g. "Compliance plate: photo of the build plate (inside the door frame or engine bay) showing when the car was made").
- Car form: rego state, **VIN required** with live decode hint ("VIN suggests a 2019 model" / warning if it doesn't match the year entered), year hint uses the state's max age.
Admin:
- Car review card gets a **"Checks"** panel: claimed year vs VIN year (match/mismatch chip), age limit for the car's state, compliance-plate photo link, buttons/links "Check rego (NT/SA gov)" and "Check PPSR (by VIN)" (open in new tab, VIN copy button), checkboxes "Rego is current (checked on gov site)", "PPSR clear: not stolen or written off", field "Verified year" (+ source select), SA: inspection expiry. "Look up plate" button (shows "Paid plate lookup not set up — add a provider key" when 501) and renders lookup result when available.
- Settings/Pricing: "States" section to edit jurisdiction rules (max age, levy, inspection months, active toggle) and show SA zones with their status; zones list shows state.
Website:
- Drive page: "Where we operate: Northern Territory now; South Australia (Port Augusta, Coober Pedy, Whyalla, Port Pirie, Mount Gambier) coming soon" with the SA requirements summary in a short collapsible/secondary block. About page timeline: add SA regional towns as the next phase. Home: subtle "Coming soon to regional SA" mention only if it fits naturally.
Rider app: inactive zones already show as not available — ensure SA towns show "Coming soon" if the rider is there (check existing behaviour; minimal change).
