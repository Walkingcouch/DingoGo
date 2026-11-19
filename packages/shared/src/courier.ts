/** Parcel rules shown in the apps and on the website. The API checks the same keys (services/api/src/lib/courier.ts) and a
 *  test keeps the two lists in step. Plain text only (no JSX), so the API tests can import it. */
export const PROHIBITED_ITEMS = [
  { key: 'alcohol', title: 'Alcohol of any kind', detail: "Takeaway alcohol in Alice Springs is restricted and needs photo ID at the point of sale, so we don't carry it." },
  { key: 'drugs', title: "Illegal drugs, or medicines that aren't yours", detail: "Pharmacy orders in the recipient's name are fine." },
  { key: 'weapons', title: 'Weapons and ammunition', detail: 'Including replicas, knives sold as weapons and fireworks.' },
  { key: 'dangerous_goods', title: 'Dangerous goods', detail: 'Fuel, gas bottles, batteries over 100 Wh, chemicals, paint and anything flammable or corrosive.' },
  { key: 'valuables', title: 'Cash, jewellery or items worth more than $1,000', detail: "We can't insure these in transit." },
  { key: 'animals', title: 'Live animals', detail: 'Book a pet-friendly ride with the owner instead.' },
  { key: 'hot_food', title: 'Food deliveries from restaurants', detail: "We don't carry hot food. Packaged groceries are fine." },
] as const;
export const PROHIBITED_KEYS = PROHIBITED_ITEMS.map((i) => i.key);

/** Heaviest parcel per size (kg). */
export const PARCEL_SIZE_MAX_KG = { S: 5, M: 15, L: 25 } as const;

/** Why a delivery couldn't be made (driver app). Same keys as the API. */
export const DELIVERY_FAIL_REASONS: [string, string][] = [
  ['no_one_home', 'Nobody home'],
  ['no_safe_place', 'No safe place to leave it'],
  ['refused', 'Recipient refused it'],
  ['wrong_address', 'Address wrong or not found'],
  ['no_access', 'Couldn’t get in (gate, dogs)'],
  ['unsafe', 'Unsafe to deliver'],
  ['other', 'Something else'],
];

/** What happened to a parcel, in plain words (sender, recipient, ops). */
export const PARCEL_OUTCOME_LABEL: Record<string, string> = {
  delivered: 'Delivered', returning: 'Coming back to the sender', returned: 'Returned to the sender',
};
