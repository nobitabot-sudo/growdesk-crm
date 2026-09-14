// Pulls business leads from the official Google Places API (Text Search + Place Details).
// This is the only "live scrape" source wired up on purpose: Google's API is a
// licensed, ToS-compliant way to pull public business listings with a phone number.
//
// JustDial and Instagram do NOT have an equivalent public API, and both explicitly
// disallow automated scraping in their terms of service — doing it anyway risks
// IP/account bans and takedown notices, not just a technical failure. The safer
// path for those two is: collect listings manually (or via a VA) into a CSV, then
// use POST /api/admin/import — it runs through the exact same dedup + round-robin
// pipeline as this file, so "multiple sources" still land in one deduped pool.
//
// Requires a GOOGLE_PLACES_API_KEY with the Places API enabled, billing attached.
// https://developers.google.com/maps/documentation/places/web-service/overview

const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const TEXT_SEARCH_URL = 'https://maps.googleapis.com/maps/api/place/textsearch/json';
const DETAILS_URL = 'https://maps.googleapis.com/maps/api/place/details/json';

// Conservative (worst-case, "Pro" tier) published per-request rates, in USD,
// used only to estimate spend for the budget cap below — NOT a guarantee of
// your actual bill. Google's free monthly quota is applied on top of your
// account separately; this estimator assumes zero free quota left, so real
// spend for a small run is very likely to come in under this estimate, never
// over it. Verify current numbers against your own Cloud Console before
// relying on this for anything beyond "don't massively overshoot."
const PRICE_PER_TEXT_SEARCH = 0.032; // $32 / 1,000 — Text Search
const PRICE_PER_DETAILS = 0.017;     // $17 / 1,000 — Place Details (Contact + Atmosphere fields)

// A business that already has a website listed on its Google profile has
// already solved "does this business have an online presence" — the thing
// GrowDesk's services exist to fix — so it's a weak lead regardless of size.
// 300+ reviews is a rough proxy for "big enough to already be sorted" (a
// chain, a well-known local institution). Neither threshold is exact; the
// point is steering clear of businesses that clearly don't need us, not a
// precise size cutoff. Adjust FAMOUS_REVIEW_THRESHOLD here if it's off.
const FAMOUS_REVIEW_THRESHOLD = 300;
function isLikelyFamous(details) {
  if (details.website) return true;
  if ((details.user_ratings_total || 0) > FAMOUS_REVIEW_THRESHOLD) return true;
  return false;
}

async function searchPlacesPage(query, city, pageToken) {
  if (!API_KEY) {
    throw new Error('GOOGLE_PLACES_API_KEY is not set. Add it to your environment before scraping.');
  }
  const url = new URL(TEXT_SEARCH_URL);
  url.searchParams.set('query', `${query} in ${city}`);
  url.searchParams.set('key', API_KEY);
  if (pageToken) url.searchParams.set('pagetoken', pageToken);
  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    throw new Error(`Google Places error: ${data.status} — ${data.error_message || ''}`);
  }
  return { results: data.results || [], nextPageToken: data.next_page_token || null };
}

async function searchPlaces(query, city) {
  const results = [];
  let pageToken = null;
  do {
    const page = await searchPlacesPage(query, city, pageToken);
    results.push(...page.results);
    pageToken = page.nextPageToken;
    if (pageToken) await new Promise(r => setTimeout(r, 2000)); // Google requires this delay before a token is valid
  } while (pageToken && results.length < 60);
  return results;
}

async function getPlaceDetails(placeId) {
  const url = new URL(DETAILS_URL);
  url.searchParams.set('place_id', placeId);
  url.searchParams.set('fields', 'formatted_phone_number,rating,user_ratings_total,opening_hours,website,url,types');
  url.searchParams.set('key', API_KEY);
  const res = await fetch(url);
  const data = await res.json();
  return data.result || {};
}

function placeToLead(place, details, city, category) {
  return {
    businessName: place.name,
    phone: details.formatted_phone_number,
    category: category || undefined,
    types: details.types || place.types || [],
    city,
    address: place.formatted_address || '',
    rating: details.rating || null,
    ratingCount: details.user_ratings_total || null,
    website: details.website || '',
    hours: (details.opening_hours?.weekday_text || []).join(' | '),
    mapsUrl: details.url || ''
  };
}

// query: e.g. "cafes", "dental clinics", "gyms" — category: label to store on the lead
// Returns { leads, skippedFamous } — skippedFamous is just for visibility in the summary.
async function scrapeGooglePlaces(query, city, category) {
  const places = await searchPlaces(query, city);
  const leads = [];
  let skippedFamous = 0;
  for (const place of places) {
    const details = await getPlaceDetails(place.place_id);
    if (!details.formatted_phone_number) continue; // no point ingesting a lead nobody can call
    if (isLikelyFamous(details)) { skippedFamous++; continue; }
    leads.push(placeToLead(place, details, city, category));
  }
  return { leads, skippedFamous };
}

// Pulls leads for several categories at once, round-robin (one search page per
// category per round rather than draining one category before the next), and
// stops the instant the running cost estimate would exceed budgetUSD. This is
// how "spread $200 worth across categories, then stop" gets implemented.
//
// categories: [{ key: 'cafe', query: 'cafes and restaurants' }, ...]
// Returns { leads: [...], costEstimate, byCategory: {cafe: 12, ...}, skippedFamous, stoppedReason }
async function scrapeCategoriesWithBudget(categories, city, budgetUSD) {
  const cursors = categories.map(c => ({ ...c, pageToken: null, exhausted: false, started: false }));
  const leads = [];
  const byCategory = {};
  let cost = 0;
  let skippedFamous = 0;
  let stoppedReason = 'all categories exhausted';

  outer:
  while (cursors.some(c => !c.exhausted)) {
    for (const c of cursors) {
      if (c.exhausted) continue;

      if (cost + PRICE_PER_TEXT_SEARCH > budgetUSD) {
        stoppedReason = `budget cap reached ($${budgetUSD})`;
        break outer;
      }
      const page = await searchPlacesPage(c.query, city, c.pageToken || undefined);
      cost += PRICE_PER_TEXT_SEARCH;
      c.started = true;

      for (const place of page.results) {
        if (cost + PRICE_PER_DETAILS > budgetUSD) {
          stoppedReason = `budget cap reached ($${budgetUSD})`;
          break outer;
        }
        const details = await getPlaceDetails(place.place_id);
        cost += PRICE_PER_DETAILS;
        if (!details.formatted_phone_number) continue;
        if (isLikelyFamous(details)) { skippedFamous++; continue; }
        const lead = placeToLead(place, details, city, c.key);
        leads.push(lead);
        byCategory[c.key] = (byCategory[c.key] || 0) + 1;
      }

      if (page.nextPageToken) {
        c.pageToken = page.nextPageToken;
        await new Promise(r => setTimeout(r, 2000)); // required before Google accepts the next page token
      } else {
        c.exhausted = true;
      }
    }
  }

  return { leads, costEstimate: Math.round(cost * 100) / 100, byCategory, skippedFamous, stoppedReason };
}

module.exports = { scrapeGooglePlaces, scrapeCategoriesWithBudget };
