// Integration test: two independent Signal clients talking through the real BYTE TALKS backend relay.
// Run:  cd /app/frontend && node tests/signal_e2e.mjs
import { createSignalProtocolClient, ProtocolAddress, isUntrustedIdentityError } from "@open-e2ee/signal-protocol-sdk";
import { inMemoryStore } from "@open-e2ee/signal-protocol-sdk/local/store/memory";
import { execFileSync } from "node:child_process";
import { makeRelay } from "../src/signal/relay.ts";

// DB access through a tiny Python/pymongo helper (backend env), so the test needs no extra npm packages.
const q = (code) => JSON.parse(execFileSync("python3", ["-c", `import os,json,sys\nfrom bson import ObjectId, json_util\nfrom dotenv import load_dotenv\nload_dotenv("/app/backend/.env")\nfrom pymongo import MongoClient\ndb=MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]\n${code}`]).toString());

const B = (process.env.API || "http://localhost:8001") + "/api";
const PW = "ByteTalks123!";
const quiet = { debug() {}, info() {}, warn() {}, error() {}, breadcrumb() {} };
let pass = 0, fail = 0;
const ok = (c, name) => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${name}`); };

async function login(email) {
  const r = await fetch(B + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PW }) });
  return (await r.json());
}
function caller(token, dev) {
  return async (method, path, body) => {
    const h = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
    if (dev.id) h["X-Signal-Device"] = dev.id;
    const r = await fetch(B + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const t = await r.text(); const d = t ? JSON.parse(t) : null;
    if (!r.ok) { const e = new Error(d?.detail ?? r.status); e.status = r.status; throw e; }
    return d;
  };
}
async function device(email) {
  const s = await login(email); const dev = { id: null };
  const call = caller(s.token, dev);
  const client = await createSignalProtocolClient({ identity: { userId: s.user.id }, adapters: { storage: inMemoryStore(), relay: makeRelay(call, "test", (id) => (dev.id = id)) }, logger: quiet });
  return { uid: s.user.id, call, client, dev, token: s.token };
}


const A = await device("lena@bytetalks.app");
const Bo = await device("omar@bytetalks.app");
ok(A.dev.id && Bo.dev.id, "both devices enrolled via provisionIdentityKey");
const pair = [A.uid, Bo.uid].sort();
const mid = q(`import datetime\npair=${JSON.stringify(pair)}\ndb.matches.delete_many({"users":pair})\nr=db.matches.insert_one({"users":pair,"created_at":datetime.datetime.now(datetime.timezone.utc),"unread":{},"active":True,"protocol":"signal-v1"})\nprint(json.dumps(str(r.inserted_id)))`);

const dev = () => q(`print(json_util.dumps(db.signal_devices.find_one({"user_id":"${Bo.uid}","active":True})))`);
const before = dev();
ok(before.ec.length > 0 && before.kem.length > 0 && before.spk && before.lr, "prekeys uploaded (EC + KEM one-time, signed, last-resort)");
ok(!JSON.stringify(before).match(/private|secret/i), "server device record holds no private keys");

const bob = ProtocolAddress.create(Bo.uid, 1), alice = ProtocolAddress.create(A.uid, 1);
const b1 = await A.call("POST", `/signal/bundle/${Bo.uid}`);
const after = dev();
ok(after.ec.length === before.ec.length - 1 && after.kem.length === before.kem.length - 1, "bundle fetch atomically consumed one EC + one KEM one-time prekey");
await A.client.establishSession(bob, b1.bundle);
const secret = "meet at 7, the blue cafe 🔐";
const ct = await A.client.encryptMessage(bob, secret);
const sent = await A.call("POST", `/matches/${mid}/messages`, { protocol: "signal-v1", ciphertext: ct, recipient_device: b1.device });
const stored = q(`print(json_util.dumps(db.messages.find_one({"_id":ObjectId("${sent.id}")})))`);
ok(stored.protocol === "signal-v1" && !JSON.stringify(stored).includes("blue cafe"), "DB stores Signal ciphertext only, no plaintext");
const got = await Bo.call("GET", `/matches/${mid}/messages`);
const m1 = got.find((m) => m.id === sent.id);
ok(m1.sender_device === A.dev.id && m1.recipient_device === Bo.dev.id, "server-set routing metadata (sender/recipient device)");
ok((await Bo.client.decryptMessage(alice, m1.ciphertext)) === secret, "client B decrypts the exact plaintext");
const reply = await Bo.client.encryptMessage(alice, "see you there");
ok((await A.client.decryptMessage(bob, reply)) === "see you there", "reply on the same ratchet decrypts");

let replay = false; try { await Bo.client.decryptMessage(alice, m1.ciphertext); replay = true; } catch {} ok(!replay, "replayed ciphertext rejected");
const c3 = await A.client.encryptMessage(bob, "three"), c4 = await A.client.encryptMessage(bob, "four");
ok((await Bo.client.decryptMessage(alice, c4)) === "four" && (await Bo.client.decryptMessage(alice, c3)) === "three", "out-of-order delivery decrypts (skipped keys)");
const c5 = await A.client.encryptMessage(bob, "five");
const bad = c5.slice(0, 80) + (c5[80] === "A" ? "B" : "A") + c5.slice(81);
let tam = false; try { await Bo.client.decryptMessage(alice, bad); tam = true; } catch {} ok(!tam, "tampered ciphertext fails authentication");
ok((await Bo.client.decryptMessage(alice, c5)) === "five", "original still decrypts after tamper attempt");

const E = await device("sofia@bytetalks.app");
let eve = false; try { await E.client.decryptMessage(alice, c4); eve = true; } catch {} ok(!eve, "wrong recipient cannot decrypt");
let eb = 0; try { await E.call("POST", `/signal/bundle/${Bo.uid}`); } catch (e) { eb = e.status; } ok(eb === 404, "non-match cannot fetch a prekey bundle");
let ei = 0; try { await E.call("GET", `/signal/identity/${Bo.uid}`); } catch (e) { ei = e.status; } ok(ei === 404, "non-match cannot read identity");

let leg = 0; try { await A.call("POST", `/matches/${mid}/messages`, { ciphertext: "x".repeat(40), nonce: "n".repeat(32), sender_public_key: "a", recipient_public_key: "b" }); } catch (e) { leg = e.status; }
ok(leg === 422, "legacy-format send rejected (no downgrade)");
let wd = 0; try { await A.call("POST", `/matches/${mid}/messages`, { protocol: "signal-v1", ciphertext: ct, recipient_device: A.dev.id }); } catch (e) { wd = e.message; }
ok(wd === "RECIPIENT_DEVICE_CHANGED", "send to a non-active recipient device rejected");

// Bob reinstalls: new identity replaces the old device; Alice must explicitly accept before sending.
const oldBobDev = Bo.dev.id;
const Bo2 = await device("omar@bytetalks.app");
ok(Bo2.dev.id !== oldBobDev, "new install enrolls a new device");
const st = await Bo.call("GET", `/signal/device-status?device=${oldBobDev}`);
ok(st.active === false, "old device marked replaced (stops receiving)");
let ret = 0; try { await Bo.call("POST", "/signal/prekeys", { keys: [] }); } catch (e) { ret = e.message; } ok(ret === "DEVICE_REVOKED", "replaced device cannot publish prekeys");
await A.client.deleteSession(bob);
const b2 = await A.call("POST", `/signal/bundle/${Bo.uid}`);
let untrusted = null; try { await A.client.establishSession(bob, b2.bundle); } catch (e) { if (isUntrustedIdentityError(e)) untrusted = e; }
ok(!!untrusted, "identity change fails closed (UntrustedIdentityError)");
await A.client.acceptIdentityRotation(Bo.uid, untrusted.identity);
await A.client.establishSession(bob, (await A.call("POST", `/signal/bundle/${Bo.uid}`)).bundle);
ok((await Bo2.client.decryptMessage(alice, await A.client.encryptMessage(bob, "new phone?"))) === "new phone?", "after explicit acceptance, new device decrypts");

// Device revocation ends that device's login session too.
const devs = await Bo2.call("GET", "/signal/devices");
ok(devs.some((d) => d.current) && devs.some((d) => !d.active), "device list shows current and replaced devices");
await Bo2.call("DELETE", `/signal/devices/${oldBobDev}`);
let rs = 0; try { await Bo.call("GET", "/me"); } catch (e) { rs = e.status; } ok(rs === 401, "revoked device's session is signed out");
let self = 0; try { await Bo2.call("DELETE", `/signal/devices/${Bo2.dev.id}`); } catch (e) { self = e.status; } ok(self === 400, "current device can't revoke itself");

q(`db.messages.delete_many({"match_id":"${mid}"})\ndb.matches.delete_one({"_id":ObjectId("${mid}")})\nprint(1)`);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
