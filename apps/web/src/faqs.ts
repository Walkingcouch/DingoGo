/**
 * Every question-and-answer on the website, in one place. The pages show these and the same text goes into the FAQPage structured
 * data (seo.ts), so what search engines read always matches what people see. Plain strings only (no JSX), so the build can use them.
 * `{phone}` and `{hours}` are filled in with the live contact details (or the published fallback at build time).
 */
export type Faq = { q: string; a: string; link?: { to: string; label: string } };

export const FAQS = {
  general: [
    { q: 'Where does DingoGo operate?', a: 'Alice Springs (Mparntwe) and surrounds, including the airport, out to about 25 km from town. Tennant Creek, Yulara and Darwin are planned later.' },
    { q: 'What hours do you run?', a: "{hours}. With a small fleet, it's best to book ahead for early flights and busy Friday and Saturday nights." },
    { q: 'Can I book without a smartphone?', a: "Yes. Call {phone} and we'll book for you. You can pay with a prepaid DingoGo card or a community organisation account." },
    { q: 'How do I pay?', a: 'Card through the app (your card is held securely by our payment provider, not by us), DingoGo credit, a prepaid DingoGo card, or a business or NDIS account. Parcels can also be paid in cash. Your card is only charged the final fare when the trip ends.' },
    { q: 'Why is there an NT passenger levy?', a: 'The Northern Territory Government charges a $1 levy on each rideshare passenger trip. We show it separately and pass it on.' },
    { q: 'Can I bring my dog?', a: 'Choose Ride with a pet and we send a car set up for animals. Assistance animals are welcome on every trip at no extra cost.', link: { to: '/rides#pets', label: 'Rides with pets' } },
    { q: 'How do I send a parcel to someone without the app?', a: "They don't need it. We text them a tracking link and their delivery PIN." },
    { q: 'I left something in the car', a: "Open the trip in the app and choose Help, then Lost item, or call us. We'll put you in touch with the driver without sharing phone numbers." },
    { q: 'How do I get a tax invoice?', a: 'Every completed trip has a tax invoice with GST in the app. Business and NDIS accounts also get a monthly statement.' },
    { q: 'How does Bring a friend work?', a: 'Share your invite link or code from the Rewards tab in the app. When your friend signs up with it and takes their first trip, you both get 500 Dingo Points.', link: { to: '/rewards#refer', label: 'Rewards' } },
    { q: 'How do I delete my account or get a copy of my data?', a: 'In the app, go to Account. You can download your data or delete your account. We keep tax records for the time the law requires.', link: { to: '/legal/privacy', label: 'Privacy policy' } },
  ],
  home: [
    { q: 'How do I pay?', a: 'Card in the app (held securely by our payment provider, never by us), DingoGo credit, a prepaid DingoGo card, or a business or NDIS account. Parcels can also be paid in cash.' },
    { q: 'Can I book without a smartphone?', a: "Yes. Call {phone} and we'll book for you, {hours}. You can pay with a prepaid DingoGo card or a community organisation account." },
    { q: 'What does it cost to cancel?', a: 'Nothing within 2 minutes of a driver accepting. After that, or once your driver has waited a few minutes, a small fee applies, and most of it goes to the driver. Tours are free to cancel up to 48 hours before.' },
    { q: 'Can I bring my dog?', a: "Choose Ride with a pet and we'll send a car set up for animals. Assistance animals ride on every service, every time, at no cost." },
    { q: 'Do you go to Yulara or Tennant Creek?', a: "Not yet. We're starting in Alice Springs, then Tennant Creek and Yulara, then Darwin." },
    { q: 'Are you coming to South Australia?', a: "Yes, to regional towns: Port Augusta, Coober Pedy, Whyalla, Port Pirie and Mount Gambier. Coming soon, once we're accredited in SA." },
  ],
  airport: [
    { q: 'How much is a ride from town to Alice Springs Airport?', a: 'The estimator on this page works it out from the live fare engine, with GST and the $1 NT passenger levy included. The price is fixed when you book, so a slow trip costs the same.' },
    { q: 'Can I book an airport ride ahead?', a: 'Yes, up to 60 days ahead in the app or by calling {phone}. For early morning flights, book the day before: we have a small local fleet.' },
    { q: 'How do I find my driver at the airport?', a: "The app shows your driver's name, car colour, make and rego, and where they are on the map. Message or call them through the app without sharing your number." },
    { q: 'What if my flight is late?', a: 'Add your flight number in the notes when you book. If you are delayed, message your driver or call us and we can move the pickup.' },
    { q: 'Is there room for luggage?', a: 'Every car fits a couple of suitcases. For a group or lots of bags, say so in the notes or call us and we will send a bigger car if one is free.' },
  ],
  hospital: [
    { q: 'Can you take me to Alice Springs Hospital or a clinic?', a: 'Yes. We drop off at the main entrance of the hospital and at clinics, health services and specialists around town, and pick you up again when you are ready.' },
    { q: 'Can my carer or a family member come too?', a: 'Yes. Up to four passengers ride for the same price. Assistance animals always ride free.' },
    { q: 'I use a walker or a folding wheelchair', a: 'Tell us in your accessibility profile in the app, or when you call. Your driver sees it before they arrive and will help you in and out of the car.' },
    { q: 'Can my health service or NDIS plan manager pay?', a: 'Yes. Community organisations and health services can open an account and book rides for clients with their consent. NDIS plan managers are invoiced directly with the participant number on every line.', link: { to: '/business', label: 'Business, NDIS and community accounts' } },
    { q: 'I don’t have a smartphone', a: "Call {phone} and we'll book for you, {hours}. We text you when your driver is on the way." },
  ],
  parcels: [
    { q: 'How fast is a same-day delivery?', a: 'Most deliveries across town are handed over within the hour of pickup. You can also choose a pickup window up to 4 hours long.' },
    { q: 'What can’t I send?', a: 'Nothing on the prohibited items list: no alcohol, illegal drugs, weapons, dangerous goods, cash or valuables over $1,000, live animals or restaurant food.', link: { to: '/legal/prohibited-items', label: 'Prohibited items' } },
    { q: 'What if nobody is home?', a: 'If you allowed it, the driver leaves it in the safe place you chose and takes a photo. Otherwise it comes back to you, with a small return fee, and you can book another try in one tap.' },
    { q: 'Can my business send lots of parcels?', a: 'Yes. Business accounts can book runs of up to 10 drops with one driver, import a CSV and see every delivery with proof on one page.', link: { to: '/business', label: 'Business accounts' } },
  ],
  tours: [
    { q: 'How many people fit on a private tour?', a: 'Up to four people in one car, for one price per car.' },
    { q: 'Can we cancel a tour?', a: 'Free up to 48 hours before. After that, 50% of the tour price. Card bookings pay a 20% deposit that counts towards the price; it comes back if you cancel in time.' },
    { q: 'What if it is too hot?', a: 'On extreme heat days walking tours start early, and tracks can close. If an advisory affects your tour we tell you, and you can cancel or move it for free.' },
    { q: 'Can my hotel book for me?', a: 'Yes. Partner hotels and visitor centres can book a tour for you at the desk, with pickup from the hotel.' },
    { q: 'Are the places named in Arrernte?', a: 'Yes. Places are named in Arrernte and English, and your driver will tell you where not to climb or take photos.' },
  ],
  business: [
    { q: 'How does a business account work?', a: 'Your staff or clients book on the account, and you get one monthly tax invoice with every trip itemised. Managers see every trip; members see their own.' },
    { q: 'Do you invoice NDIS plan managers?', a: 'Yes, directly, with the participant’s NDIS number on every line.' },
    { q: 'Can our organisation book rides for clients?', a: 'Yes. Community organisations, Aboriginal corporations and health services can book for clients with the client’s recorded consent. Clients are texted about each trip and can stop it at any time.' },
    { q: 'Can we hire cars for an event?', a: 'Yes, by the hour for conferences, weddings and festivals. Send us the date and numbers and we reply within one business day.' },
  ],
} satisfies Record<string, Faq[]>;
export type FaqSet = keyof typeof FAQS;

export function fillFaq(text: string, contact: { phone: string; hours: string }) {
  const h = contact.hours;
  return text.replace(/\{phone\}/g, contact.phone)
    .replace(/^\{hours\}/, h.charAt(0).toUpperCase() + h.slice(1))
    .replace(/\{hours\}/g, h.charAt(0).toLowerCase() + h.slice(1));
}
