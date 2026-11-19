/**
 * Round 22: help centre content for the rider and driver apps, in one file so it is easy to review and keep in plain language.
 * Short sentences, Australian English, no emoji. Each article says what to do next (`action`): open the trip help, send a
 * message, report a safety problem or call. Prices and rules here must match the fare rules and policies (checked by
 * services/api/test/support.test.ts for the main numbers). Search is plain word matching with simple stems and synonyms.
 */
export type HelpAudience = 'rider' | 'driver';
export type HelpAction = 'trip_help' | 'message' | 'safety' | 'call' | 'payment' | 'profile' | 'earnings';
export interface HelpArticle {
  id: string;
  audience: HelpAudience[];
  topic: string;
  title: string;
  /** Paragraphs, plain text. */
  body: string[];
  keywords?: string[];
  action?: HelpAction;
}

export const HELP_TOPICS: Record<HelpAudience, string[]> = {
  rider: ['Fares and payments', 'Lost property', 'During a trip', 'Safety', 'Parcels', 'Your account'],
  driver: ['Pay and payouts', 'Trips and riders', 'Lost property', 'Safety', 'Your car and papers', 'The app', 'Your account'],
};

export const HELP_ARTICLES: HelpArticle[] = [
  // ── Riders: fares and payments ──
  { id: 'how-fares-work', audience: ['rider'], topic: 'Fares and payments', title: 'How fares are worked out',
    body: [
      'A ride costs $3 to start, $1.60 a kilometre and 25c a minute, plus a $1 booking fee. In the Northern Territory there is also a $1 government levy on each trip.',
      'Late at night (10 pm to 5 am) and on public holidays there is a small extra charge. You see the full price before you book.',
      'Prices include GST. Your receipt is in the trip, under Trips.',
    ], keywords: ['price', 'cost', 'how much', 'levy', 'gst', 'night', 'holiday', 'expensive'] },
  { id: 'upfront-price', audience: ['rider'], topic: 'Fares and payments', title: 'Why was I charged more than the price shown?',
    body: [
      'You pay the price shown when you booked. It doesn\'t go up for traffic or a slow route.',
      'The only time it changes is when the trip is a lot longer than planned (more than a quarter longer, for example a new stop or a detour you asked for). Then the extra kilometres are added, never more than 20% on top of the price.',
      'If you think the charge is wrong, open the trip and tap "Get help with this trip", then "My fare was higher than expected". We check it against the car\'s GPS track straight away, and small differences are refunded on the spot.',
    ], keywords: ['overcharged', 'charged more', 'higher', 'wrong fare', 'refund', 'detour', 'long way', 'route', 'too much', 'dispute'], action: 'trip_help' },
  { id: 'refunds', audience: ['rider'], topic: 'Fares and payments', title: 'Refunds: when will I see my money?',
    body: [
      'Refunds go back to the way you paid. DingoGo credit shows straight away. Card refunds usually take 3 to 5 business days to show on your statement.',
      'Cash fares are refunded as DingoGo credit.',
      'Please ask us before you dispute a charge with your bank. We can usually fix it faster.',
    ], keywords: ['refund', 'money back', 'chargeback', 'bank', 'card', 'credit'], action: 'message' },
  { id: 'cancellation-fee', audience: ['rider'], topic: 'Fares and payments', title: 'Cancelling and the cancellation fee',
    body: [
      'You can cancel for free for 2 minutes after a driver accepts. After that there is a $3 fee, because the driver is already on the way.',
      'If the driver cancels, you are not charged. If you think a fee is wrong, open the trip and tap "Get help with this trip".',
    ], keywords: ['cancel', 'fee', 'charged for cancelling', '3 dollars'], action: 'trip_help' },
  { id: 'paying', audience: ['rider'], topic: 'Fares and payments', title: 'Ways to pay',
    body: [
      'Pay with a card saved in the app, DingoGo credit (including prepaid vouchers from shops) or a business account. Rides are paid in the app, not in cash.',
      'Parcels can be paid in cash where it is offered.',
    ], keywords: ['pay', 'card', 'cash', 'voucher', 'wallet', 'credit', 'business account'], action: 'payment' },
  { id: 'tips', audience: ['rider'], topic: 'Fares and payments', title: 'Tipping your driver',
    body: ['Tips are optional. Your driver gets 100% of the tip. You can add one after the trip, on the trip screen.'],
    keywords: ['tip', 'tipping', 'thank driver'] },
  { id: 'payment-failed', audience: ['rider'], topic: 'Fares and payments', title: 'My payment didn\'t go through',
    body: ['Open the trip and tap "Pay now" to try your card again, or add another card in Account, Payment and credit.'],
    keywords: ['declined', 'failed', 'card declined', 'pay now'], action: 'payment' },

  // ── Riders: lost property ──
  { id: 'lost-item', audience: ['rider'], topic: 'Lost property', title: 'I left something in the car',
    body: [
      'Open the trip under Trips, tap "Get help with this trip", then "I left something in the car". Tell us what it is.',
      'We tell your driver straight away. You can message or call them from the trip screen while we sort it out, and your phone number stays hidden.',
      'If the driver has it, you can have it brought to you by a DingoGo courier (a normal small parcel price) or arrange to pick it up from them in a public place.',
      'Please report it within 30 days. If it was something important like medicine, a phone or keys, also call us.',
    ], keywords: ['lost', 'left', 'forgot', 'phone', 'wallet', 'bag', 'keys', 'glasses', 'found', 'missing', 'property'], action: 'trip_help' },
  { id: 'lost-item-courier', audience: ['rider'], topic: 'Lost property', title: 'Getting a lost item delivered',
    body: [
      'Once your driver says they have it, open the trip help and choose "Send it to me". Pick the address and how to pay. A courier collects it from where your driver said and brings it to you.',
      'You can track the courier like any delivery. Give the courier your delivery PIN when it arrives.',
    ], keywords: ['courier', 'deliver', 'send', 'return', 'lost', 'bring'], action: 'trip_help' },

  // ── Riders: during a trip ──
  { id: 'driver-late', audience: ['rider'], topic: 'During a trip', title: 'My driver is late or I can\'t find them',
    body: [
      'Check the map on the trip screen and the car\'s rego. You can message your driver or call them through the app.',
      'If they cancel, we look for another driver straight away and you don\'t pay any extra.',
    ], keywords: ['late', 'waiting', 'where', 'cant find', 'no show'] },
  { id: 'driver-feedback', audience: ['rider'], topic: 'During a trip', title: 'Feedback about a driver',
    body: [
      'Tell us about rude behaviour, a dirty car or bad driving: open the trip, tap "Get help with this trip", then "Feedback about my driver". We follow it up with the driver.',
      'If you felt unsafe, choose "I felt unsafe" instead. That goes to our safety team.',
    ], keywords: ['rude', 'complain', 'complaint', 'driver', 'behaviour', 'dirty', 'smell', 'speeding', 'bad driving'], action: 'trip_help' },
  { id: 'assistance-animal', audience: ['rider'], topic: 'During a trip', title: 'Assistance animals',
    body: [
      'Assistance animals can travel on every DingoGo service, with no extra charge. Refusing one is against the law.',
      'If a driver refused your assistance animal, open the trip help and tell us. We review every report.',
    ], keywords: ['guide dog', 'assistance animal', 'dog', 'refused', 'disability'], action: 'trip_help' },
  { id: 'accessibility', audience: ['rider'], topic: 'During a trip', title: 'Wheelchairs and other needs',
    body: ['Add your needs in Account, Profile and preferences (for example a wheelchair, hearing or vision). We share them with your driver so they can help.'],
    keywords: ['wheelchair', 'deaf', 'blind', 'mobility', 'hearing', 'vision', 'ndis'], action: 'profile' },

  // ── Riders and drivers: safety ──
  { id: 'emergency', audience: ['rider', 'driver'], topic: 'Safety', title: 'In an emergency',
    body: [
      'If you are in danger, call 000. During a trip, the red SOS button calls 000, alerts our safety team with your location and texts your trusted contacts.',
      'The SOS screen also shows what to tell 000: where you are and the car.',
    ], keywords: ['emergency', 'danger', 'police', 'ambulance', 'sos', '000', 'help'], action: 'call' },
  { id: 'report-safety', audience: ['rider', 'driver'], topic: 'Safety', title: 'Report a safety problem',
    body: [
      'Something happened on a trip, or after it? Report it from the trip (Report a safety problem) or from Account, Safety.',
      'Serious reports put the other person\'s account on hold while we look into it. For support any time, call 1800RESPECT on 1800 737 732.',
    ], keywords: ['unsafe', 'harassment', 'assault', 'threat', 'abuse', 'drunk', 'report'], action: 'safety' },

  // ── Riders: parcels ──
  { id: 'parcel-problem', audience: ['rider'], topic: 'Parcels', title: 'A parcel didn\'t arrive or was damaged',
    body: [
      'Open the delivery under Trips to see the proof of delivery (who took it, a signature or photo).',
      'If it still isn\'t right, tap "Get help with this trip", then "A problem with the parcel".',
    ], keywords: ['parcel', 'delivery', 'not delivered', 'damaged', 'missing', 'courier'], action: 'trip_help' },

  // ── Riders: account ──
  { id: 'messages-status', audience: ['rider', 'driver'], topic: 'Your account', title: 'Checking on a message you sent us',
    body: [
      'Your messages are in Help, under Your messages. You can see our replies there and add more details. We say when we aim to reply.',
      'When we have sorted it, you can tell us how we went.',
    ], keywords: ['ticket', 'reply', 'message', 'status', 'waiting', 'support', 'contact'] },
  { id: 'delete-account', audience: ['rider', 'driver'], topic: 'Your account', title: 'Download or delete your data',
    body: ['Go to Privacy and your data to download a copy of your data or delete your account. We keep trip records for 5 years because the law says we must.'],
    keywords: ['privacy', 'delete', 'data', 'close account'] },

  // ── Drivers ──
  { id: 'driver-pay', audience: ['driver'], topic: 'Pay and payouts', title: 'How your pay works',
    body: [
      'You keep 75% of each fare. DingoGo\'s service fee is 25%. Tips are 100% yours.',
      'Your earnings, fees and tips for each trip are on the Earnings screen. Payouts go to the bank account in your profile.',
    ], keywords: ['pay', 'earnings', 'fee', 'commission', '75', 'payout', 'bank', 'money'], action: 'earnings' },
  { id: 'driver-pay-question', audience: ['driver'], topic: 'Pay and payouts', title: 'A trip\'s pay looks wrong',
    body: ['Open Trips, tap "Get help" on the trip, then "A question about my pay for this trip". Tell us what you expected. We reply in the app.'],
    keywords: ['wrong pay', 'missing', 'tip missing', 'cancellation pay', 'cash'], action: 'trip_help' },
  { id: 'driver-cancel', audience: ['driver'], topic: 'Trips and riders', title: 'Cancelling a trip',
    body: [
      'If the rider doesn\'t show up or asks you to cancel, choose that reason and the trip ends.',
      'If you have a problem with the car, we offer the trip to another driver. Too many cancellations in a week are checked by our team.',
    ], keywords: ['cancel', 'no show', 'rider not there'] },
  { id: 'driver-found-item', audience: ['driver'], topic: 'Lost property', title: 'A rider left something in my car',
    body: [
      'Open Trips, tap "Get help" on that trip, then "The rider left something in my car". Say what it is and where a courier can collect it (a public place or your depot is best).',
      'If a rider asks about an item, you get a notice. Check your car and answer in Help, Lost property: found or not found.',
      'You can message or call the rider through the app while the case is open. Your number stays hidden. Don\'t open bags or wallets.',
    ], keywords: ['found', 'left', 'lost', 'forgot', 'phone', 'wallet', 'item', 'property'], action: 'trip_help' },
  { id: 'driver-rider-behaviour', audience: ['driver'], topic: 'Safety', title: 'A rider was abusive or damaged the car',
    body: ['Report it from Trips (Report). Add photos if you can. If you are in danger, call 000 first.'],
    keywords: ['abusive', 'vomit', 'damage', 'drunk', 'rude rider', 'fight', 'cleaning'], action: 'safety' },
  { id: 'driver-papers', audience: ['driver'], topic: 'Your car and papers', title: 'Licence, rego and expiring papers',
    body: ['Keep your licence, H endorsement, rego and insurance up to date in Profile. We remind you before they expire. You can\'t go online with expired papers.'],
    keywords: ['licence', 'rego', 'insurance', 'expired', 'documents', 'h endorsement'] },
  { id: 'driver-rest', audience: ['driver'], topic: 'Safety', title: 'Breaks and driving hours',
    body: ['To keep you and riders safe, the app asks you to take a break after a long time online and to rest after a long day. It warns you before a limit.'],
    keywords: ['fatigue', 'tired', 'break', 'rest', 'hours', 'offline'] },
  { id: 'driver-app-problems', audience: ['driver'], topic: 'The app', title: 'No signal or the app is stuck',
    body: ['Keep driving. Your taps (arrived, start, complete) and GPS are saved on your phone and sent when the signal comes back. If the app still looks wrong, send us a message with the trip time.'],
    keywords: ['signal', 'stuck', 'frozen', 'offline', 'gps', 'app not working', 'bug'], action: 'message' },
];

const SYNONYMS: Record<string, string[]> = {
  lost: ['left', 'forgot', 'missing', 'found', 'property'], left: ['lost', 'forgot'], forgot: ['lost', 'left'], found: ['lost'],
  overcharged: ['charged', 'fare', 'refund', 'expensive'], expensive: ['fare', 'price', 'overcharged'], price: ['fare', 'cost'], cost: ['fare', 'price'],
  fare: ['price', 'charged'], refund: ['money', 'back', 'refunds'], money: ['refund', 'pay'], rude: ['behaviour', 'complaint', 'feedback'],
  complaint: ['feedback', 'complain'], unsafe: ['safety', 'danger'], danger: ['emergency', 'unsafe'], cancel: ['cancelling', 'cancellation'],
  wallet: ['lost', 'credit'], phone: ['lost'], parcel: ['delivery', 'courier'], delivery: ['parcel', 'courier'], pay: ['payment', 'earnings', 'paying'],
};
const STOP = new Set(['a', 'an', 'the', 'i', 'my', 'me', 'is', 'it', 'to', 'of', 'in', 'on', 'and', 'or', 'was', 'what', 'how', 'do', 'did', 'can', 'for', 'with', 'about', 'when', 'why', 'there', 'this', 'that', 'be', 'at', 'you', 'your']);

/** Lowercase words with a simple stem (cancelled → cancel, charges → charge, driving → driv). */
export function helpWords(s: string): string[] {
  return s.toLowerCase().replace(/[’']/g, '').split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w)).map(stem);
}
function stem(w: string) {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 6 && w.endsWith('lled')) return w.slice(0, -3);  // cancelled → cancel
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

/** Articles for this audience that match the words, best first (title × 3, keywords × 2, body × 1; synonyms count half). */
export function searchHelp(query: string, audience: HelpAudience, articles: HelpArticle[] = HELP_ARTICLES): HelpArticle[] {
  const pool = articles.filter((a) => a.audience.includes(audience));
  const words = helpWords(query);
  if (!words.length) return [];
  const expanded = new Map<string, number>();
  for (const w of words) {
    expanded.set(w, 1);
    for (const s of SYNONYMS[w] ?? []) for (const x of helpWords(s)) if (!expanded.has(x)) expanded.set(x, 0.5);
  }
  const scored = pool.map((a) => {
    const title = new Set(helpWords(a.title));
    const keys = new Set(helpWords((a.keywords ?? []).join(' ')));
    const body = new Set(helpWords(a.body.join(' ')));
    let score = 0;
    let direct = 0;
    for (const [w, weight] of expanded) {
      const hit = (title.has(w) ? 3 : 0) + (keys.has(w) ? 2 : 0) + (body.has(w) ? 1 : 0);
      score += hit * weight;
      if (hit && weight === 1) direct++;
    }
    return { a, score, direct };
  }).filter((x) => x.score > 0);
  // Prefer articles that match more of the words typed, then the higher score.
  return scored.sort((x, y) => y.direct - x.direct || y.score - x.score).map((x) => x.a);
}

export const articlesFor = (audience: HelpAudience) => HELP_ARTICLES.filter((a) => a.audience.includes(audience));
