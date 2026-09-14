// Single source of truth for what the GrowDesk Bot knows. Keep this in sync
// with public/scriptData.js and the training app's pricing whenever the
// service list or prices change — the bot only ever answers from this text.
const BUSINESS_KNOWLEDGE = `
GROWDESK — SERVICES AND PRICING

1. Custom Website Development — ₹7,999 to ₹14,999
   Smart websites/landing pages for direct orders and bookings.

2. Performance Ads (Meta/Google) — ₹9,999 to ₹14,999/month agency fee, PLUS 100% of the ad budget itself paid upfront
   Targeted local ads that generate verified leads on WhatsApp.

3. WhatsApp Automation Bot — ₹2,499 one-time setup + ₹500/month
   AI bot for instant replies, sending menus/catalogs, taking 24/7 orders.

4. Custom Telecalling CRM — ₹7,999 to ₹14,999
   Admin dashboard to track telecaller leads, voice notes, agent performance.

5. Web Scraping & B2B Data — custom quote, ask admin for current rate
   Extracting verified contact details (HRs, clinics, etc.) for B2B outreach.

6. Table-Top QR Ordering — ₹7,999 to ₹14,999
   System for cafes/restaurants where customers scan a QR at their table to order and pay.

7. Salon & Spa Booking Bot — ₹4,999 to ₹8,999
   WhatsApp booking bot with auto-reminders before appointments.

8. Retail / Kirana WhatsApp Catalog — ₹4,999 to ₹7,999
   WhatsApp catalog + payment link so regular customers can reorder easily.

9. AI Voice Follow-up Agent — ₹5,999 one-time + ₹999/month
   AI calls back missed leads automatically, confirms interest, hands over to a human.

ADVANCE PAYMENT LOGIC — WHY WE CHARGE ADVANCE
Websites, CRM, QR systems, Salon/Retail bots: 50% advance, because domain names and
cloud servers get purchased and registered in the client's name immediately, and
these are non-refundable once bought.
Performance Ads: 100% of the ad budget upfront (it goes straight into the client's
Meta/Google ad wallet) PLUS 50% advance on our management fee.
WhatsApp Bot / AI Voice Agent: setup fee is one-time upfront; the monthly fee is
prepaid because Meta charges per conversation and we're managing that wallet plus
server maintenance.
One-line explanation callers can use for ANY service: "Sir, jo bhi banate hain woh
aapke naam par register hota hai — domain, server, ya ad-wallet — aur yeh cheezein
non-refundable hain. Isliye humein 50% advance chahiye taaki hum yeh aapke liye
aaj hi book kar sakein."

COMBO PRICING — HOW TO ANSWER "I WANT MULTIPLE THINGS, WHAT'S THE TOTAL PRICE"
There is no fixed bundle discount by default. Add up each service's price from the
list above for a ballpark estimate, then always say it's an estimate and the exact
final number should be confirmed with the admin before quoting a client formally —
never invent a discount or a bundle price that isn't listed here.

WHO WE SELL TO (typical categories)
Cafes & restaurants, caterers, real estate brokers/builders, B2B wholesalers,
hospitals/clinics/dentists, coaching institutes, gyms, car garages, salons & spas,
retail/kirana stores.

WHAT WE DON'T TARGET
Already-famous/large businesses that already have a website and strong online
presence — they're not a good fit for these services since they've likely already
solved the problem we sell a solution to.

THINGS THIS BOT SHOULD NOT GUESS ABOUT
Exact custom quotes for non-standard requests, discount approvals, refund policy
specifics, and anything about a specific ongoing client deal — for all of these,
say to check with the admin rather than making something up.
`.trim();

module.exports = { BUSINESS_KNOWLEDGE };
