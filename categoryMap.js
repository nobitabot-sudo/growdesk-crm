// Canonical category keys used across the app. Keep this list in sync with
// public/scriptData.js (CATEGORY_SCRIPTS / CATEGORY_LABELS) — that's where the
// per-category call script text lives, on the client since it's caller-facing only.
const CATEGORIES = [
  'cafe', 'caterer', 'realestate', 'b2b', 'clinic', 'coaching',
  'gym', 'garage', 'salon', 'retail', 'other'
];

// Google Places "types" that map cleanly to one of our categories.
const TYPE_MAP = {
  cafe: 'cafe', restaurant: 'cafe', meal_takeaway: 'cafe', meal_delivery: 'cafe', bakery: 'cafe',
  caterer: 'caterer',
  real_estate_agency: 'realestate',
  hospital: 'clinic', doctor: 'clinic', dentist: 'clinic', physiotherapist: 'clinic', health: 'clinic',
  gym: 'gym',
  car_repair: 'garage',
  beauty_salon: 'salon', hair_care: 'salon', spa: 'salon',
  store: 'retail', grocery_or_supermarket: 'retail', clothing_store: 'retail', supermarket: 'retail',
};

// Fallback keyword match against the search query / business name when
// Google's "types" don't cover it (coaching institutes and B2B wholesalers
// rarely come tagged usefully) or when a lead arrives via CSV import with no
// types at all.
const KEYWORD_MAP = [
  [/coaching|academy|institute|classes|tuition/i, 'coaching'],
  [/wholesale|manufactur|supplier|distributor|b2b/i, 'b2b'],
  [/cafe|restaurant|caterer|food|bakery/i, 'cafe'],
  [/real estate|builder|broker|property/i, 'realestate'],
  [/clinic|hospital|dental|doctor|physio/i, 'clinic'],
  [/gym|fitness/i, 'gym'],
  [/garage|car service|automobile|workshop/i, 'garage'],
  [/salon|spa|parlour|parlor/i, 'salon'],
  [/retail|kirana|store|shop|mart/i, 'retail'],
];

function inferCategory({ types = [], text = '' } = {}) {
  for (const t of types) {
    if (TYPE_MAP[t]) return TYPE_MAP[t];
  }
  for (const [re, cat] of KEYWORD_MAP) {
    if (re.test(text)) return cat;
  }
  return 'other';
}

module.exports = { CATEGORIES, inferCategory };
