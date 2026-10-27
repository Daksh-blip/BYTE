# BYTE TALKS — PRD

## Original problem statement
Build BYTE TALKS: a privacy-first, conversation-first dating platform for adults 18+. Requirements: real accounts, email verification, onboarding, explainable matching, several discovery modes, genuine end-to-end encrypted messaging, trust & safety tools, premium dark design, honest demo data, data export and deletion. No fake matches or fake E2EE, and limitations must be stated honestly. (The full 26-section spec is in the conversation.)

## User choices
- Scope: core dating flow plus client-side E2EE messaging, built in phases toward the full spec.
- Auth: email + password with email verification. The Emergent email key isn't provisioned in preview, so codes are shown in the app.
- E2EE: tweetnacl (NaCl box). Signal Protocol is the planned upgrade.
- Photos: Emergent Object Storage.
- Theme: dark midnight with cyan/violet/pink accents.

## Architecture
- Expo Router app (iOS/Android/web) with 4 tabs: Discover, Likes, Chats, Profile. Native tabs on iOS 26+.
- FastAPI single service (`/app/backend/server.py`) + MongoDB (PostgreSQL isn't available on the platform). Unique indexes on swipes and matches.
- E2EE: X25519 key pair generated per device and kept in SecureStore. Messages are encrypted and decrypted only on the client. The server stores ciphertext, nonce and public keys only, and returns 409 when keys don't match.
- Details and limitations: `/app/memory/SECURITY.md`.

## Implemented (Oct 2026)
- Register, 6-digit email verify, login, forgot/reset password. Codes are hashed, expire, and allow limited attempts. Rate limiting per IP (right-most public XFF) and per email.
- Server-side 18+ age gate; other members see age only, never the date of birth.
- 4-step onboarding: birthday, gender / who to see / intention, photos, bio + interests.
- Photos: upload (max 6), delete, set main; permission flow with an Open Settings fallback.
- Discovery modes: Smart Picks (top 10 by compatibility), Explore, Shared Interests, New Here. Preferences are respected in both directions, plus age range, blocks and pauses.
- Explainable compatibility ("Why you might click") with a disclaimer.
- Like, pass and super-like (swipe gestures + buttons), undo of the last pass, like with a note, mutual match modal, Likes grid.
- Chats: new matches row and conversation list with unread counts.
- E2EE chat: safety number, key-change warning, icebreakers (tap to fill, never auto-sent), "waiting for keys" state.
- Profile: prompts (3), pronouns, languages, intentions, profile preview, completion meter.
- Safety: report (with reasons) + block, unmatch, blocked list and unblock, Safety center tips, pause profile.
- Account: data export (JSON; messages as ciphertext only), permanent deletion.
- 10 demo profiles, clearly labelled "Demo profile".
- Backend tests: `/app/backend/tests/` — 17 tests pass.

## Backlog
### P0
- Signal Protocol (forward secrecy, prekeys, Double Ratchet) and secure multi-device linking.
- Real email delivery once the Emergent email key is provisioned.
- Admin/moderation dashboard (report queue, suspend/ban, appeals, audit log).
### P1
- Real-time delivery (WebSocket), sent/delivered/read receipts, typing indicators, reactions and replies.
- Encrypted image attachments.
- Approximate-location "Nearby" mode with permission.
- Selfie verification.
- Notification preferences.
- Light theme.
### P2
- Subscriptions (premium filters/boosts; safety features never paywalled).
- Voice intros.
- Date-idea suggestions.
- Session/device management.
- MFA.
- Split `server.py` into routers.
- Redis-backed rate limiting.
