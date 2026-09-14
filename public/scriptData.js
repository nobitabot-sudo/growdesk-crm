// Keep CATEGORY_SCRIPTS keys in sync with categoryMap.js CATEGORIES on the server.

const CATEGORY_LABELS = {
  cafe: 'Cafe / Restaurant', caterer: 'Caterer', realestate: 'Real Estate',
  b2b: 'B2B Wholesaler', clinic: 'Clinic / Hospital', coaching: 'Coaching Institute',
  gym: 'Gym', garage: 'Car Garage', salon: 'Salon / Spa', retail: 'Retail / Kirana',
  other: 'General'
};

// Same GROW framework as the caller-training app: Greet -> Reveal problem -> Offer fix -> Wrap+advance.
const CATEGORY_SCRIPTS = {
  cafe: { pain: 'waiters ka time waste hota hai aur order mein mistake ho jaati hai',
    offer: 'Table-Top QR Ordering, aapki delivery Website, aur ek WhatsApp Bot jo customer inquiries sambhale', asset: 'domain aur server' },
  caterer: { pain: 'har order ke liye manually quotation banana padta hai',
    offer: 'WhatsApp AI Bot jo turant PDF menu bhejta hai, aur Smart Order Webpage jahan seedha payment book ho jaaye', asset: 'server aur domain' },
  realestate: { pain: 'verified buyer leads dhoondhna aur telecalling team ko manage karna mushkil hota hai',
    offer: 'Google/Meta Ads se verified buyer leads, aur telecalling team ke liye ek Custom CRM', asset: 'ad-wallet aur CRM server' },
  b2b: { pain: 'sahi target audience ka verified contact data hi nahi milta',
    offer: 'Web Scraping se verified contact data, aur WhatsApp Bot jo leads ko automatically catalog bheje', asset: 'data extraction aur bot server' },
  clinic: { pain: 'patient queries ka 24/7 jawab dena mushkil hai aur appointment booking manual hai',
    offer: 'Google Ads se high-value treatment leads, aur ek Smart WhatsApp Bot jo 24/7 query ka jawab de aur appointment book kare', asset: 'domain aur bot server' },
  coaching: { pain: 'naye batch ke liye admission leads laana aur inquiries track karna mushkil hai',
    offer: 'Meta Ads se naye batch ke student leads, aur telecalling team ke liye ek Custom CRM', asset: 'ad-wallet aur CRM server' },
  gym: { pain: 'nearby area mein naye members laana consistent nahi hota',
    offer: '5-10km radius mein Meta Ads, aur ek WhatsApp Bot jo click karne walon ko turant gym tour aur membership packages bheje', asset: 'ad-wallet' },
  garage: { pain: 'booking manual hoti hai aur purane customers wapas nahi aate',
    offer: 'WhatsApp Bot jo rate card aur booking slot turant de, aur 6-mahine baad auto-reminder bheje', asset: 'bot server' },
  salon: { pain: 'calls miss hoti hain aur slot double-book ho jaate hain',
    offer: 'WhatsApp se slot booking bot, jo appointment se pehle auto-reminder bhi bhejta hai', asset: 'bot server' },
  retail: { pain: 'regular customers ko naya stock dikhane ka tareeka nahi hai',
    offer: 'WhatsApp catalog jisse customer dekh kar seedha payment link se order kare', asset: 'catalog aur payment setup' },
  other: { pain: 'naye customers online se consistent tareeke se nahi aate',
    offer: 'aapke business ke hisaab se ek WhatsApp Bot ya Website jo inquiries khud handle kare', asset: 'domain/server' }
};

function buildGrowScript(category, businessName) {
  const s = CATEGORY_SCRIPTS[category] || CATEGORY_SCRIPTS.other;
  return [
    { tag: 'G — Greet', line: `"Hello Sir/Ma'am, main GrowDesk se baat kar raha hu."` },
    { tag: 'R — Reveal Problem', line: `"${businessName ? 'Aapke jaise business mein' : 'Is business mein'} aksar dekha gaya hai ki ${s.pain}."` },
    { tag: 'O — Offer Fix', line: `"Aapke liye hum ${s.offer}."` },
    { tag: 'W — Wrap + Advance', line: `"Iske setup ke liye ${s.asset} lagta hai, toh hum 50% advance leke aaj hi shuru kar sakte hain. Kya hum ek demo discuss karein?"` }
  ];
}

// Mid-call situations a caller commonly runs into, with a ready reply and a
// suggested next CRM action so the lead's status stays honest even when the
// call doesn't close.
const OBJECTIONS = [
  { id: 'busy', label: 'Abhi busy hu', line: 'Koi baat nahi Sir, sirf 2 minute lagenge — ya main aapko thodi der baad phir call karu?', nextStatus: 'follow-up', notePrompt: 'Callback time likho' },
  { id: 'not_interested', label: 'Interested nahi hu', line: 'Samajh sakta hoon Sir. Kya aage chalke zaroorat pade toh contact kar sakta hoon?', nextStatus: 'rejected', notePrompt: 'Reason likho (future reference ke liye)' },
  { id: 'price_high', label: 'Price zyada hai', line: 'Sir yeh ek-baar ka setup hai jo har mahine ka manual kaam bachata hai — long-term mein saving zyada hoti hai. Chhoti starting package bhi dikha sakta hoon.', nextStatus: 'follow-up', notePrompt: '' },
  { id: 'think_about_it', label: 'Sochke batata hu', line: 'Bilkul Sir, sochiye. Main [din] ko phir call karu, taaki confusion na rahe?', nextStatus: 'follow-up', notePrompt: 'Follow-up date likho' },
  { id: 'already_have', label: 'Already solution hai', line: 'Accha hai Sir! Sirf jaanne ke liye — kya usme automatic reminders aur lead tracking bhi hai? Hum wahi gap fill karte hain.', nextStatus: 'follow-up', notePrompt: '' },
  { id: 'no_decision_maker', label: 'Decision maker available nahi', line: 'Koi baat nahi — unka number ya sahi time mil sakta hai kya, main unhe directly contact kar lu?', nextStatus: 'follow-up', notePrompt: 'Decision maker ka number/time likho' },
  { id: 'wants_demo', label: 'Demo maang raha hai', line: 'Bilkul Sir, main aapko WhatsApp par ek demo link abhi bhejta hoon.', nextStatus: 'interested', notePrompt: 'Demo bhej diya — confirm karo' },
  { id: 'trust_advance', label: 'Advance pe trust issue', line: 'Sir samajhta hoon — advance isliye taaki domain/server aapke naam par turant register ho, yeh non-refundable cheez hai. Chahein toh pehle demo dikha du, phir advance baat karte hain.', nextStatus: 'follow-up', notePrompt: '' }
];
