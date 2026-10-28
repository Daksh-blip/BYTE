# BYTE TALKS — Security & Encryption Notes (honest status, Oct 2026)

Founder & creator: Daksh Mishra.

## 1. Sessions and passwords
- bcrypt (cost 12). Access token: JWT HS256 with `sub`, `pwv` (password version), `jti` and a 30-day expiry, kept in SecureStore on native. **There are no refresh tokens.**
- **Revocation is checked by the server on every protected request.** A token works only while its `pwv` equals the user's `pw_version` in the database and its `jti` isn't in `revoked_sessions`.
- Password reset and change run `$inc pw_version`, so every older token gets 401 straight away. A change uses compare-and-swap on `pw_version`, so of two concurrent changes, one gets 401. The device that made the change gets a fresh token, and its Signal device record follows the new `jti`.
- The client handles 401 for any request that carried the current token: it wipes the token, the photo media token and the in-memory Signal client, then goes to Login with a notice. The session is also re-checked whenever the app returns to the foreground.
- After a reset, the login email is pre-filled from the **server-confirmed** email in the reset response. It's handed over in memory (`src/auth-notice.ts`), never through the URL, history or storage. The password field always starts empty. Reset codes and passwords never go in URLs.
- Generic security emails ("password changed", "new secure-chat device") are sent in the background. They contain no tokens, codes or device details.
- Photo URLs carry only a **6-hour, photo-only media token** (`typ=media`). That token is rejected by every other endpoint, so session tokens never appear in URLs or access logs.
- Forgot-password responses are identical whether or not the account exists. Logs never include passwords, tokens, codes or authorization headers.

## 2. Phase 2 audit — legacy chat encryption (`nacl-box-v1`)
- Library: `tweetnacl` 1.0.3 NaCl `box` (X25519 + XSalsa20-Poly1305), with randomness from `expo-crypto`.
- Keys: one static X25519 key pair per user per device. The secret is in SecureStore on native, or in browser storage on web (weaker). Only the public key was on the server (`users.public_key`). No server-side private keys ever existed.
- Storage: `messages` has `ciphertext`, `nonce`, `sender_public_key` and `recipient_public_key`. There is no plaintext column. The data export includes ciphertext only.
- No attachments, push notifications, analytics or delivery receipts exist, so there was no plaintext leak path there.
- Limitation, stated honestly: **no forward secrecy and no ratchet.** Someone who steals a device's legacy secret key can decrypt every legacy message to or from that key. Old messages are NOT retroactively protected by Signal.
- Mitigation: legacy *sending* is retired. Legacy keys are no longer created or registered (`PUT /me/public-key` was removed), and a legacy chat must be explicitly upgraded before anyone can send in it again. Legacy records are read-only and are decrypted only through `decryptLegacy()` in `src/e2ee.ts`, on devices that still hold the original key.

## 3. Signal Protocol (`signal-v1`)
- Library: `@open-e2ee/signal-protocol-sdk` 13.3.0, MIT OR Apache-2.0, maintained, pure TypeScript.
  - It implements PQXDH (ML-KEM-1024), the Double Ratchet and the SPQR/ML-KEM Braid ratchet. Post-quantum establishment is mandatory, and it fails closed.
  - It is **not wire-compatible with Signal Messenger or official libsignal**. Official `libsignal` has no supported React Native / Hermes binding, so it can't be used in this Expo app without custom native modules.
  - The SDK says it is "reviewed by adversarial AI agents; not audited by any independent firm". BYTE TALKS' integration has also **not** had an independent security review.
- Device-local state:
  - Native: the SDK's SQLCipher database, with its key in the Keychain/Keystore. This needs a development or release build. **In Expo Go it reports "unavailable" and nothing is sent.**
  - Web: the SDK's AES-GCM IndexedDB store. Its key is stored in the same origin, so an XSS attack could read it.
- Decrypted history: Signal deletes message keys after use, so plaintext (sent and received) is kept only on the device. It's encrypted with XChaCha20-Poly1305 under a random key in secure storage (`src/signal/cache.ts`). It is never uploaded.
- Server = relay (`/api/signal/*`). It stores public identity keys, a signed EC prekey, a signed KEM last-resort prekey, and up to 200 EC and 200 KEM one-time prekeys. Bundle fetch pops one-time keys atomically (`find_one_and_update $pop`). Only matched, non-blocked users can read a peer's identity or bundle.
  - Every relay write is bound to the caller's device through the `X-Signal-Device` header and the authenticated user.
  - There is **no endpoint that decrypts anything**.
- Envelope stored per message: `protocol`, `ciphertext` (the SDK's own message format), `sender_device`, `recipient_device`, `sender_id`, `match_id` and `created_at`. The server sets the routing fields from trusted context.
- Fail-closed rules:
  - The message API only accepts `protocol: "signal-v1"`; other formats get 422.
  - The match must be on Signal, or you get 409 `UPGRADE_REQUIRED`.
  - The sender's device must be active (409 `DEVICE_NOT_ACTIVE`), and `recipient_device` must be the recipient's current device (409 `RECIPIENT_DEVICE_CHANGED`).
  - The client never falls back to legacy encryption or plaintext.
- Downgrade protection: new matches and rematches start as `signal-v1`. Legacy chats move with `POST /matches/{id}/upgrade-encryption`, which is explicit, authenticated, one-way, and adds a visible system event. There is no revert endpoint.
- Identity: first contact is trust-on-first-use. If a peer's identity changes, `UntrustedIdentityError` pauses sending and decryption until the user taps Accept (`acceptIdentityRotation`). The safety number comes from the SDK (`verify`) and can be marked as verified.
- Devices: **one active Signal device per account.**
  - Enrolling a new install replaces the old device: the old one is marked inactive and its prekeys are wiped, and the user gets an email.
  - Removing a device in Settings marks it revoked, wipes its prekeys and revokes its login session (`jti`), so it can't silently re-enroll.
  - A device that finds it was replaced or revoked wipes its local protocol state.
  - Secure multi-device linking and history transfer are **not implemented**. A new device can't read messages sent to an earlier one. Messages already on a removed device stay there.
- Recovery: there is no key escrow or backup. Losing the device means losing that device's Signal history, by design.
- Logs: the SDK logger is silenced, so its diagnostic metadata never reaches logs. Backend logs don't contain message bodies.

## 4. Metadata the service still sees
Who matched with whom, when each message was sent, ciphertext size, sender and recipient device records, device platform, IP addresses (used for rate limits), and when people were last active. Like-notes (140 characters) are **not** end-to-end encrypted, and the app says so.

## 5. Not built / remaining risks
- Encrypted chat attachments: chat has no attachments yet, so none were added.
- Real-time delivery: chat polls the API every 3 seconds; there are no websockets or push notifications.
- Plaintext can be lost if the app is killed after a decrypt but before the local cache write.
- Rate limiting is in-memory per process; it needs Redis to scale out.
- Web key custody shares the same origin as the app (an XSS attack would expose it).
- Production needs an independent cryptographic and application security review before claiming "production-secure".
