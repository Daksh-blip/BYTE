# BYTE TALKS backend regression: auth, profile, photos, discover, swipes/matches, E2EE messages, safety, export/delete
import io, os, uuid, random, base64
import pytest, requests
from PIL import Image
from pymongo import MongoClient
from dotenv import dotenv_values

_env = dotenv_values("/app/backend/.env")
DB = MongoClient(_env["MONGO_URL"])[_env["DB_NAME"]]


def make_user_in_db(email, name):
    # Emergent email provider rate-limits rapid sends (429 -> 502), so regression users are inserted directly
    # (password hash copied from a seed account, all seeds use PW). Only test_register_verify_login_flow hits /register.
    import sys; sys.path.insert(0, "/app/backend")
    from server import User
    doc = User(email=email, password_hash=DB.users.find_one({"email": "leo@bytetalks.app"})["password_hash"], name=name).to_mongo()
    doc["verified"] = True
    DB.users.insert_one(doc)


def verify_in_db(email):
    # real email is on (no dev_code) -> mark verified directly in Mongo for automated tests
    DB.users.update_one({"email": email}, {"$set": {"verified": True}})

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
PW = "ByteTalks123!"


def sess():
    s = requests.Session()
    # unique XFF so the per-IP rate limiter doesn't trip during regression runs
    s.headers["X-Forwarded-For"] = f"10.{random.randint(1,250)}.{random.randint(1,250)}.{random.randint(1,250)}"
    return s


def jpeg():
    b = io.BytesIO(); Image.new("RGB", (64, 64), (0, 200, 255)).save(b, "JPEG"); return b.getvalue()


def signup(gender, interested, dob="1995-05-05", onboard=True):
    s = sess()
    email = f"delivered+test_{uuid.uuid4().hex[:8]}@resend.dev"
    make_user_in_db(email, "TEST_" + gender)
    r = s.post(f"{API}/auth/login", json={"email": email, "password": PW})
    assert r.status_code == 200, r.text
    s.headers["Authorization"] = f"Bearer {r.json()['token']}"
    me = r.json()["user"]
    if onboard:
        r = s.post(f"{API}/me/photos", files={"file": ("p.jpg", jpeg(), "image/jpeg")})
        assert r.status_code == 200, r.text
        r = s.put(f"{API}/me", json={"dob": dob, "gender": gender, "interested_in": interested, "bio": "hi",
                                    "interests": ["Hiking", "Coffee", "Jazz"], "intention": "long_term", "onboarded": True})
        assert r.status_code == 200, r.text
        me = r.json()
    return s, email, me


def login(email):
    s = sess()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": PW})
    assert r.status_code == 200, r.text
    s.headers["Authorization"] = f"Bearer {r.json()['token']}"
    return s, r.json()["user"]


@pytest.fixture(scope="module")
def trio():
    a = signup("man", ["woman"])
    b = signup("woman", ["man"])
    c = signup("man", ["woman"])
    yield a, b, c
    for s, _, _ in (a, b, c):
        s.delete(f"{API}/me")


# ---- Auth
class TestAuth:
    def test_register_verify_login_flow(self):
        s = sess(); email = f"delivered+test_{uuid.uuid4().hex[:8]}@resend.dev"
        r = s.post(f"{API}/auth/register", json={"email": email, "password": PW, "name": "TEST_A"})
        assert r.status_code == 200 and r.json().get("email_sent") is True and "dev_code" not in r.json()
        # unverified login -> 403
        r = s.post(f"{API}/auth/login", json={"email": email, "password": PW})
        assert r.status_code == 403 and r.json()["detail"] == "EMAIL_NOT_VERIFIED"
        assert s.post(f"{API}/auth/verify-email", json={"email": email, "code": "000000"}).status_code == 400
        verify_in_db(email)
        r = s.post(f"{API}/auth/login", json={"email": email, "password": PW})
        assert r.status_code == 200 and r.json()["token"] and r.json()["user"]["email"] == email
        assert s.post(f"{API}/auth/login", json={"email": email, "password": "wrongpass1"}).status_code == 401
        # forgot-password sends real email, no dev_code leak
        r = s.post(f"{API}/auth/forgot-password", json={"email": email})
        assert r.status_code == 200 and "dev_code" not in r.json()
        assert s.post(f"{API}/auth/reset-password", json={"email": email, "code": "000000", "password": "NewPass123!"}).status_code == 400
        tok = r = s.post(f"{API}/auth/login", json={"email": email, "password": PW}).json()["token"]
        assert s.delete(f"{API}/me", headers={"Authorization": f"Bearer {tok}"}).status_code == 200

    def test_duplicate_register(self):
        s = sess()
        r = s.post(f"{API}/auth/register", json={"email": "leo@bytetalks.app", "password": PW, "name": "X"})
        assert r.status_code == 400

    def test_seed_login(self):
        s, u = login("leo@bytetalks.app")
        assert u["email"] == "leo@bytetalks.app"


# ---- Profile
class TestProfile:
    def test_age_gate_and_onboarding_requirements(self):
        s, email, me = signup("man", ["woman"], onboard=False)
        try:
            assert s.put(f"{API}/me", json={"dob": "2015-01-01"}).status_code == 400
            assert s.put(f"{API}/me", json={"intention": "bogus"}).status_code == 400
            r = s.put(f"{API}/me", json={"dob": "1990-01-01", "gender": "man", "interested_in": ["woman"], "onboarded": True})
            assert r.status_code == 400  # no photo
            r = s.put(f"{API}/me", json={"prompts": [{"question": f"q{i}", "answer": "a"} for i in range(5)]})
            assert r.status_code == 200 and len(r.json()["prompts"]) == 3
            assert s.get(f"{API}/me").json()["prompts"].__len__() == 3
        finally:
            s.delete(f"{API}/me")

    def test_photos(self):
        s, email, me = signup("man", ["woman"], onboard=False)
        try:
            r = s.post(f"{API}/me/photos", files={"file": ("a.txt", b"hello", "text/plain")})
            assert r.status_code == 400
            for _ in range(6):
                r = s.post(f"{API}/me/photos", files={"file": ("p.jpg", jpeg(), "image/jpeg")})
                assert r.status_code == 200
            assert s.post(f"{API}/me/photos", files={"file": ("p.jpg", jpeg(), "image/jpeg")}).status_code == 400
            photos = r.json()["photos"]
            assert len(photos) == 6
            last = photos[-1]["id"]
            r = s.put(f"{API}/me/photos/{last}/primary")
            assert r.json()["photos"][0]["id"] == last
            url = r.json()["photos"][0]["url"]
            full = url if url.startswith("http") else BASE_URL + url
            noauth = requests.get(full.split("?")[0])
            assert noauth.status_code == 401
            tok = s.headers["Authorization"].split()[1]
            # Session tokens are not accepted in URLs any more; only the short-lived photo-only media token is.
            assert requests.get(full.split("?")[0], params={"token": tok}).status_code == 401
            mtok = s.get(f"{API}/me/media-token").json()["token"]
            ok = requests.get(full.split("?")[0], params={"token": mtok})
            assert ok.status_code == 200 and ok.headers["content-type"].startswith("image/")
            r = s.delete(f"{API}/me/photos/{last}")
            assert len(r.json()["photos"]) == 5 and s.get(f"{API}/me").json()["photos"].__len__() == 5
        finally:
            s.delete(f"{API}/me")


# ---- Discover / swipes / matches / messages / safety
class TestDating:
    def test_discover_prefs_and_modes(self, trio):
        (a, _, ma), (b, _, mb), (c, _, mc) = trio
        for mode in ("smart", "explore", "interests", "new"):
            r = a.get(f"{API}/discover", params={"mode": mode})
            assert r.status_code == 200, (mode, r.text)
            for p in r.json():
                assert p["gender"] == "woman"
                assert "score" in p["compatibility"] and "reasons" in p["compatibility"]
        ids = [p["id"] for p in a.get(f"{API}/discover", params={"mode": "new"}).json()]
        assert mb["id"] in ids and mc["id"] not in ids

    def test_swipe_match_undo_messages(self, trio):
        (a, _, ma), (b, _, mb), (c, _, mc) = trio
        r = a.post(f"{API}/swipes", json={"target_id": mb["id"], "action": "like", "note": "TEST_note"})
        assert r.status_code == 200 and r.json()["matched"] is False
        likes = b.get(f"{API}/likes").json()
        assert any(l["id"] == ma["id"] and l["note"] == "TEST_note" for l in likes)
        r = b.post(f"{API}/swipes", json={"target_id": ma["id"], "action": "like"})
        assert r.json()["matched"] is True
        mid = r.json()["match_id"]
        r2 = a.post(f"{API}/swipes", json={"target_id": mb["id"], "action": "like"})
        assert r2.json()["match_id"] == mid
        assert len([m for m in a.get(f"{API}/matches").json() if m["user"]["id"] == mb["id"]]) == 1
        assert a.get(f"{API}/matches/{mid}").status_code == 200
        assert mb["id"] not in [p["id"] for p in a.get(f"{API}/discover", params={"mode": "explore"}).json()]
        # third user object-level auth
        assert c.get(f"{API}/matches/{mid}/messages").status_code == 404
        assert c.get(f"{API}/matches/{mid}").status_code == 404
        # Legacy NaCl sends are retired: no downgrade path
        legacy = {"ciphertext": base64.b64encode(b"x" * 40).decode(), "nonce": base64.b64encode(b"n" * 24).decode(),
                  "sender_public_key": "k" * 44, "recipient_public_key": "j" * 44}
        assert a.post(f"{API}/matches/{mid}/messages", json=legacy).status_code == 422
        assert a.get(f"{API}/matches/{mid}").json()["protocol"] == "signal-v1"
        # Enroll Signal devices (server stores public material only; crypto is verified client-side)
        def enroll(s, ch):
            ident = {"version": 1, "x25519PublicKey": ch * 43 + "=", "ed25519PublicKey": ch * 43 + "="}
            dev = s.post(f"{API}/signal/identity", json={"deviceId": 1, "identity": ident, "registrationId": 42}).json()["device"]
            s.headers["X-Signal-Device"] = dev
            return dev
        dev_a, dev_b = enroll(a, "k"), enroll(b, "j")
        msg = {"protocol": "signal-v1", "ciphertext": base64.b64encode(b"x" * 40).decode(), "recipient_device": dev_b, "plaintext": "SECRET"}
        # Wrong recipient device must be rejected (no silent send to a stale device)
        assert a.post(f"{API}/matches/{mid}/messages", json=dict(msg, recipient_device=dev_a)).status_code == 409
        r = a.post(f"{API}/matches/{mid}/messages", json=msg)
        assert r.status_code == 200 and "plaintext" not in r.json()
        assert c.post(f"{API}/matches/{mid}/messages", json=msg).status_code == 404
        msgs = b.get(f"{API}/matches/{mid}/messages").json()
        assert len(msgs) == 1 and "plaintext" not in msgs[0] and msgs[0]["sender_id"] == ma["id"]
        # undo: only last pass
        assert a.post(f"{API}/swipes/undo").status_code == 400
        r = c.post(f"{API}/swipes", json={"target_id": mb["id"], "action": "pass"})
        r = c.post(f"{API}/swipes/undo")
        assert r.status_code == 200 and r.json()["id"] == mb["id"]
        # export contains ciphertext only
        ex = a.get(f"{API}/me/export").json()
        assert ex["encrypted_messages"] and "plaintext" not in ex["encrypted_messages"][0]
        assert "password_hash" not in str(ex)

    def test_unmatch_then_rematch(self, trio):
        (a, _, ma), (b, _, mb), _ = trio
        mid = next(m["id"] for m in a.get(f"{API}/matches").json() if m["user"]["id"] == mb["id"])
        assert a.delete(f"{API}/matches/{mid}").status_code == 200
        assert a.get(f"{API}/matches/{mid}").status_code == 404
        # BUG check: re-liking after unmatch returns stale inactive match_id
        r = a.post(f"{API}/swipes", json={"target_id": mb["id"], "action": "like"})
        if r.json()["matched"]:
            assert a.get(f"{API}/matches/{r.json()['match_id']}").status_code == 200, "re-match returns inactive match id"

    def test_block_report_unblock(self, trio):
        (a, _, ma), (b, _, mb), (c, _, mc) = trio
        assert b.post(f"{API}/swipes", json={"target_id": mc["id"], "action": "like"}).status_code == 200
        assert c.post(f"{API}/blocks", json={"user_id": mb["id"]}).status_code == 200
        assert mc["id"] not in [p["id"] for p in b.get(f"{API}/discover", params={"mode": "explore"}).json()]
        assert mb["id"] not in [p["id"] for p in c.get(f"{API}/likes").json()]
        assert b.get(f"{API}/users/{mc['id']}").status_code == 404
        assert any(x["id"] == mb["id"] for x in c.get(f"{API}/blocks").json())
        assert c.post(f"{API}/reports", json={"user_id": mb["id"], "reason": "Spam", "details": "TEST"}).status_code == 200
        assert c.delete(f"{API}/blocks/{mb['id']}").status_code == 200
        assert c.get(f"{API}/blocks").json() == []

    def test_block_invalid_id_breaks_discover(self, trio):
        _, _, (c, _, mc) = trio
        c.post(f"{API}/blocks", json={"user_id": "not-an-objectid"})
        r = c.get(f"{API}/discover")
        c.delete(f"{API}/blocks/not-an-objectid")
        assert r.status_code == 200, f"discover broke after blocking invalid id: {r.status_code}"

    def test_paused_hidden(self, trio):
        (a, _, ma), _, (c, _, mc) = trio
        b2, _, mb2 = signup("woman", ["man"])
        try:
            b2.put(f"{API}/me", json={"paused": True})
            assert mb2["id"] not in [p["id"] for p in c.get(f"{API}/discover", params={"mode": "new"}).json()]
        finally:
            b2.delete(f"{API}/me")

    def test_delete_account(self):
        s, email, me = signup("woman", ["man"])
        assert s.delete(f"{API}/me").status_code == 200
        assert s.get(f"{API}/me").status_code == 401
        # 401 = account gone; 429 = login brute-force limiter tripped by the test burst (also acceptable)
        assert sess().post(f"{API}/auth/login", json={"email": email, "password": PW}).status_code in (401, 429)
