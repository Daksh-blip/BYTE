# BYTE TALKS — Security & Encryption Notes (honest status)

## Stack (platform constraints)
- Expo (React Native) app: iOS, Android, and web preview from one codebase. Native builds come from the Emergent Publish flow.
- FastAPI backend + **MongoDB** (Emergent's managed database; PostgreSQL isn't available here). We use unique indexes for swipes (from,to) and matches (sorted user pair) to stop duplicates.
- Emergent Object Storage for profile photos. Every read goes through an authenticated API route.

## Messaging encryption: what's real
- Every device generates an X25519 key pair (NaCl `box`, via `tweetnacl`, a maintained and audited library). The secret key stays in the device's secure storage (Keychain / Keystore). On web it falls back to browser storage, which is weaker.
- Messages are encrypted on the sender's device with XSalsa20-Poly1305 before they're sent. The server stores only `ciphertext`, `nonce`, and the two public keys. There is no plaintext column and no server key that can decrypt them.
- Clients detect identity-key changes per match and show a warning. Each chat also shows a safety number the two people can compare.
- If the recipient has no public key yet, sending is blocked. The app never falls back to plaintext.

## Known limitations (not yet Signal-grade)
- **No forward secrecy or ratcheting.** Each pair of people uses one static shared key. If a device's secret key is stolen, every past message on that device can be read. Next step: switch to the Signal Protocol (libsignal) with signed and one-time prekeys and a Double Ratchet.
- **One device per account.** Logging in on a new device creates a new key, and older messages show as "Encrypted on another device". There's no secure device-linking flow yet.
- Encrypted attachments, voice notes, typing indicators, read receipts and reactions aren't built yet.
- Like-notes (140 characters, sent with a like) are **not** end-to-end encrypted. The app says so in the UI.
- Metadata the server can see: who matched with whom, message timestamps, message sizes, and when each person was last active.
- End-to-end encryption doesn't stop screenshots, copying by the recipient, or a compromised device.

## Auth
- bcrypt (cost 12). JWT HS256 access token with a 30-day expiry, stored in SecureStore on native devices.
- 6-digit email codes for verification and password reset. Codes are stored as SHA-256 hashes, expire after 15 minutes, and allow at most 5 attempts.
- Rate limiting is in-memory per IP. It needs Redis before running more than one server instance.
- Age is checked on the server (18+). Other members only see the age, never the date of birth.

## Demo data
- 10 seeded demo profiles (`is_seed`) are labelled "Demo profile" everywhere in the app. They may like new members and like back, so the matching flow can be previewed. Remove them before a production launch.
