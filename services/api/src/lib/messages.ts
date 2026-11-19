/**
 * Every message DingoGo sends to people — in-app inbox, push and SMS — in one place, so wording stays consistent and plain.
 *
 * Rules: plain Australian English, no emoji, name DingoGo in every text (the sender ID may be a number). SMS text uses only the
 * GSM-7 alphabet (straight quotes, hyphens): one curly quote or dash turns a text into UCS-2 and halves its length.
 * Categories decide which notification settings apply (see services/prefs.ts); `safety` can't be switched off.
 * SMS kinds: `essential` texts go even to numbers that replied STOP (sign-in codes the person just asked for, SOS to an emergency
 * contact); `transactional` texts are skipped for those numbers; `marketing` texts need consent and a number that takes replies.
 */
export type Category = 'trip' | 'chat' | 'account' | 'documents' | 'safety' | 'promo';
export type SmsKind = 'essential' | 'transactional' | 'marketing';
export interface Rendered { title?: string; body?: string; sms?: string }
interface Template<V> { category: Category; smsKind?: SmsKind; render: (v: V) => Rendered }
const t = <V>(x: Template<V>) => x;

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export const templates = {
  // ── Sign-in and safety (SMS) ──
  otp: t<{ code: string }>({ category: 'account', smsKind: 'essential',
    render: (v) => ({ sms: `Your DingoGo code is ${v.code}. It expires in 10 minutes. Never share this code.` }) }),
  sos_contact: t<{ name: string; ref: string; url: string }>({ category: 'safety', smsKind: 'essential',
    render: (v) => ({ sms: `DingoGo SAFETY ALERT: ${v.name} triggered an emergency alert on trip ${v.ref}. Live location: ${v.url}` }) }),

  // ── Parcels (SMS to people who may not have the app) ──
  parcel_recipient: t<{ sender: string; ref: string; url: string; pin: string }>({ category: 'trip', smsKind: 'transactional',
    render: (v) => ({ sms: `DingoGo: ${v.sender} is sending you a parcel (${v.ref}). Track it: ${v.url} - give the driver PIN ${v.pin} on delivery.` }) }),
  parcel_delivered_sender: t<{ ref: string; to: string }>({ category: 'trip', smsKind: 'transactional',
    render: (v) => ({ sms: `DingoGo: parcel ${v.ref} delivered to ${v.to}.` }) }),
  // Round 11: booked with a pickup window; on its way with an ETA; couldn't be delivered; back with the sender.
  parcel_recipient_booked: t<{ sender: string; ref: string; url: string; pin: string; when: string }>({ category: 'trip', smsKind: 'transactional',
    render: (v) => ({ sms: `DingoGo: ${v.sender} is sending you a parcel (${v.ref}), collected ${v.when}. Track it: ${v.url} - give the driver PIN ${v.pin} on delivery.` }) }),
  // Round 12: an organisation booking rides for a client. The client is told, and how to stop it.
  client_consent_recorded: t<{ org: string }>({ category: 'account', smsKind: 'transactional',
    render: (v) => ({
      title: `${v.org} can book rides for you`,
      body: `${v.org} can now book DingoGo rides for you. To stop this, go to Account, Organisations, or call DingoGo.`,
      sms: `DingoGo: ${v.org} can now book rides for you. You'll get a text for each trip. To stop this, call DingoGo or use the app (Account, Organisations).`,
    }) }),
  concession_reviewed: t<{ approved: boolean; note: string | null }>({ category: 'account',
    render: (v) => v.approved
      ? { title: 'Concession fares are on', body: 'Your concession card is checked. Concession prices show when you book.' }
      : { title: 'Concession card not approved', body: `We couldn't approve your concession card${v.note ? `: ${v.note}` : ''}. You can send it again in Account.` } }),
  // Round 13: driver applicants from the website (they have no account yet, so texts only) get a private status link.
  driver_application_received: t<{ ref: string; url: string }>({ category: 'account', smsKind: 'transactional',
    render: (v) => ({ sms: `DingoGo: thanks for applying to drive (ref ${v.ref}). We'll call you within a few days. See where it's up to: ${v.url}` }) }),
  driver_application_update: t<{ ref: string; stage: string; url: string }>({ category: 'account', smsKind: 'transactional',
    render: (v) => ({ sms: `DingoGo: your driver application ${v.ref} is now at "${v.stage}". Details: ${v.url}` }) }),
  ride_booked_for_you: t<{ org: string; ref: string; when: string; pickup: string }>({ category: 'trip', smsKind: 'transactional',
    render: (v) => ({
      title: 'Ride booked for you',
      body: `${v.org} booked ride ${v.ref} for you, ${v.when}, from ${v.pickup}.`,
      sms: `DingoGo: ${v.org} booked ride ${v.ref} for you, ${v.when}, from ${v.pickup}. We'll text when your driver is on the way.`,
    }) }),
  parcel_on_way: t<{ sender: string; ref: string; eta: string; url: string; safe_place: string | null }>({ category: 'trip', smsKind: 'transactional',
    render: (v) => ({ sms: `DingoGo: your parcel from ${v.sender} (${v.ref}) is on its way, arriving about ${v.eta}.${v.safe_place ? ` If you're out it will be left: ${v.safe_place}.` : ''} Track: ${v.url}` }) }),
  parcel_failed_recipient: t<{ sender: string; ref: string; reason: string }>({ category: 'trip', smsKind: 'transactional',
    render: (v) => ({ sms: `DingoGo: we couldn't deliver your parcel from ${v.sender} (${v.ref}): ${v.reason}. It is going back to the sender, who will be in touch.` }) }),
  parcel_failed_sender: t<{ ref: string; to: string; reason: string; fee_cents: number }>({ category: 'trip', smsKind: 'transactional',
    render: (v) => ({
      title: 'Parcel not delivered',
      body: `${v.ref} to ${v.to}: ${v.reason}. The driver is bringing it back to you${v.fee_cents > 0 ? ` (return ${money(v.fee_cents)})` : ''}. Book another try from the trip.`,
      sms: `DingoGo: parcel ${v.ref} to ${v.to} couldn't be delivered (${v.reason}). The driver is bringing it back to you.`,
    }) }),
  parcel_returned_sender: t<{ ref: string; to: string }>({ category: 'trip', smsKind: 'transactional',
    render: (v) => ({ title: 'Parcel returned', body: `${v.ref} for ${v.to} is back with you. Book another try from the trip.`, sms: `DingoGo: parcel ${v.ref} for ${v.to} has been returned to you.` }) }),

  // ── Rider trip updates (texted too for phone bookings, or when the rider asks for texts) ──
  driver_on_way: t<{ again: boolean; driver: string; colour: string; make: string; model: string; rego: string; eta_min: number }>({ category: 'trip', smsKind: 'transactional',
    render: (v) => ({
      title: v.again ? 'New driver on the way' : 'Driver on the way',
      body: `${v.driver} is coming in a ${v.colour} ${v.make} ${v.model} (${v.rego}). ETA ${v.eta_min} min.`,
      sms: `DingoGo: ${v.driver} is on the way in a ${v.colour} ${v.make} ${v.model}, rego ${v.rego}. About ${v.eta_min} min.`,
    }) }),
  driver_here: t<{ ride: boolean; rego: string; pin: string; ref: string }>({ category: 'trip', smsKind: 'transactional',
    render: (v) => ({
      title: 'Your driver is here',
      body: v.ride ? `Look for ${v.rego}. Your trip PIN is ${v.pin}.` : `Driver has arrived to collect parcel ${v.ref}.`,
      sms: v.ride ? `DingoGo: your driver is here. Look for rego ${v.rego}. Your trip PIN is ${v.pin}.` : `DingoGo: your driver is here to collect parcel ${v.ref}.`,
    }) }),
  no_drivers: t<{ ref: string; missed: boolean }>({ category: 'trip', smsKind: 'transactional',
    render: (v) => ({
      title: 'No drivers available',
      body: v.missed
        ? `Sorry, we couldn't get a driver to you in time for your booking ${v.ref}. You have not been charged. Call us and we'll help.`
        : `Sorry, no DingoGo cars are free right now for ${v.ref}. You have not been charged.`,
      sms: v.missed
        ? `DingoGo: sorry, we couldn't get a driver to you in time for booking ${v.ref}. You have not been charged. Call us and we'll help.`
        : `DingoGo: sorry, no cars are free right now for ${v.ref}. You have not been charged.`,
    }) }),
  booking_released: t<{ ref: string }>({ category: 'trip',
    render: (v) => ({ title: 'Finding your driver', body: `We're now matching a driver for your booked trip ${v.ref}.` }) }),
  booking_card_declined: t<{ ref: string; reason?: string | null }>({ category: 'trip', smsKind: 'transactional',
    render: (v) => ({
      title: 'Booking cancelled: card declined',
      body: `We couldn't hold the fare for your booking ${v.ref}. ${v.reason ?? ''} You have not been charged. Book again with another card or DingoGo credit, or call us.`.replace(/\s+/g, ' '),
      sms: `DingoGo: we couldn't hold the fare on your card for booking ${v.ref}, so it is cancelled. You have not been charged. Please book again or call us.`,
    }) }),
  finding_another_driver: t<{ ref: string }>({ category: 'trip', smsKind: 'transactional',
    render: (v) => ({
      title: 'Finding you another driver',
      body: `Your driver couldn't make it to ${v.ref}, so we're finding you another one. Your booking and price stay the same, with no extra charge.`,
      sms: `DingoGo: your driver couldn't make it, so we're finding you another one for ${v.ref}. Same price, no extra charge.`,
    }) }),
  driver_cancelled: t<{ ref: string }>({ category: 'trip', smsKind: 'transactional',
    render: (v) => ({
      title: 'Driver cancelled',
      body: `Your driver had to cancel ${v.ref}. You have not been charged. Book again and we'll find you another car.`,
      sms: `DingoGo: your driver had to cancel ${v.ref}. You have not been charged. Book again and we'll find you another car.`,
    }) }),
  trip_done: t<{ ref: string; courier: boolean; cents: number }>({ category: 'trip',
    render: (v) => ({ title: v.courier ? 'Parcel delivered' : 'Thanks for riding DingoGo', body: `${v.ref}: ${money(v.cents)} incl. GST. Your tax invoice is in the app.` }) }),
  route_check: t<{ ref: string }>({ category: 'safety',
    render: (v) => ({ title: 'Is everything OK?', body: `Your trip ${v.ref} has gone off the usual route. Tap to share your trip or get help.` }) }),

  // ── Round 14: safety and trust ──
  safety_check: t<{ ref: string; reason: 'long_stop' | 'route_deviation' | 'ops'; minutes: number }>({ category: 'safety',
    render: (v) => ({
      title: 'Are you OK?',
      body: `${v.reason === 'long_stop' ? `Your car has been stopped for a while on ${v.ref}.` : v.reason === 'route_deviation' ? `Your trip ${v.ref} has gone off the usual route.` : `DingoGo is checking in on ${v.ref}.`} Tap "I'm OK" or "Get help". If we don't hear back in ${v.minutes} min, our team will check on you.`,
    }) }),
  trip_shared: t<{ name: string; driver: string; car: string; rego: string; url: string }>({ category: 'safety', smsKind: 'transactional',
    render: (v) => ({ sms: `DingoGo: ${v.name} shared their ride with you. Driver ${v.driver}, ${v.car}, rego ${v.rego}. Follow it live: ${v.url}` }) }),
  check_in_escalated_contact: t<{ name: string; ref: string; url: string }>({ category: 'safety', smsKind: 'essential',
    render: (v) => ({ sms: `DingoGo SAFETY: ${v.name} asked for help or didn't answer a safety check on trip ${v.ref}. Our team is checking now. Live location: ${v.url} If they are in danger call 000.` }) }),
  fatigue_warning: t<{ minutes: number; kind: 'daily_limit' | 'break' }>({ category: 'safety',
    render: (v) => ({ title: v.kind === 'break' ? 'Break coming up' : 'Daily limit coming up', body: `About ${v.minutes} min until ${v.kind === 'break' ? 'your break' : 'your daily limit'}. After that you'll be set offline once your trip ends.` }) }),
  fatigue_offline: t<{ kind: 'daily_limit' | 'break'; until: string; hours: string }>({ category: 'safety',
    render: (v) => ({ title: v.kind === 'break' ? 'Time for a break' : 'Time to rest', body: `You've been online ${v.hours}. We've set you offline. You can go online again from ${v.until}.` }) }),
  identity_check_reviewed: t<{ approved: boolean; note: string | null }>({ category: 'safety',
    render: (v) => v.approved
      ? { title: 'Photo check approved', body: 'Thanks. Your photo check is approved.' }
      : { title: 'Photo check not accepted', body: `We couldn't match your photo to your account${v.note ? `: ${v.note}` : ''}. Take a new photo before going online, or call DingoGo.` } }),
  incident_received: t<{ ref: string; critical: boolean }>({ category: 'safety',
    render: (v) => ({ title: 'We got your safety report', body: `Report ${v.ref}: our safety team will look at it${v.critical ? ' today and may call you' : ' and get back to you'}. In danger now? Call 000.` }) }),
  incident_update: t<{ ref: string; outcome: string | null }>({ category: 'safety',
    render: (v) => ({ title: 'Your safety report', body: `We've finished looking into report ${v.ref}.${v.outcome ? ` ${v.outcome}` : ''} Thanks for telling us.` }) }),
  account_restricted: t<{ kind: 'suspend' | 'ban'; reason: string; until: string | null }>({ category: 'account', smsKind: 'transactional',
    render: (v) => ({
      title: v.kind === 'ban' ? 'Your account is closed' : 'Your account is on hold',
      body: `${v.reason}${v.until ? ` Until ${v.until}.` : ''} You can ask us to look again from the sign-in screen.`,
      sms: `DingoGo: your account is ${v.kind === 'ban' ? 'closed' : 'on hold'}${v.until ? ` until ${v.until}` : ''}. ${v.reason} To ask us to look again, sign in to the DingoGo app.`,
    }) }),
  account_restored: t<Record<string, never>>({ category: 'account', smsKind: 'transactional',
    render: () => ({ title: 'Your account is active again', body: 'You can use DingoGo again.', sms: 'DingoGo: your account is active again. You can sign in and use the app.' }) }),
  appeal_decided: t<{ overturned: boolean; note: string | null }>({ category: 'account', smsKind: 'transactional',
    render: (v) => ({
      title: v.overturned ? 'Appeal accepted' : 'Appeal decided',
      body: v.overturned ? 'We looked again and your account is active.' : `We looked again and the decision stays.${v.note ? ` ${v.note}` : ''}`,
      sms: v.overturned ? 'DingoGo: we looked again at your appeal and your account is active.' : 'DingoGo: we looked again at your appeal and the decision stays. Sign in to the app for details.',
    }) }),

  // ── Rider account ──
  payment_failed: t<{ ref: string; cents: number; reason?: string | null }>({ category: 'account',
    render: (v) => ({ title: 'Payment didn\'t go through', body: `We couldn't take ${money(v.cents)} for ${v.ref}. ${v.reason ?? ''} Open the trip to pay.`.replace(/\s+/g, ' ').trim() }) }),
  refund_issued: t<{ ref: string; cents: number; reason: string }>({ category: 'account',
    render: (v) => ({ title: 'Refund issued', body: `We've refunded ${money(v.cents)} on ${v.ref}. ${v.reason}` }) }),
  ticket_received: t<{ ref: string; reply_by?: string | null }>({ category: 'account',
    render: (v) => ({ title: 'We got your message', body: `Your reference is ${v.ref}. ${v.reply_by ? `We aim to reply by ${v.reply_by}.` : 'Our team will reply soon.'} You can add to it in the app (Help, Your messages).` }) }),
  ticket_reply: t<{ subject: string; resolution: string }>({ category: 'account',
    render: (v) => ({ title: `Re: ${v.subject}`, body: v.resolution }) }),
  // Round 22: support threads, satisfaction, lost property.
  ticket_resolved: t<{ ref: string; subject: string }>({ category: 'account',
    render: (v) => ({ title: 'Sorted', body: `We've marked "${v.subject}" (${v.ref}) as sorted. Tell us how we went, or reply if it isn't fixed.` }) }),
  lost_item_driver: t<{ ref: string; item: string }>({ category: 'trip',
    render: (v) => ({ title: 'A rider may have left something in your car', body: `Trip ${v.ref}: "${v.item}". Please check your car and answer in the app (Trips, Lost property).` }) }),
  lost_item_found: t<{ ref: string; item: string; asked: boolean }>({ category: 'trip',
    render: (v) => ({ title: v.asked ? 'Your driver has your item' : 'Your driver found something in the car',
      body: `Trip ${v.ref}: "${v.item}". Open the trip and tap "Get help with this trip" to have it sent to you by courier or to arrange a pickup.` }) }),
  lost_item_not_found: t<{ ref: string }>({ category: 'trip',
    render: (v) => ({ title: 'Your driver could not find it', body: `Your driver checked the car after trip ${v.ref} and could not find your item. Reply in Help if you think it was another trip.` }) }),
  lost_item_collect: t<{ ref: string; item: string }>({ category: 'trip',
    render: (v) => ({ title: 'The rider would like to collect their item', body: `Trip ${v.ref}: "${v.item}". Use Messages on the trip, or call through the app, to agree a time and a public place.` }) }),
  lost_item_courier: t<{ ref: string; address: string }>({ category: 'trip',
    render: (v) => ({ title: 'A courier is collecting the lost item', body: `The rider booked courier ${v.ref} to collect their item from ${v.address}. Please have it ready.` }) }),
  referral_bonus: t<{ points: number }>({ category: 'account',
    render: (v) => ({ title: 'Referral bonus', body: `Your friend took their first DingoGo trip — ${v.points} Dingo Points added.` }) }),
  // Round 17: loyalty. Points expiring (service notice about the rider's own balance), opt-in bonuses, a gift voucher texted to someone.
  points_expiring: t<{ points: number; date: string }>({ category: 'account',
    render: (v) => ({ title: 'Your Dingo Points are about to expire', body: `Your ${v.points} Dingo Points expire on ${v.date}. Take a trip or swap them for a reward before then to keep them.` }) }),
  birthday_bonus: t<{ points: number }>({ category: 'account',
    render: (v) => ({ title: 'Happy birthday from DingoGo', body: `We've added ${v.points} Dingo Points to your account. Have a great day.` }) }),
  streak_bonus: t<{ points: number; weeks: number }>({ category: 'account',
    render: (v) => ({ title: `${v.weeks} weeks in a row`, body: `You've ridden with DingoGo ${v.weeks} weeks in a row. ${v.points} bonus Dingo Points added.` }) }),
  gift_voucher: t<{ from: string; cents: number; code: string; expires: string }>({ category: 'account', smsKind: 'transactional',
    render: (v) => ({ sms: `DingoGo: ${v.from} sent you ${money(v.cents)} of DingoGo credit. Code ${v.code}, use by ${v.expires}. Add it in the app (Wallet) or quote it when you call to book.` }) }),

  // ── Driver ──
  trip_given_away: t<{ ref: string }>({ category: 'trip',
    render: (v) => ({ title: 'Trip given to another driver', body: `${v.ref} has gone to another driver because we couldn't reach you. Call DingoGo if you were still on your way.` }) }),
  trip_cancelled: t<{ ref: string }>({ category: 'trip', render: (v) => ({ title: 'Trip cancelled', body: `${v.ref} was cancelled.` }) }),
  tip_received: t<{ ref: string; cents: number }>({ category: 'account', render: (v) => ({ title: 'You got a tip', body: `${money(v.cents)} on ${v.ref}` }) }),
  set_offline: t<{ minutes: number }>({ category: 'account',
    render: (v) => ({ title: 'You are offline', body: `We hadn't heard from your phone for ${v.minutes} minutes, so we set you offline. Go online again when you're ready.` }) }),
  driver_approved: t<Record<string, never>>({ category: 'account',
    render: () => ({ title: 'You’re approved', body: 'Welcome to DingoGo. You can now go online and accept trips.' }) }),
  documents_reviewed: t<{ types: string[]; status: string; note?: string | null }>({ category: 'account',
    render: (v) => ({
      title: v.types.length === 1 ? `Document ${v.status}` : `${v.types.length} documents ${v.status}`,
      body: `${v.types.join(', ')}: ${v.status}${v.note ? ' — ' + v.note : ''}`,
    }) }),
  car_reviewed: t<{ approved: boolean; rego: string; note?: string | null }>({ category: 'account',
    render: (v) => ({
      title: v.approved ? 'Your car is approved' : 'Your car was not approved',
      body: v.approved ? `${v.rego} is good to go. You can drive it on DingoGo.` : `${v.rego}: ${v.note ?? 'please contact DingoGo'}`,
    }) }),
  payout_sent: t<{ cents: number }>({ category: 'account', render: (v) => ({ title: 'Payout sent', body: `${money(v.cents)} is on its way to your bank account.` }) }),
  earnings_floor_topup: t<{ cents: number; week: string; rate_cents: number }>({ category: 'account',
    render: (v) => ({ title: 'Earnings floor top-up', body: `${money(v.cents)} added for the week of ${v.week}, so you earned at least ${money(v.rate_cents)} per engaged hour.` }) }),
  // Round 20: DingoGo car agreements and maintenance.
  fleet_arrears: t<{ cents: number; rego: string }>({ category: 'account',
    render: (v) => ({ title: 'Car payments behind', body: `${money(v.cents)} is owing on your agreement for ${v.rego}. Nothing more than your balance is ever taken. Call DingoGo if you need a pause or a plan.` }) }),
  fleet_bought_out: t<{}>({ category: 'account',
    render: () => ({ title: 'The car is yours', body: 'Your rent-to-own agreement is paid off. DingoGo will help you transfer the registration.' }) }),
  fleet_car_off_road: t<{ spare: string | null }>({ category: 'account',
    render: (v) => ({ title: 'Your car is in for maintenance', body: v.spare ? `Use the spare car ${v.spare} until yours is back. It is set as your car in the app.` : 'You are offline until it is back. We will let you know.' }) }),
  fleet_car_back: t<{}>({ category: 'account', render: () => ({ title: 'Your car is back', body: 'Maintenance is done. Your car is set as your car in the app again.' }) }),
  document_expiring: t<{ label: string; days_left: number }>({ category: 'documents',
    render: (v) => ({
      title: v.days_left < 0 ? `${v.label} has expired` : v.days_left === 0 ? `${v.label} expires today` : `${v.label} expires in ${v.days_left} day${v.days_left === 1 ? '' : 's'}`,
      body: 'Upload the new one in the app (Profile) so you can keep driving.',
    }) }),

  // ── Trip chat and the relay number ──
  chat_message: t<{ from: 'rider' | 'driver' | 'dingogo'; name?: string | null; text: string }>({ category: 'chat',
    render: (v) => ({
      title: v.from === 'dingogo' ? 'Message from DingoGo' : v.from === 'driver' ? `Message from your driver${v.name ? ', ' + firstName(v.name) : ''}` : `Message from your rider${v.name ? ', ' + firstName(v.name) : ''}`,
      body: v.text,
    }) }),
  chat_relay_sms: t<{ from: 'driver' | 'dingogo'; name?: string | null; text: string }>({ category: 'chat', smsKind: 'transactional',
    render: (v) => ({ sms: `DingoGo ${v.from === 'driver' ? 'driver' + (v.name ? ' ' + firstName(v.name) : '') : 'team'}: ${v.text} (Reply to this text to answer.)` }) }),
  relay_no_trip_sms: t<{ support?: string | null }>({ category: 'chat', smsKind: 'transactional',
    render: (v) => ({ sms: `DingoGo: we couldn't find a live trip for this number, so your text wasn't passed on.${v.support ? ` For help call ${v.support}.` : ' Please use the DingoGo app.'}` }) }),

  // ── Opt-out keywords (replies to an incoming text) ──
  sms_stop_ack: t<Record<string, never>>({ category: 'account', smsKind: 'essential',
    render: () => ({ sms: 'DingoGo: you won\'t get any more texts from us, including offers. Sign-in codes still come when you ask for one. Reply START to get texts again.' }) }),
  sms_start_ack: t<Record<string, never>>({ category: 'account', smsKind: 'essential',
    render: () => ({ sms: 'DingoGo: texts are back on. Offers stay off unless you turn them on in the app (Account, Notifications). Reply STOP to stop.' }) }),
  sms_help: t<{ support?: string | null }>({ category: 'account', smsKind: 'essential',
    render: (v) => ({ sms: `DingoGo rideshare and courier, Alice Springs.${v.support ? ` Help: ${v.support}.` : ''} Reply STOP to stop texts.` }) }),

  // ── Round 19: tours and hire ──
  tour_booked_for_you: t<{ partner: string; tour: string; ref: string; when: string; pickup: string }>({ category: 'trip', smsKind: 'transactional',
    render: (v) => ({
      title: 'Tour booked for you',
      body: `${v.partner} booked ${v.tour} (${v.ref}) for you, ${v.when}, pickup at ${v.pickup}.`,
      sms: `DingoGo: ${v.partner} booked ${v.tour} for you (${v.ref}), ${v.when}, pickup at ${v.pickup}. Bring water and a hat. We'll text when your driver is on the way.`,
    }) }),
  tour_advisory: t<{ ref: string; tour: string; title: string; message: string; free: boolean }>({ category: 'safety', smsKind: 'transactional',
    render: (v) => ({
      title: v.title,
      body: `${v.message} This affects ${v.tour} (${v.ref}).${v.free ? ' You can cancel or move it for free.' : ''}`,
    }) }),
  guide_assigned: t<{ tour: string; when: string; pickup: string; ref: string; cents: number }>({ category: 'trip', smsKind: 'transactional',
    render: (v) => ({ sms: `DingoGo: you're guiding ${v.tour} (${v.ref}), ${v.when}, pickup ${v.pickup}. Your fee ${money(v.cents)}. Call DingoGo if you can't make it.` }) }),
  hire_quote: t<{ name: string; cents: number; url: string; days: number }>({ category: 'account', smsKind: 'transactional',
    render: (v) => ({ sms: `DingoGo: hi ${v.name}, your hire quote is ${money(v.cents)} incl. GST. See it and accept here within ${v.days} days: ${v.url}` }) }),

  // ── Business accounts (Round 24) ──
  business_application_received: t<{ org: string; ref: string }>({ category: 'account', smsKind: 'transactional',
    render: (v) => ({ sms: `DingoGo: thanks for applying for a business account for ${v.org} (ref ${v.ref}). We check every application within one business day.` }) }),
  business_account_approved: t<{ org: string; terms: number }>({ category: 'account', smsKind: 'transactional',
    render: (v) => ({
      title: `${v.org} account is open`,
      body: `Your DingoGo business account for ${v.org} is open. You manage it: add staff, cost centres and rules in Account, Business account. Invoices are monthly, due in ${v.terms} days.`,
      sms: `DingoGo: your business account for ${v.org} is open. Sign in to the DingoGo app with this number to add staff and book. Invoices are monthly, due in ${v.terms} days.`,
    }) }),
  business_account_declined: t<{ org: string; note: string | null }>({ category: 'account', smsKind: 'transactional',
    render: (v) => ({ sms: `DingoGo: we can't open a business account for ${v.org} at the moment${v.note ? `: ${v.note}` : ''}. Call us to talk it through.` }) }),
  business_member_added: t<{ org: string; role: string; by: string }>({ category: 'account', smsKind: 'transactional',
    render: (v) => ({
      title: `You're on the ${v.org} account`,
      body: `${v.by} added you to ${v.org} on DingoGo as ${v.role}. Choose ${v.org} under Payment when you book a work trip.`,
      sms: `DingoGo: ${v.by} added you to the ${v.org} business account (${v.role}). Get the DingoGo app and sign in with this number to book work trips.`,
    }) }),
  business_approval_needed: t<{ org: string; ref: string; who: string; when: string; cents: number }>({ category: 'account',
    render: (v) => ({ title: 'Trip waiting for your OK', body: `${v.who} booked ${v.ref} on ${v.org} for ${v.when} (${money(v.cents)}). Approve or decline it in Account, Business account.` }) }),
  business_trip_approved: t<{ ref: string; when: string }>({ category: 'trip',
    render: (v) => ({ title: 'Trip approved', body: `Booking ${v.ref} for ${v.when} is approved. We'll find a driver closer to the time.` }) }),
  business_trip_declined: t<{ ref: string; when: string; note: string | null }>({ category: 'trip', smsKind: 'transactional',
    render: (v) => ({
      title: 'Trip not approved',
      body: `Booking ${v.ref} for ${v.when} was not approved, so it is cancelled with no charge.${v.note ? ` ${v.note}` : ''}`,
      sms: `DingoGo: booking ${v.ref} for ${v.when} was not approved by the account, so it is cancelled with no charge.`,
    }) }),
  business_trip_unapproved: t<{ ref: string; when: string }>({ category: 'trip', smsKind: 'transactional',
    render: (v) => ({
      title: 'Trip not sent',
      body: `Booking ${v.ref} for ${v.when} wasn't approved in time, so no driver was sent and there is no charge.`,
      sms: `DingoGo: booking ${v.ref} for ${v.when} wasn't approved in time, so no driver was sent and there is no charge.`,
    }) }),
  regular_rides_booked: t<{ org: string; days: string; time: string; pickup: string; next: string }>({ category: 'trip', smsKind: 'transactional',
    render: (v) => ({
      title: 'Regular rides booked for you',
      body: `${v.org} booked regular rides for you: ${v.days} at ${v.time} from ${v.pickup}. First one ${v.next}.`,
      sms: `DingoGo: ${v.org} booked regular rides for you, ${v.days} at ${v.time} from ${v.pickup}. First one ${v.next}. We'll text when each driver is on the way.`,
    }) }),
  recurring_problem: t<{ ref: string; date: string; reason: string }>({ category: 'account',
    render: (v) => ({ title: 'A regular trip could not be booked', body: `Series ${v.ref}: the trip on ${v.date} was not booked: ${v.reason}` }) }),
  invoice_issued: t<{ org: string; number: string; cents: number; due: string }>({ category: 'account',
    render: (v) => ({ title: `Invoice ${v.number}`, body: `${v.org}: invoice ${v.number} for ${money(v.cents)} incl. GST is ready, due ${v.due}. Download it in Account, Business account.` }) }),
  invoice_overdue: t<{ org: string; number: string; cents: number; days: number }>({ category: 'account', smsKind: 'transactional',
    render: (v) => ({
      title: `Invoice ${v.number} is overdue`,
      body: `${v.org}: invoice ${v.number} (${money(v.cents)}) is ${v.days} day${v.days === 1 ? '' : 's'} overdue. Please pay it or call us if something is wrong.`,
      sms: `DingoGo: invoice ${v.number} for ${v.org} (${money(v.cents)}) is ${v.days} day${v.days === 1 ? '' : 's'} overdue. Please pay it, or call us if something is wrong.`,
    }) }),

  // ── Round 28: community trips by text, shuttles, community store parcels and top-ups ──
  regional_usage: t<{ support: string }>({ category: 'trip', smsKind: 'transactional',
    render: (v) => ({ sms: `DingoGo shuttle by text: BUS NTARIA FRI 2 asks for 2 seats on Friday. BUS FROM NTARIA comes back to Alice. MY BUS lists bookings, CANCEL and the ref cancels, BAL shows your credit. Help: ${v.support}` }) }),
  regional_hold: t<{ seats: number; what: string; when: string; cents: number; minutes: number; pickup: string }>({ category: 'trip', smsKind: 'transactional',
    render: (v) => ({ sms: `DingoGo: ${v.seats} seat${v.seats === 1 ? '' : 's'} ${v.what}, ${v.when}, from ${v.pickup}. ${money(v.cents)} from your credit. Reply YES within ${v.minutes} min to book, or NO.` }) }),
  regional_booked: t<{ ref: string; seats: number; what: string; when: string; pickup: string; balance: number }>({ category: 'trip', smsKind: 'transactional',
    render: (v) => ({ sms: `DingoGo: booked ${v.ref}, ${v.seats} seat${v.seats === 1 ? '' : 's'} ${v.what}, ${v.when}, from ${v.pickup}. Credit left ${money(v.balance)}. To cancel reply CANCEL ${v.ref}` }) }),
  regional_need_credit: t<{ cents: number; balance: number; support: string }>({ category: 'trip', smsKind: 'transactional',
    render: (v) => ({ sms: `DingoGo: that needs ${money(v.cents)} DingoGo credit and you have ${money(v.balance)}. Top up at a DingoGo community store, or call ${v.support}.` }) }),
  regional_no_run: t<{ place: string; support: string }>({ category: 'trip', smsKind: 'transactional',
    render: (v) => ({ sms: `DingoGo: no shuttle with seats for ${v.place} then. Text BUS and the place for the next one, or call ${v.support}.` }) }),
  regional_seats: t<{ max: number }>({ category: 'trip', smsKind: 'transactional',
    render: (v) => ({ sms: `DingoGo: book 1 to ${v.max} seats by text, e.g. BUS NTARIA FRI 2. For more, call us.` }) }),
  regional_nothing_pending: t<Record<string, never>>({ category: 'trip', smsKind: 'transactional',
    render: () => ({ sms: 'DingoGo: nothing is waiting for a YES. Text BUS and the place to ask for a seat, e.g. BUS NTARIA FRI.' }) }),
  regional_not_booked: t<Record<string, never>>({ category: 'trip', smsKind: 'transactional',
    render: () => ({ sms: 'DingoGo: OK, not booked. Nothing was taken from your credit.' }) }),
  regional_list: t<{ lines: string[] }>({ category: 'trip', smsKind: 'transactional',
    render: (v) => ({ sms: v.lines.length ? `DingoGo bookings: ${v.lines.join('; ')}` : 'DingoGo: no shuttle bookings coming up. Text BUS and the place to book.' }) }),
  regional_cancelled: t<{ ref: string; refund_cents: number }>({ category: 'trip', smsKind: 'transactional',
    render: (v) => ({ sms: `DingoGo: ${v.ref} cancelled.${v.refund_cents > 0 ? ` ${money(v.refund_cents)} is back on your credit.` : ''}` }) }),
  regional_cancel_which: t<Record<string, never>>({ category: 'trip', smsKind: 'transactional',
    render: () => ({ sms: 'DingoGo: which booking? Reply CANCEL and the ref, e.g. CANCEL SB-ABC123. MY BUS lists them.' }) }),
  regional_cancel_late: t<{ ref: string; support: string }>({ category: 'trip', smsKind: 'transactional',
    render: (v) => ({ sms: `DingoGo: ${v.ref} leaves soon, so it can't be cancelled by text. Call ${v.support}.` }) }),
  regional_balance: t<{ cents: number }>({ category: 'account', smsKind: 'transactional',
    render: (v) => ({ sms: `DingoGo: your credit is ${money(v.cents)}. Top up at a DingoGo community store.` }) }),
  regional_run_cancelled: t<{ ref: string; what: string; when: string; refund_cents: number }>({ category: 'trip', smsKind: 'transactional',
    render: (v) => ({ sms: `DingoGo: sorry, the shuttle ${v.what} on ${v.when} is cancelled (${v.ref}).${v.refund_cents > 0 ? ` ${money(v.refund_cents)} is back on your credit.` : ''} Call us to rebook.` }) }),
  regional_parcel_booked: t<{ sender: string; ref: string; when: string; store: string }>({ category: 'trip', smsKind: 'transactional',
    render: (v) => ({ sms: `DingoGo: ${v.sender} is sending you a parcel (${v.ref}) on the shuttle ${v.when}, to ${v.store}. We'll text a collection code when it's there.` }) }),
  regional_parcel_at_store: t<{ sender: string; ref: string; store: string; code: string }>({ category: 'trip', smsKind: 'transactional',
    render: (v) => ({ sms: `DingoGo: your parcel from ${v.sender} (${v.ref}) is at ${v.store}. Collection code ${v.code}. Show this code to collect it.` }) }),
  topup_receipt: t<{ cents: number; store: string; balance: number; ref: string }>({ category: 'account', smsKind: 'transactional',
    render: (v) => ({ sms: `DingoGo: ${money(v.cents)} credit added at ${v.store} (${v.ref}). Your credit is ${money(v.balance)}. Book a shuttle seat: text BUS and the place.` }) }),
  topup_voided: t<{ cents: number; store: string; ref: string }>({ category: 'account', smsKind: 'transactional',
    render: (v) => ({ sms: `DingoGo: the ${money(v.cents)} top-up at ${v.store} (${v.ref}) was undone by the store. Ask them if this is wrong.` }) }),

  // ── Marketing (only with consent; footer names DingoGo and how to stop) ──
  promo: t<{ title: string; body: string }>({ category: 'promo', smsKind: 'marketing',
    render: (v) => ({
      title: v.title,
      body: `${v.body}\n— DingoGo. Turn off offers in Account › Notifications.`,
      sms: `DingoGo: ${v.body} Reply STOP to opt out.`,
    }) }),
} as const;

export type TemplateKey = keyof typeof templates;
export type VarsOf<K extends TemplateKey> = Parameters<(typeof templates)[K]['render']>[0];

export function render<K extends TemplateKey>(key: K, vars: VarsOf<K>): Rendered & { category: Category; smsKind?: SmsKind } {
  const tpl = templates[key] as Template<any>;
  const m = tpl.render(vars);
  // Text built from what people typed (safe places, names) can carry curly quotes or dashes: keep it GSM-7.
  return { ...m, ...(m.sms ? { sms: gsmFriendly(m.sms) } : {}), category: tpl.category, smsKind: tpl.smsKind };
}

export function firstName(name: string) { return name.trim().split(/\s+/)[0] ?? ''; }

/** The wording shown next to the marketing switch. Stored with every consent record (Spam Act: evidence of consent). */
export const MARKETING_CONSENT_WORDING =
  'Send me DingoGo offers and café deals by notification and text. Optional: trip updates and receipts always come through. Stop any time in Account › Notifications or reply STOP to a text.';

// ── SMS length ──
const GSM = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM_EXT = '^{}\\[~]|€\f';
const gsmSet = new Set([...GSM]);
const extSet = new Set([...GSM_EXT]);

/** How a text is encoded and how many parts it is sent as (each part is billed). */
export function smsSegments(text: string): { encoding: 'GSM-7' | 'UCS-2'; units: number; segments: number } {
  let units = 0; let gsm = true;
  for (const ch of text) {
    if (gsmSet.has(ch)) units += 1;
    else if (extSet.has(ch)) units += 2;
    else { gsm = false; break; }
  }
  if (gsm) return { encoding: 'GSM-7', units, segments: units <= 160 ? 1 : Math.ceil(units / 153) };
  const n = [...text].reduce((s, ch) => s + (ch.codePointAt(0)! > 0xffff ? 2 : 1), 0);
  return { encoding: 'UCS-2', units: n, segments: n <= 70 ? 1 : Math.ceil(n / 67) };
}

/** Swap the few typographic characters people type (curly quotes, dashes, ellipsis) for GSM ones, so a text isn't sent as UCS-2. */
export function gsmFriendly(text: string) {
  return text.replace(/[‘’‛′]/g, "'").replace(/[“”″]/g, '"').replace(/[–—−]/g, '-').replace(/…/g, '...').replace(/ /g, ' ');
}
