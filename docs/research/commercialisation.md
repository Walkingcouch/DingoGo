# DingoGo Rideshare & Courier: Commercialisation & Competitive Analysis

*Prepared November 2026. Sources are linked inline. **[Unverified]** marks a claim I could not confirm from a primary or reputable secondary source. **[Assumption]** marks a modelling input. All figures are AUD unless stated.*

---

## 0. Executive summary

1. **The window is real but short.** Alice Springs has no rideshare yet. Taxis average a **35-minute wait** and score **6.9/10** for satisfaction. Darwin rideshare gets 8.7/10 and 93% of pickups arrive within 5 minutes ([NT DLI 2025 mystery shopper report](https://dli.nt.gov.au/__data/assets/pdf_file/0009/1619433/2025-taxi-and-rideshare-mystery-shopper-program-summary-report.pdf)). Uber already runs Uber Eats in Alice and is recruiting drivers. Its rideshare launch is "expected to commence this year" ([National Tribune, 22 Aug 2026](https://www.nationaltribune.com.au/uber-rideshare-on-way-for-alice-springs/); [Alice Springs News, 31 Aug 2026](https://arr.news/2026/09/01/taxis-get-competition/)). DingoGo should plan on Uber being live by early 2027.
2. **Ride-only economics do not work at 10 rides/car/day with a 25% fee.** On my model, a driver leasing a Dolphin and doing 10 rides plus 4 courier jobs over a 9-hour day nets about **$13.65/hr** before tax and super. The platform only breaks even (before paying founders) at **about 13 rides per car per day**, which matches the earlier plan's figure. Drivers need **about 19 rides per day** to clear $25/hr. The fix is three things together: a **pricing tune-up** (still below the taxi meter), **contracted hourly work** (health, NDIS, corporate) to fill quiet midday hours, and courier work. With those, the 3-car pilot is cash-positive and drivers clear about $25/hr (see section 4.5).
3. **Where DingoGo wins is not cheap fares.** It wins on *trusted, culturally safe, bookable transport* sold to institutions: NT Health, Aboriginal community-controlled organisations (ACCOs), NDIS plan managers and Commonwealth or NT buyers under Indigenous procurement targets. The Commonwealth target rose to 3% on 1 July 2025 and climbs to 4% by 2029–30 ([NIAA](https://niaa.gov.au/our-work/employment-and-economic-development/indigenous-procurement-policy-changing)). Uber cannot match that positioning.
4. **Capital.** Raise about **$200–250k now**, mostly non-dilutive (IBA Start-Up Finance Package of up to $150k with up to 30% as grant, plus an Aboriginal Investment NT start-up grant of up to $100k). Then raise **$0.6–1.0M at months 9–15** to reach 10 cars and Yulara, once contracts are signed.
5. **Watch-outs.** The 8-year/160,000 km battery warranty ([EVEE](https://www.evee.com.au/blog/2026-byd-dolphin-australia-price-specs-range/)) will be used up in about 3.5 years at rideshare mileage. A Fair Work minimum standards order for rideshare is pending. ACCU carbon credits for EV kilometres are **not available**: the Land and Sea Transport method closed on 31 March 2025 ([CER](https://cer.gov.au/schemes/australian-carbon-credit-unit-scheme/accu-scheme-methods/land-and-sea-transport-method-closed)).

---

## 1. Market sizing

### 1.1 Demand drivers: Alice Springs (Mparntwe) and Central Australia

| Driver | Data point | Source |
|---|---|---|
| Alice Springs population | ~29,700; Central Australia ~42,000, ~43% Aboriginal | [NT Budget Central Australia factsheet](https://budget.nt.gov.au/__data/assets/pdf_file/0006/1514985/central-australia-factsheet.pdf) |
| Aboriginal share, Alice LGA | 20.6% (2021); Aboriginal unemployment 14.4%; median age 27 | [ABS QuickStats 2021](https://www.abs.gov.au/census/find-census-data/quickstats/2021/IQSLGA70200) |
| Town camps | 17 camps (Tangentyere); 1,055 permanent residents (2021). Population "can nearly double" during major events | [Wikipedia: Alice Springs town camps](https://en.wikipedia.org/wiki/Alice_Springs_town_camps) |
| Airport | 356,813 passengers in FY2024–25 (25th in Australia) | [Wikipedia: busiest airports](https://en.wikipedia.org/wiki/List_of_the_busiest_airports_in_Australia) |
| Air capacity risk | Qantas has indefinitely suspended Melbourne–Alice (4x weekly, some flights under half full) and added a 7th weekly Sydney flight | [Australian Aviation](https://australianaviation.com.au/?p=1435644) |
| Visitors (Alice & MacDonnells) | 303,000 visitors (YE Dec 2022), 5.5 nights average, ~$1,121 per trip | [Tourism NT regional profiles](https://tourismnt.nt.gov.au/research-strategies/research/regional-profiles) |
| NT visitors (YE Dec 2025) | ~995,000 domestic overnight (+17.9%) and ~255,000 international (+15.1%) | [NT Economy: Tourism](https://nteconomy.nt.gov.au/industry-analysis/tourism) |
| Alice accommodation | Oct 2025: 28,000 room nights available, 20,000 used (~71%). Room stock is shrinking | [Alice Springs News, Dec 2025](https://arr.news/2025/12/22/what-future-for-tourism/) |
| Hospital | Alice Springs Hospital: 207 beds, >65,000 admissions/yr, catchment >42,000 people, ~84% of patients Aboriginal | [NT Rural Generalist](https://ruralgeneralist.nt.gov.au/the-territory/training-locations/alice-springs-hospital) |
| NDIS | 904 participants in Alice Springs LGA, flagged as a "CRITICAL" thin market | [CivicGraph (aggregator)](https://civicgraph.app/reports/disability/nt) **[Unverified against NDIA primary data]** |
| Public bus | 5 route groups, Monday–Saturday only (no Sunday service listed) | [nt.gov.au](https://nt.gov.au/driving/public-transport-cycling/public-bus-timetables-and-maps-alice-springs) |
| Events | Parrtjima 2025: >23,500 attendances | [NIT](https://nit.com.au/14-04-2025/17394/10th-edition-of-parrtjima-festival-closes-with-great-success) |
| | Red CentreNATS 2024: >10,000 attendees, >800 vehicles | [Ausleisure](https://www.ausleisure.com.au/news/red-centrenats-attracts-over-10000-to-mark-its-10th-anniversary) |
| | Finke Desert Race: "over $8 million" into the local economy, thousands of spectators (King's Birthday weekend) | [NAB](https://www.nab.com.au/news/sustainability-community/finke-desert-race-2025-an-iconic-event-driven-by-community-spirit) |
| | Alice Springs Show (July; town public holiday) | [Town Council calendar](https://alicesprings.nt.gov.au/about-alice-springs/calendar/2025-alice-springs-show) (attendance not found) |
| Tourism headwinds | Roughly a decade of decline, worsened by COVID and crime/anti-social behaviour. One operator reported tourism down 50–60% year on year in 2024 | [Alice Springs News](https://arr.news/2025/12/22/what-future-for-tourism/); [Al Jazeera](https://www.aljazeera.com/news/2024/11/12/in-australias-outback-youth-crime-stymies-efforts-to-get-tourism-on-track) |

### 1.2 TAM / SAM / SOM: Alice Springs (annual)

The **[Assumption]** inputs are spelled out so they can be replaced with real booking data after launch.

| Segment | TAM logic | TAM | SAM (what DingoGo can realistically serve) | SOM Y1 (3 cars) | SOM Y3 (10 cars) |
|---|---|---|---|---|---|
| **Rides** | Residents: 29,700 × ~1.5 point-to-point trips/month **[Assumption]** ≈ 535k trips. Airport: ~178k arrivals × 35% using taxi/shuttle/rideshare × 2 legs **[Assumption]** ≈ 125k. Visitors in town: 303k × 0.7 trips **[Assumption]** ≈ 210k. Total ≈ 870k trips × ~$19 | **~$16.5M GMV** | App- or phone-bookable trips, 6am–midnight, in-town and airport: ~50% → **~$8M** | 9,360 rides (3 × 10 × 312 days) × $18.78 = **$176k GMV (~1.1% of TAM)** | 43,680 rides (10 × 14 × 312) × ~$19.50 = **~$850k GMV (~5%)** |
| **Courier / last-mile** | ~200 local businesses (pharmacy, pathology, retail, hospitality, government) × 3 jobs/week × $15 **[Assumption]** | **~$0.5M** (excluding food marketplaces) | B2B scheduled + on-demand: ~60% → $0.3M | 3,744 jobs × $14 = **$52k** | ~15,600 jobs × $15 = **$234k** |
| **Private cultural/scenic tours** | 303k visitors × 40% buying a paid tour × $150 **[Assumption]** | **~$18M** | Private / small-group EV tours, a ~5% premium niche → **~$0.9M** | 6 tours/mo × $400 = **$29k** | 20/mo × $450 = **$108k** |
| **Corporate & event hire** | Government, hospital, ACCO and mining accounts. Taxi-account spend **[Unverified]** | **~$1.5M** | Indigenous-procurement-eligible buyers: ~40% → $0.6M | **$30k** | **$180k** |
| **NDIS transport** | 904 participants × ~$2,472 (Level 2) funding ([NDIA](https://www.ndis.gov.au/document/participant-transport-funding-informati)), plus activity-based transport at $0.99/km ([Leapin](https://www.leapin.com.au/news/ndis-provider-travel-costs-activity-based-transport/)) | **~$2.2M** | Plan-managed or self-managed participants able to use rideshare: ~50% → $1.1M | **$40k** | **$165k** |
| **Health transport (non-NDIS)** | PATS-adjacent trips, hospital discharge, ACCO client transport. Congress and others run their own buses **[Unverified spend]** | **~$1–2M** | Overflow and after-hours contracts → $0.4M | **$25k** | **$150k** |
| **Rooftop LED advertising** | Local out-of-home budgets **[Unverified]** | small | 3–10 cars × $300–600/mo | **$11k** | **$48k** |

**Reading this table:** the rides TAM is real but small, around $16M. A 3-car fleet takes about 1%. The **institutional segments (NDIS, health, corporate) add up to about $5M of TAM** where DingoGo's Aboriginal ownership and booked-ride reliability count for more than price. That is where gross margin per hour is highest.

### 1.3 Expansion markets

| Market | Key facts | Implication |
|---|---|---|
| **Tennant Creek** (Barkly) | Town ~3,500; Barkly region ~6,100, ~69% Aboriginal ([NT Budget Barkly factsheet](https://budget.nt.gov.au/__data/assets/pdf_file/0003/1514982/barkly-factsheet.pdf)). Barkly visitors ~64k/yr average 2020–22 ([Tourism NT](https://tourismnt.nt.gov.au/research-strategies/research/regional-profiles)). Airnorth flies from Alice ([Wikipedia](https://en.wikipedia.org/wiki/Alice_Springs_Airport)) | Too thin for open-market rideshare. Run **one hybrid car** (contract health/ACCO transport + courier + bookable rides) anchored by an Anyinginyi Health or council contract. Go only once a contract is signed. |
| **Yulara** (Ayers Rock Resort) | Airport 345,228 passengers in FY2024–25, up from 283,551 ([Wikipedia](https://en.wikipedia.org/wiki/Ayers_Rock_Airport)). "No taxis at Uluru"; AAT Kings runs free shuttles meeting every flight ([Australia Travel Questions](https://australiatravelquestions.com/?p=42613)) **[secondary]**. Uluru Hop On Hop Off is $140/adult/day ([Ayers Rock Resort](https://www.ayersrockresort.com.au/experiences/uluru-hop-on-hop-off-1-day-pass)). The resort is owned by Voyages, an ILSC subsidiary ([ILSC](https://www.ilsc.gov.au/wp-content/uploads/2019/09/Tourism_and_jobs_the_winners_as_Indigenous_Land_Corporation_buys_Ayers_Rock_Resort.pdf)) | High-yield **premium private transfers, sunrise/sunset tours and staff transport**, sold *through* Voyages as an Indigenous-to-Indigenous partnership. Entering the national park commercially needs Parks Australia tour permits **[Unverified: requirements not checked]**. The Alice–Yulara drive (~450 km) is beyond the Dolphin Premium's 427 km WLTP range, so it needs en-route charging. |
| **Darwin** | Greater Darwin ~159–161k people ([Centre for Population](https://population.gov.au/sites/population.gov.au/files/2026-01/ss-2025-pop-statement-nt.pdf)). Airport 1.86M passengers ([Wikipedia](https://en.wikipedia.org/wiki/List_of_the_busiest_airports_in_Australia)). Uber is well established (8.7/10, 93% pickups <5 min). DiDi is not listed in the NT ([NewLifeInAus](https://newlifeinaus.com.au/didi-australia/)). Taxi tariff from 1 Jul 2026: $5.90 + $1.95/km by day ([NT Gazette S53](https://nt.gov.au/__data/assets/pdf_file/0010/1620658/S53.pdf)) | **Do not compete in open-market rideshare.** Enter with B2B only: corporate and government accounts under procurement targets, NDIS, and platform licensing to ACCOs. The Darwin taxi per-km rate is low, which undercuts DingoGo's price advantage. |

---

## 2. Competitive landscape

### 2.1 Ride and point-to-point competitors

| Competitor | Pricing / take rate | NT / Alice presence | Strengths | Weaknesses | DingoGo positioning |
|---|---|---|---|---|---|
| **Uber** | Driver service fee ~25–27.5% ([Peakifi](https://peakifi.com/income/side-income/uber-driver-australia/); [NewLifeInAus](https://newlifeinaus.com.au/didi-australia/)) **[secondary]**. Melbourne UberX: $2.25 base + $1.21/km + $0.38/min, $8.50 minimum ([NewLifeInAus](https://newlifeinaus.com.au/didi-australia/)). Uber One costs $9.99/mo with 5% back as credits ([NewLifeInAus](https://newlifeinaus.com.au/uber-one-worth-it-australia/)) | Darwin since 2017. Alice: Uber Eats live, rideshare driver recruitment under way, launch "expected this year" ([National Tribune](https://www.nationaltribune.com.au/uber-rideshare-on-way-for-alice-springs/)). Uber Taxi integration exists in Victoria and NSW ([Uber](https://www.uber.com/en-AU/newsroom/book-a-taxi-with-uber-in-victoria)) | Tourists already have the app. Insurance products (Vero pay-per-km cover launched Sep 2026 ([FinTech Global](https://fintech.global/2026/09/09/vero-uber-launch-pay-per-km-rideshare-cover/))). Deep pockets for promotions. Uber One lock-in | Thin driver supply in remote towns. Surge pricing. No local institutional relationships, no cash or voucher option, no NDIS invoicing, no cultural-safety proposition | "Local, Aboriginal-owned, always there." Guaranteed pre-booked rides for appointments, phone booking, vouchers, NDIS invoices. Price at or slightly above Uber, with no surge. **Consider listing DingoGo supply on Uber later if volume is weak (as taxis do).** |
| **DiDi** | ~18% commission ([NewLifeInAus](https://newlifeinaus.com.au/didi-australia/)) **[secondary]** | Not in NT | Cheaper than Uber | Absent | Low threat |
| **Ola** | n/a | Exited Australia in April 2024 ([UQ](https://news.uq.edu.au/2024-04-15-ola-has-left-australia-what-does-it-mean-future-ridesharing-australia)) | n/a | n/a | Use as a reminder that sub-scale platforms exit. Stay asset-light and contract-backed |
| **Shebah** (women drivers) | Not verified | Not in NT **[Unverified]** | Safety niche | Small; current status unverified | Copy the idea: offer a "women drivers / women riders" option. Ikwe Safe Rides in Canada shows this demand exists among Indigenous women (below) |
| **13cabs / A2B** | Metered | Airport desk at Alice ([Alice Springs Airport](https://www.alicespringsairport.com.au/transport-options)). A2B is now owned by ComfortDelGro ([ComfortDelGro](https://www.comfortdelgro.com/news/comfortdelgro-australia-completes-a2b-australia-acquisition/)) | Rank access, accounts, Cabcharge | Ageing fleet, phone booking satisfaction falling ([DLI](https://dli.nt.gov.au/__data/assets/pdf_file/0009/1619433/2025-taxi-and-rideshare-mystery-shopper-program-summary-report.pdf)) | Win on wait time and app experience |
| **Alice Springs Taxis (131008)** | Max tariff from 1 Jul 2026: **$5.50 flagfall + $2.45/km** (weekday 6am–6pm); **$6.80 + $2.89/km** nights/weekends; waiting 10c per 5.3 s; up to 5% card surcharge ([NT Gazette S53](https://nt.gov.au/__data/assets/pdf_file/0010/1620658/S53.pdf); [nt.gov.au](https://nt.gov.au/taxi)). *Note: the brief's $5.30 flagfall was replaced on 1 July 2026.* Standard taxi CVL $4,000/yr; 3 more standard + 3 MPT licences balloted in 2026 ([NT ballot pack](https://nt.gov.au/__data/assets/pdf_file/0008/1626254/2026-taxi-licence-ballots-information-pack.pdf)) | Incumbent | Ranks, wheelchair MPTs, 98% of passengers felt safe, 100% wheelchair securement | Average 35-minute wait, 6.9/10 satisfaction, ageing vehicles | DingoGo is ~13% cheaper by day and ~27% cheaper at night (section 4.1). Promise **"<10-minute pickup or $5 credit."** |
| **Private hire** (ASP, Wheelies, Denis, A&P) | Quoted | Listed by the airport ([ASP](https://www.alicespringsairport.com.au/transport-options)) | Relationships, wheelchair (Wheelies) | Phone-only, small | Partner rather than fight: offer them the DingoGo platform (white-label or SaaS) |
| **Alice Springs Airport Shuttle** | $23 one-way / $44 return per adult; groups of 4+ $21 ([ASP](https://www.alicespringsairport.com.au/transport-options)) | Incumbent | Cheap for solo travellers | Pre-booked, shared, slow | For 2+ passengers DingoGo's ~$31 airport fare beats 2 × $23. Market it as **"Airport for two: cheaper than the shuttle."** |

### 2.2 Courier and last-mile

| Competitor | Pricing / model | Alice presence | Gap DingoGo can fill |
|---|---|---|---|
| **Australia Post / StarTrack** | National parcel network | Yes (depot-based) | No *same-hour, in-town* service; pickups are scheduled |
| **Sendle** | Flat-rate national parcels via carrier partners ([Sendle pricing](https://try.sendle.com/en-au/pricing)) | Via partners | Not same-day local. DingoGo could become a Sendle/aggregator last-mile partner **[Unverified feasibility]** |
| **CouriersPlease, Zoom2u** | National / metro same-day | Alice coverage **[Unverified]** | Metro-focused |
| **Uber Eats / Uber Direct** | Uber Eats marketplace commission 30% (delivery), 16% self-delivery. Uber Direct uses fixed + distance pricing with a **$700 activation fee** per location ([Uber Eats merchants](https://merchants.ubereats.com/au/en/pricing)) | Uber Eats live. Uber's Alice page lists only Uber Eats ([Uber](https://www.uber.com/au/en/e/deliver/alice-springs-nt-au/)) | Uber Direct (white-label delivery) doesn't appear to be live in Alice. DingoGo can offer **no activation fee, local B2B delivery** |
| **DoorDash** | Marketplace | Alice Springs was among 13 regional areas added ([Internet Retailing](https://internetretailing.com.au/doordash-extends-service-to-more-regional-australian-areas/)) | Food delivery is a red ocean. Avoid it; offer **restaurant self-delivery fulfilment** instead |
| **Menulog** | n/a | Ceased Australian operations on **26 Nov 2025** ([The New Daily](https://www.thenewdaily.com.au/news/2025/11/12/menulog-closes-in-australia)) | Its former drivers and restaurants need alternatives |
| **Pharmacy delivery** (Chemist2U, GoPeople) | Metro same-day ([GoPeople](https://www.gopeople.com.au/same-day-delivery-for-pharmacies-meeting-urgent-medical-needs-across-australia)) | Not Alice **[Unverified]** | **Webster-pack and script delivery** to town camps and homes, with cold-chain bags. Highest-value courier niche |

### 2.3 Tours

| Operator | Model / price | Notes | Positioning |
|---|---|---|---|
| **AAT Kings** | Coach day tours from Alice (half-day West Macs, 7:30–12:00, pickup included) ([AAT Kings](https://www.aatkings.com/tours/half-day-west-macdonnell-ranges)). Free Yulara airport shuttle | Scale; a "little bit softer" demand from Alice ([Al Jazeera](https://www.aljazeera.com/news/2024/11/12/in-australias-outback-youth-crime-stymies-efforts-to-get-tourism-on-track)) | DingoGo sells *private, 1–4 guests, EV, flexible timing* |
| **Emu Run Experience** | Day tours plus private charters ([Parks Australia](https://parksaustralia.gov.au/uluru/do/tours/emu-run-experience)) | Local incumbent | Partner for overflow |
| **RT Tours** (Aboriginal chef tours) | Cultural food tours ([Top4](https://www.top4.com.au/business/rt-tours-australia-aboriginal-chef-s-tours-87082)); price **[Unverified]** | Aboriginal-owned | **Partner, not competitor.** DingoGo provides the transport leg |
| **Earth Sanctuary** | Astro tours, dining, tailor-made Uluru tours; carbon-neutral venue ([Discover Central Australia](https://www.discovercentralaustralia.com/things-to-do/tours-activities/alice-springs/earth-sanctuary)); price **[Unverified]** | ~15 min from town | Package a "Dark Sky EV transfer" |
| **Uluru Aboriginal Tours / Anangu operators** | Pricing **[Unverified]** | Anangu-led | Transport partner at Yulara |
| **Ayers Rock Resort experiences** | e.g. Sunset BBQ dinner from $408/adult ([ARR](https://account.ayersrockresort.com.au/experiences/sunset-bbq-dinner)) | Premium price points | Shows the price premium the market accepts |

**Tour pricing guide [Assumption]:** private EV tour at $95–120/hour per vehicle (1–4 guests) with a 3-hour minimum, or $350–450 per half-day. Guide fees go to Traditional Owner partners where cultural content is delivered. DingoGo drivers should *drive and host*, not interpret culture, unless authorised.

### 2.4 NDIS transport

The Alice Springs NDIS market is described as a critical thin market ([CivicGraph](https://civicgraph.app/reports/disability/nt) **[Unverified]**). Participants get annual transport budgets of $1,606 / $2,472 / $3,456 (Levels 1–3) ([NDIA](https://www.ndis.gov.au/document/participant-transport-funding-informati)). Providers can claim activity-based transport at up to **$0.99/km** (standard vehicle) and travel time in MMM 6–7 remote zones "as agreed" ([Leapin](https://www.leapin.com.au/news/ndis-provider-travel-costs-activity-based-transport/)). Competitors are taxis (MPTs), Wheelies Private Hire, and support providers who drive participants themselves. **Positioning:** "NDIS-ready rides: invoiced straight to your plan manager, same driver each week." Unregistered providers can serve plan-managed and self-managed participants. NDIA-managed participants require registration **[Unverified for 2026 rules; check the NDIS Commission's registration reforms]**.

---

## 3. International comparables and lessons

| Comparable | What it is | Evidence | Lesson for DingoGo |
|---|---|---|---|
| **Revel (NYC)** | All-EV, all-employee rideshare | Shut down rideshare in Aug 2025 to focus on EV charging. Sold 165 for-hire plates worth an estimated $20–25k each. Charger utilisation 45% in early 2025, with Uber sending drivers to its chargers ([TechCrunch](https://techcrunch.com/2025/08/11/revel-shuts-down-its-ride-hail-business-to-focus-on-ev-charging)) | An **employee-driver EV fleet doesn't pay** even in NYC. The durable asset was charging. DingoGo should **own charging at its depot and sell charging to other EV drivers** (including Uber drivers) |
| **BluSmart (India)** | Asset-heavy EV ride-hailing, 8,000+ cars | Halted bookings in April 2025 after its fleet lessor/parent Gensol defaulted and was downgraded ([BBC via BHRRC](https://www.business-humanrights.org/fr/latest-news/blusmart-breakdown-how-ubers-ev-rival-in-india-collapsed/)) | Governance and leverage kill EV fleets. Keep **fleet finance separate from the platform company**, with independent audit |
| **The Drivers Cooperative (NYC)** | Driver-owned co-op | 15% commission. A $1 per-trip "Green Transition Surcharge" goes into driver EV accounts ([Drivers Coop](https://www.drivers.coop/pricing)) | Lower take plus driver ownership builds loyalty. DingoGo could offer **driver equity or profit-share** and a "$1 Country Fund" surcharge |
| **Ikwe Safe Rides (Winnipeg)** | Indigenous women-run safe-ride service for women | ~47,000 rides; bookings ~3,000/month; demand exceeds capacity; donation-based, volunteer shortfall ([CBC](https://www.cbc.ca/1.4606572)) | Culturally safe transport demand is real. **Donation and volunteer models don't scale.** DingoGo's paid and contracted model is the sustainable version |
| **Zoomo (AU)** | E-bike subscription for delivery riders | CEFC-backed raise ([CEFC](https://www.cefc.com.au/media/media-release/cefc-congratulates-zoomo-on-80m-raise/)) | **Vehicle-as-a-service for gig workers** is fundable by green finance. DingoGo's driver lease product should be pitched this way |
| **Liftango (AU)** | Demand-responsive transport (DRT) software and services | $11.36M raised ([CB Insights](https://www.cbinsights.com/compare/liftango-vs-tassielink)) | NT DRT tenders (e.g. a Sunday or after-hours Alice "bus") could go to DingoGo as an Aboriginal operator, possibly running on its own platform |
| **Via (US)** | Microtransit for governments | Example: a ~$22M deal for Elyria/Lorain, Ohio ([Mass Transit](https://www.masstransitmag.com/alt-mobility/shared-mobility/car-sharing/news/55302929/oh-22m-deal-keeps-ride-share-style-transit-rolling-in-elyria-and-lorain)) | Government-funded on-demand service is a real revenue line in low-density towns |
| **Firefly (US)** | Rooftop digital screens | Drivers paid ~$200–300/month for 40+ hours/week ([Firefly](https://www.fireflyon.com/drivers)). LA considered banning rooftop ads ([Rideshare Guy](https://therideshareguy.com/la-city-council-ban-digital-rooftop-advertising/)) | Benchmark: **advertiser revenue per car is likely $400–800/mo in metros [Unverified]** and much less in Alice. Check NT and council signage rules before fitting |
| **Screeny / Lumos (AU)** | In-car and car-top DOOH | Screeny expects drivers to make ">$1,000/yr" ([B&T](https://www.bandt.com.au/?p=1291548)). Lumos targeted 500 screens in Sydney/Melbourne ([DST](https://www.digitalsignagetoday.com/news/aussie-startup-lumos-rolls-out-car-top-dooh/)) | Australian benchmark is about $85–100/car/month to the driver. **Sell local packages directly** (Town Council, Parrtjima, Congress health campaigns) |
| **Uber One** | Subscription | $9.99/mo, 5% back in credits ([NewLifeInAus](https://newlifeinaus.com.au/uber-one-worth-it-australia/)) | The DingoGo Pass at $9.99 must offer *more* than 5%: e.g. waived booking fees, a free coffee, priority booking |
| **White-label platforms** | Yelowsoft: $99 / $250 / $999 per month ([Capterra](https://www.capterra.com/p/169474/Yelowsoft/pricing/)). Jugnoo: $5,999–7,999 one-off + $200/mo + $0.075–0.10/ride ([FitGap](https://us.fitgap.com/products/042158/jugnoo)) | | The proprietary platform's replacement value is only about **$6–12k plus $1–3k/yr**. Its strategic value lies in **NDIS invoicing, vouchers, cultural-safety and community features**, which off-the-shelf tools lack. Price SaaS licences to other communities at $500–1,500/mo |
| **Kinto** | Toyota mobility | Not researched | n/a |

---

## 4. Unit economics

### 4.1 Fare build and comparison

DingoGo tariff: $3 base + $1.60/km + $0.25/min, plus a $1 booking fee and the $1 NT levy. The **NT per-trip levy is $1, payable monthly by operators and ridesharing networks** ([nt.gov.au](https://nt.gov.au/cpv/levy)).

| Trip | Fare (base + km + min) | Rider pays (+$2) | Taxi day ($5.50 + $2.45/km) | Taxi night ($6.80 + $2.89/km) | DingoGo vs taxi |
|---|---|---|---|---|---|
| Town 6 km / 12 min | 3 + 9.60 + 3.00 = **$15.60** | **$17.60** | 5.50 + 14.70 = $20.20 | 6.80 + 17.34 = $24.14 | −13% day / −27% night |
| Town 5.5 km / 11 min | 3 + 8.80 + 2.75 = $14.55 | $16.55 | $18.98 | $22.70 | −13% / −27% |
| Airport 14 km / 16 min **[distance assumed]** | 3 + 22.40 + 4.00 = $29.40 | $31.40 | $39.80 + airport toll | $47.26 | −21% / −34% |

Taxi figures exclude waiting time, which DingoGo's per-minute charge roughly stands in for. **Weighted average fare** (85% town at 5.5 km, 15% airport): 0.85 × 14.55 + 0.15 × 29.40 = **$16.78 fare / $18.78 rider total**. This matches the earlier plan's ~$16.

### 4.2 Cost inputs (per car)

| Item | Value | Basis |
|---|---|---|
| Vehicle | BYD Dolphin Essential $29,990 / Premium $36,990 (before on-roads). Warranty 6 yr/150,000 km vehicle, 8 yr/160,000 km battery | [EVEE](https://www.evee.com.au/blog/2026-byd-dolphin-australia-price-specs-range/) |
| Lease | $113/wk = **$490/mo** | Brief (EV Direct Finance) **[Unverified]** |
| Energy | 16 kWh/100 km in desert conditions with charging losses **[Assumption]** × 31.68c/kWh Jacana standard residential (25.83c on time-of-use 9am–3pm) ([Jacana Energy 2026–27](https://jacanaenergy.com.au/residential/pricing)) → **$0.05/km** ($0.041 if charged 9–3) | |
| Maintenance & tyres | **$0.05/km** **[Assumption]** (ICE range $0.04–0.08 per [Peakifi](https://peakifi.com/income/side-income/uber-driver-australia/)) | |
| Insurance | **$3,000/yr** (rideshare comprehensive $1,400–2,200; commercial hire $2,500–4,000) | [National Cover](https://nationalcover.com.au/cheap-rideshare-insurance/) |
| CVL / licences | Rideshare licence $300/yr; H endorsement $117; operator accreditation $100 per 5 years ([NT fees](https://nt.gov.au/driving/industry/transport-industry-fees)). Additional motor accident compensation (MAC) cover required ([nt.gov.au](https://nt.gov.au/driving/industry/ridesharing/apply-to-use-your-vehicle-for-ridesharing)), assumed **$900/yr [Unverified]** → $1,200/yr | |
| EV concessions | Free registration and stamp duty waived on the first $50k (≤$1,500), **until 30 June 2027** | [Gridly](https://www.gridly.com.au/blog/nt-electric-car-rebate-2026) **[secondary]** |
| Payment processing | 1.75% + $0.30 per transaction **[Assumption]** | |
| Distance per ride | 6.78 paid km + 4 km dead-head = 10.78 km → **$1.08 variable cost per ride** | |
| Courier job | $14 average, 8 km → $0.80 variable cost **[Assumption]** | |
| Operating pattern | 26 days/month, 9 hours/day = **234 driver-hours/month** | |

### 4.3 Rides by daypart (base, Alice Springs)

| Daypart | Demand source | Rides/car |
|---|---|---|
| 5–9am | First flights, hospital shift change, commuters | 2.0 |
| 9am–3pm | Medical/NDIS appointments, shopping, government | 3.0 (+3 courier) |
| 3–7pm | School/work, afternoon arrivals | 2.5 (+1 courier) |
| 7pm–midnight | Dining, pubs, events, the Sunday gap with no bus | 2.5 |
| Midnight–5am | Not operated in Year 1 (driver safety) | 0 |
| **Total** | | **10 rides + 4 courier jobs** |

Engaged time is about 10 × 18 min + 4 × 20 min ≈ 4.3 h of a 9 h shift, so **utilisation is about 48%**.

### 4.4 Per-car monthly P&L under the current model (25% fee, driver leases car)

**Per-unit values.** Driver net per ride = 0.75 × 16.78 − 1.08 = **$11.51**. Platform net per ride = 0.25 × 16.78 + $1 − (0.0175 × 18.78 + 0.30) = 4.195 + 1 − 0.63 = **$4.57**. Courier job: driver 10.50 − 0.80 = $9.70; platform 3.50 − 0.55 = $2.95. Ads are split 50/50.

| Per car / month | Bear (6 rides, 2 courier, $0 ads) | Base (10, 4, $300) | Bull (16, 6, $600) |
|---|---|---|---|
| Rides / courier jobs | 156 / 52 | 260 / 104 | 416 / 156 |
| Gross bookings (rider-paid incl. fees) | 156 × 18.78 + 52 × 14 = $3,658 | $6,339 | $9,997 |
| **Driver** ride net | 156 × 11.51 = $1,795 | $2,993 | $4,788 |
| Driver courier net | $504 | $1,009 | $1,513 |
| Driver ad share | $0 | $150 | $300 |
| Driver fixed costs (lease 490 + insurance 250 + licences 100 + phone/cleaning 115) | −$955 | −$955 | −$955 |
| **Driver net / month** | **$1,344** | **$3,197** | **$5,646** |
| **Driver net / hour (234 h)** | **$5.74** | **$13.66** | **$24.13** |
| **Platform** ride contribution | 156 × 4.57 = $713 | $1,188 | $1,901 |
| Platform courier contribution | $153 | $307 | $460 |
| Platform ad share | $0 | $150 | $300 |
| **Platform contribution / car** | **$866** | **$1,645** | **$2,661** |

**Regulatory benchmark:** from 17 Aug 2026 the Fair Work minimum standards order for **on-demand food and grocery delivery** sets a floor of **$32.00 per engaged hour for cars** ([Fair Work Ombudsman](https://www.fairwork.gov.au/newsroom/media-releases/2026-media-releases/august-2026/20260817-minimum-standards-for-delivery-drivers-media-release)). A **rideshare order** was applied for on 17 Dec 2025 (MS2025/3, directions hearing 17 Feb 2026). **Last-mile parcel** orders (MS2024/1–2) were heard in July–August 2026 ([FWC quarterly update](https://www.fwc.gov.au/documents/resources/regulated-worker-quarterly-update-2026-02-06.pdf); [TWU](https://www.twu.com.au/wp-content/uploads/2026/02/Rideshare-Fair-Work-update.pdf)). Outcomes as of Nov 2026: **[Unverified]**. DingoGo's parcel courier work is probably *outside* the food-delivery order but could fall under a last-mile order. Budget for an engaged-time floor of about $30–32/hr.

**Platform break-even (3 cars).** Year 1 fixed costs **[Assumption]**: tech/hosting/maps/SMS $450, insurance (public liability, PI, cyber) $400, marketing $1,500, accounting/legal $700, 0.5 FTE support/dispatch $2,800, depot/charging $300. Total **$6,150/mo, founders unpaid**.
- Non-ride contribution per car (base) = 307 + 150 = $457, so × 3 = $1,371.
- Each ride/car/day adds 26 × 4.57 = $118.82 per car per month, so × 3 = $356.46.
- Break-even = (6,150 − 1,371) / 356.46 = **13.4 rides per car per day**.
- Paying two founders $60k each (+$10k/mo) pushes break-even to ~41 rides/car/day, which is **impossible with 3 cars**.

**Driver break-even.** For $25/hr net ($5,850/mo): rides needed = (5,850 + 955 − 1,009 − 150) / (26 × 11.51) = 5,646 / 299.3 = **18.9 rides/day**.

### 4.5 Recommended "optimised" model (Year 1, 3 cars)

The changes:
1. Raise per-km to **$1.85** (6 km town trip = $19.10 rider total, still about 5% below the day taxi meter).
2. Add a night/weekend uplift of +15%, an airport flat fare of $35, and a $10 minimum fare. These are not modelled below, so the figures are conservative.
3. Sell **contracted hourly work at $80/hr** (driver gets 70%) for an average of **2 hours/car/day**: health discharge, NDIS, ACCO staff, corporate.
4. Courier drops to 3 jobs/day because contract work takes some of that midday time.

| Per car / month | Optimised base |
|---|---|
| Avg fare | 16.78 + 0.25 × 6.78 = **$18.48** |
| Driver: 260 rides × (0.75 × 18.48 − 1.08 = 12.78) | $3,323 |
| Driver: 52 contract hours × $56 − km cost (52 × 30 km × $0.10 = $156) | $2,756 |
| Driver: 78 courier jobs × $9.70 + ad share $150 − fixed $955 | −$48 |
| **Driver net** | **$6,031 = $25.77/hr** |
| Platform: 260 × (4.62 + 1 − 0.66 = 4.96) | $1,290 |
| Platform: 52 contract hours × $80 × 30% | $1,248 |
| Platform: courier 78 × 2.95 + ads $150 | $380 |
| **Platform contribution / car** | **$2,918** |
| **3 cars − $6,150 fixed** | **+$2,604/mo (~+$31k/yr), founders unpaid** |

### 4.6 Scenario summary

**Year 1, 3 cars (current tariff, founders unpaid).** Company-level extras (tours, corporate margin, Pass) are $0 / $2,800 / $4,500 per month **[Assumption]**.

| | Bear | Base | Bull | Optimised base |
|---|---|---|---|---|
| Platform contribution | $2,598 | $4,935 | $7,983 | $8,754 |
| Company extras | $0 | $2,800 | $4,500 | $2,800 |
| Fixed | −$6,150 | −$6,150 | −$6,150 | −$6,150 |
| **Monthly result** | **−$3,552** | **+$1,585** | **+$6,333** | **+$5,404** |
| Annual | −$42.6k | +$19.0k | +$76.0k | +$64.8k |

**Year 3, 10 cars.** Fixed costs are $23,500/mo **[Assumption]**: 2.5 FTE including a paid founder-CEO, tech $1k, insurance $1.2k, marketing $3k, admin $1.5k, depot $0.8k. Diversified revenue (tours, health/corporate contracts, Pass, one SaaS licence) is $5.65k / $11.3k / $16.95k per month.

| | Bear | Base | Bull | Optimised base |
|---|---|---|---|---|
| Platform contribution | 10 × 866 = $8,660 | $16,450 | $26,610 | $29,180 |
| Diversified | $5,650 | $11,300 | $16,950 | $11,300 |
| Fixed | −$23,500 | −$23,500 | −$23,500 | −$23,500 |
| **Monthly result** | **−$9,190** | **+$4,250** | **+$20,060** | **+$16,980** |
| Annual | −$110k | +$51k | +$241k | +$204k |
| GMV (rides + courier) | ~$439k | ~$761k | ~$1.2M | ~$880k |

**Sensitivities (base case, per car per month):**
- ±1 ride/day = ±$119 platform, ±$299 driver.
- ±$0.10/km = ±$44 platform, ±$132 driver.
- Electricity ±10c/kWh changes driver cost by about ±$45/mo. Energy is not the risk.
- Insurance +$1,500/yr = −$125/mo to the driver.

The dominant variables are **rides per day and contracted hours**.

---

## 5. Revenue diversification (ranked by margin and feasibility)

| Rank | Stream | Gross margin to DingoGo | Feasibility (12 mo) | Notes |
|---|---|---|---|---|
| 1 | **Health and ACCO contracted transport** (NT Health discharge and outpatient overflow, Congress, Tangentyere, Purple House, aged care) | 25–35% of $70–90/hr | **High** | ~84% of Alice Springs Hospital patients are Aboriginal ([NT RG](https://ruralgeneralist.nt.gov.au/the-territory/training-locations/alice-springs-hospital)). PATS assists patients >75 km from specialist services ([nt.gov.au PATS](https://nt.gov.au/wellbeing/health-subsidies-support-and-home-visits/patient-assistance-travel-scheme)), so the in-town legs from airport and accommodation are the opening. Use IBA **performance bonds and invoice finance** to win and fund contracts ([IBA](https://iba.gov.au/business/finance)) |
| 2 | **NDIS plan-managed rides** | 25% + booking fee; invoicing is automated | High | Thin market; budgets of $1.6–3.5k/participant/yr. Offer a "same driver" roster |
| 3 | **Corporate and government accounts** | 25% + monthly account fee | High | IPP 3% → 4% target ([NIAA](https://niaa.gov.au/our-work/employment-and-economic-development/indigenous-procurement-policy-changing)). Get Supply Nation-certified now and get verified under the new 51% ownership-and-control test |
| 4 | **B2B courier: pharmacies, pathology, government mail, retail** | 25–30% | High | Webster packs; no Uber Direct-style activation fee |
| 5 | **Private cultural/scenic tours** (with Traditional Owner partners) | 30–40% | Medium | Tourism NT Aboriginal tourism grants ([Tourism NT](https://www.tourismnt.com.au/industry-toolkit/grants-funding/aboriginal-tourism-development-support-grant-program)) |
| 6 | **Tourism partnerships** (hotels, Tourism Central Australia, airport, Voyages/Yulara) | Commission or retainer | Medium | Airport rank or pickup access needs an airport agreement **[Unverified terms]** |
| 7 | **Events** (Parrtjima, Finke, NATS, Show): flat-rate shuttles | 30%+ | Medium | Pre-sold event passes; surge-free pricing as a brand promise |
| 8 | **Depot charging resale** | 40–60% on c/kWh | Medium | The Revel lesson. Sell charging to Uber EV drivers when they arrive |
| 9 | **Rooftop LED advertising** | ~50% after driver share | Medium-low | ~$300–600/car/mo locally **[Assumption]**. Check signage and vehicle standards rules first |
| 10 | **School runs** | 25% | Medium-low | Requires Working With Children checks for all drivers and parent trust. School buses exist ([NT](https://nt.gov.au/driving/public-transport-cycling/public-school-buses/alice-springs-timetables-and-maps)) |
| 11 | **DingoGo Pass** ($9.99/mo) | ~70% after perks | Medium | Café partners fund the free coffee. Target 2–5% of active riders |
| 12 | **Platform licensing / SaaS** to remote and Indigenous communities and private-hire operators | 80%+ | Low in Y1, medium in Y2–3 | Price at $500–1,500/mo per community, against Yelowsoft's $99–999 benchmark. The edge is NDIS, vouchers and community features |
| 13 | **Carbon credits** | n/a | **Not available** | ACCU Land and Sea Transport method expired 31 Mar 2025 ([CER](https://cer.gov.au/schemes/australian-carbon-credit-unit-scheme/accu-scheme-methods/land-and-sea-transport-method-closed)). Instead, sell **Scope 3 emissions reporting** (trip-level CO2 avoided) to corporate clients as a value-add |

---

## 6. Funding and capital

### 6.1 Sources current in 2026

| Source | What | Fit |
|---|---|---|
| **IBA Start-Up Finance Package** | Loans up to **$150k**, 7-year max term, **up to 30% as grant** for capital expenditure; for businesses trading under 2 years, ≥50% Indigenous-owned ([IBA](https://iba.gov.au/business/finance)) | Vehicles, charging, fit-out |
| **IBA invoice finance and performance bonds** | Up to 80% of invoice value; bonds without 100% cash deposits | Health and government contracts |
| **Aboriginal Investment NT (AINT)** | Start-up grant up to **$100k**; growth grant up to **$150k** ([NT Business](https://business.nt.gov.au/help-for-business/support-for-nt-aboriginal-businesses/grants-and-programs-for-aboriginal-business)). Round 3 opened 17 Nov 2025 on a rolling basis ([NIT](https://nit.com.au/16-10-2025/20768/aboriginal-investment-nt-grants-aim-to-ignite-growth-and-opportunity)) | **Apply now.** Check whether funding remains |
| **NT Government business programs** | Business development up to $30k; matched advisor funding up to $10k; start-up/entrepreneur up to $30k ([NT Business](https://business.nt.gov.au/help-for-business/support-for-nt-aboriginal-businesses/grants-and-programs-for-aboriginal-business)) | Marketing, advisory |
| **Tourism NT Aboriginal Tourism Development grants** | Amount not stated ([Tourism NT](https://www.tourismnt.com.au/industry-toolkit/grants-funding/aboriginal-tourism-development-support-grant-program)) | Tour product build |
| **NT EV concessions** | Free registration plus a stamp duty concession until 30 Jun 2027 | Buy cars before June 2027 |
| **CEFC-backed green loans** | e.g. 1 percentage point discount through VW Financial Services ($100M) ([CEFC](https://www.cefc.com.au/media/media-release/cefc-invests-to-accelerate-ev-uptake-for-small-businesses-and-households/)) | Not BYD-specific. Ask EV Direct Finance and banks about CEFC co-funded rates **[Unverified for BYD]** |
| **ARENA / NIAA IAS** | IAS funds organisations' outcomes ([business.gov.au](https://business.gov.au/grants-and-programs/indigenous-advancement-strategy)). ARENA programs not checked **[Unverified]** | IAS for driver training and employment (jobs for Aboriginal drivers) |
| **Procurement** | Commonwealth IPP target 3% (from 1 Jul 2025) rising 0.25pp a year to 4% (2029–30). From 1 Jul 2026 the definition is 51% owned **and controlled**, with a new verification provider during 2026–27 ([NIAA](https://niaa.gov.au/our-work/employment-and-economic-development/indigenous-procurement-policy-changing)) | Ownership (Ah Chee + Bartlett) must meet 51% ownership and control. **Confirm the cap table and governance documents.** |
| **Investors** | Indigenous impact funds, regional angels, Territory family offices, strategic partners (Voyages/ILSC, ACCOs, a BYD dealer) **[names unverified]** | Equity only after contracts prove demand |

### 6.2 How much and when

| Stage | Amount | Mix | Milestones to unlock |
|---|---|---|---|
| **Seed (now to month 6)** | **$200–250k** | IBA package $150k (≤$45k grant) + AINT start-up grant (≤$100k) + NT $10–30k | 3 cars live; 300 active riders/month; 1 health or ACCO contract; NDIS invoicing live; Supply Nation listed |
| **Growth (months 9–15)** | **$0.6–1.0M** | AINT growth $150k + IBA growth loan + asset finance (cars off balance sheet, held in a separate FleetCo) + $250–400k impact equity | ≥13 rides/car/day **or** ≥2 contracted hours/car/day; 2+ contracts worth ≥$150k/yr; positive monthly contribution 3 months in a row |
| **Scale (Year 2–3)** | $1.5–2.5M | Debt for fleet; equity for SaaS and new markets | 10 cars Alice; Yulara pilot via Voyages; Tennant contract car; first SaaS licensee |

---

## 7. Go-to-market

### 7.1 Positioning statements

- **Brand:** *"DingoGo. Local wheels, local hands. Aboriginal-owned, 100% electric, always on time."*
- **Riders:** *"A safe, clean, quiet ride with a driver who knows Mparntwe. Book now, book ahead, or pay with a voucher. No surge, ever."*
- **Institutions:** *"Culturally safe, reliable transport for your clients and staff, invoiced the way you need, delivered by a verified Indigenous enterprise that counts towards your procurement targets."*
- **Drivers:** *"Drive local, earn more of the fare, and own your future in an EV."*

### 7.2 90-day launch plan

| Days | Actions |
|---|---|
| **−30 to 0 (pre-launch)** | Finish CVL, H endorsements, CPV ID cards, insurance and MAC cover ([nt.gov.au](https://nt.gov.au/driving/industry/ridesharing/apply-to-use-your-vehicle-for-ridesharing)). Register for the levy portal. Supply Nation and NDIS readiness. Sign 3–5 café partners. Line up Alice Springs Airport and hotel concierges. Pitch to Congress, Tangentyere, NT Health Central Australia, Town Council and Tourism Central Australia. Recruit 4–6 drivers (two shifts per car), prioritising local Aboriginal drivers. Run cultural-safety and disability-assist training |
| **1–30 (soft launch)** | Invite-only beta for 500 riders. **"First ride free up to $15"** and a **"<10-minute pickup or $5 credit"** guarantee. Daily phone-booking line. Voucher sales through Centrelink-adjacent outlets, stores and ACCOs. Target 8 rides/car/day |
| **31–60 (public launch)** | Launch event with Elders' blessing and local media (ABC Alice, CAAMA, Alice Springs News). Airport "Airport for two" promo. Sunday "bus gap" campaign. First corporate accounts (hospital staff, government). Courier pilot with 3 pharmacies. Target 10 rides plus 3 courier jobs |
| **61–90 (lock-in)** | First contract signed (health, ACCO or NDIS provider). DingoGo Pass launch. Rooftop ad sales to the first 3 local advertisers. Pre-sell a tours package for the cool season. Publish an impact dashboard (Aboriginal jobs, kg CO2 avoided). Prepare pre-emptive moves for Uber's launch: lock in exclusive hotel and airport partnerships and run a rider referral scheme |

### 7.3 Channels and partnerships

ACCOs (Congress, Tangentyere, Lhere Artepe, CLC **[relationships to confirm]**), NT Health discharge lounge, NDIS plan managers and support coordinators, hotels and the casino, Tourism Central Australia's new visitor centre ($4.8M funded ([NT Budget](https://budget.nt.gov.au/__data/assets/pdf_file/0006/1514985/central-australia-factsheet.pdf))), airport, events (Parrtjima, Finke, NATS, Show), CAAMA radio, Facebook community groups, and café partners.

### 7.4 KPIs

| Category | KPI | Y1 target |
|---|---|---|
| Demand | Rides/car/day, by daypart | ≥10 (M3), ≥13 (M8) |
| Reliability | Median pickup ETA; % pickups <10 min; cancellation rate | <8 min; >85%; <5% |
| Supply | Driver net $/hr; driver retention at 90 days; online hours per car | ≥$25; ≥75%; ≥14 h/day (2 shifts) |
| Mix | % revenue from contracts, NDIS and corporate | ≥30% by M9 |
| Economics | Platform contribution per car per month; CAC; payback | ≥$2,000; <$15; <2 months |
| Customers | Monthly active riders; % repeat; NPS | 1,000; ≥50%; ≥60 |
| Impact | Aboriginal drivers employed; CO2 avoided | ≥50% of drivers; reported monthly |
| Fleet | km/car/month; battery state of health; charger uptime | Track against the 160,000 km battery warranty |

---

## 8. Key risks

| Risk | Likelihood / impact | Mitigation |
|---|---|---|
| **Uber launch** with promotions | High / High | Institutional lock-in (contracts), bookable rides, vouchers and phone booking, no surge. Option: put DingoGo supply on Uber later |
| **Driver income below viable levels** | High / High | The optimised model (§4.5): contract hours, double-shifting, pricing tune-up, driver profit-share |
| **Fair Work minimum standards** (rideshare MS2025/3; last-mile MS2024/1–2) | Medium / Medium | Design pay around ~$32 per engaged hour now. Keep engaged-time logs in the platform |
| **Safety / anti-social behaviour at night**; vehicle theft | Medium / High | No midnight–5am in Y1; in-car cameras; panic button; depot parking; women-driver option |
| **Tourism softness and air capacity** (Qantas MEL–ASP suspended) | Medium / Medium | Weight the business towards resident and institutional demand |
| **EV heat and battery wear**; 160,000 km battery warranty | Medium / Medium | Charge on time-of-use 9am–3pm (shaded or solar); plan to sell or replace cars at ~150,000 km; consider extended warranty |
| **Insurance availability** for rideshare plus courier | Medium / High | Broker-led fleet policy; consider Vero's pay-per-km model for comparison |
| **Ownership and control compliance** (IPP 51%) | Low / High | Shareholder agreement and governance documents before applying for verification |
| **Key-person / founder bandwidth** | Medium / High | Fund 0.5 FTE operations from seed |
| **Regulatory: platform licensing**, levy remittance | Low / Medium | Monthly levy lodgement automated in the admin panel |

---

## 9. SWOT

| **Strengths** | **Weaknesses** |
|---|---|
| Aboriginal-owned (procurement and cultural trust) · first local rideshare in Alice · 100% EV, quiet and clean · own platform with NDIS invoicing, vouchers and pets · local knowledge · low fixed cost base | 2–3 cars means thin coverage and long waits at peak · unproven driver economics at 25% fee · no brand among tourists · founder bandwidth · small balance sheet |
| **Opportunities** | **Threats** |
| Taxi waits of 35 min · no Sunday buses · NDIS thin market · IPP target rising to 4% · Menulog exit · Yulara has no taxis · depot charging resale · SaaS for other communities · NT EV concessions until Jun 2027 | Uber's imminent launch · Fair Work minimum standards · tourism decline and air capacity cuts · crime and safety perceptions · insurance cost · battery wear at high mileage |

---

## 10. Where DingoGo wins

1. **Institutional transport that Uber won't build:** NDIS invoicing, health discharge, ACCO client and staff transport, voucher and cash access for unbanked riders, phone booking. These are booked, recurring, higher-margin hours, and they fix driver economics.
2. **Procurement advantage:** a verified Indigenous enterprise that counts towards a 3–4% target. Every government and corporate buyer in Central Australia has a reason to choose DingoGo over Uber.
3. **Reliability against the taxi incumbent:** a sub-10-minute promise against a 35-minute average wait, with fares 13–27% below the meter.
4. **Premium visitor niches:** private EV cultural tours with Traditional Owner partners, "Airport for two," and Yulara transfers where no taxis operate.
5. **Platform as an asset:** licence the stack (with NDIS, vouchers and community features) to other remote and Indigenous communities and private-hire operators. Off-the-shelf white-label tools cost about $100–1,000/month but lack these features.

**Bottom line:** launch the 3 cars as planned, but **sell hours to institutions before selling rides to the public**. Tune the tariff to about $1.85/km with a night uplift. Get the non-dilutive IBA and AINT money now. Raise growth capital only after two contracts and 13+ rides/car/day are proven, which is likely by months 8–10.
