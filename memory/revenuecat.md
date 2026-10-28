# RevenueCat — integrated (2026-10-27)
This file is a memory for interacting with the user's RevenueCat account via the integration proxy later.

## Identifiers (from /setup response)
- rc_project_id: proj7398e2db
- apple_app_id: appbd0623dbb3
- play_app_id: app4b7591f749
- entitlement_lookup_key: pro
- offering_lookup_key: default
- Packages (package -> product_id, current price):
  - $rc_monthly -> prod9610987a67   (₹199 INR / P1M, trial: none)
  - $rc_annual  -> prodf69f9309a4   (₹1700 INR / P1Y, trial: none)
- Dashboard: https://app.revenuecat.com/projects/proj7398e2db

## Check project_state via status API; if less than project_created, re-fetch RevenueCat playbook via integration expert.
Status: curl -sS -H "$AUTH" "$INTEGRATION_PROXY_URL/internal/revenuecat/projects/f28a43cc-1ea6-4518-a97c-184a011f8e10/status"

## Later product updates (integration proxy ONLY — never the RevenueCat REST API)
- Upsert: POST $INTEGRATION_PROXY_URL/internal/revenuecat/projects/f28a43cc-1ea6-4518-a97c-184a011f8e10/products
  body: {"products":[{"package":"$rc_monthly","price":14.99,"currency":"USD","period":"P1M","prices":[{"amount_micros":14990000,"currency":"USD"}]}]}
- Remove: DELETE .../products/%24rc_monthly
- Recover identifiers / repopulate .env: re-run idempotent /setup.

## App wiring
- src/revenuecat.tsx (configure at module scope in app/_layout.tsx; Purchases.logIn(user.id) in SubscriptionProvider)
- app/premium.tsx paywall (coded), restore button, simulated-purchase label in preview
- Gates (client-side only): Likes grid blur, Same Goals / Has Prompts discover modes, daily likes 25 free / unlimited premium, super-likes 1 free / 5 premium (src/limits.ts)

## Taking purchases LIVE — user steps
1. Upload App Store Connect in-app purchase key / API key (.p8) and Google Play service-account JSON in RevenueCat dashboard.
2. Set up payment profiles in App Store Connect and Play Console.
3. Create matching subscription products with the SAME product IDs as in RevenueCat.
4. Release build → TestFlight / Play internal testing → submit for review.
All steps are in the FAQ section of the payments panel.
- 2026-10-28: prices set to INR ₹199/month, ₹1700/year; $rc_three_month removed.
