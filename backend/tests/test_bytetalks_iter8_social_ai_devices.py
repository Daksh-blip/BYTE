# Iteration 8: social sign-in rejection paths, Signal device pending/takeover/revoke, Claude AI endpoints
import base64
import datetime
import json
import os

import pytest
import requests
from bson import ObjectId
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")
BASE = (os.environ.get("EXPO_BACKEND_URL") or os.environ["EXPO_PUBLIC_BACKEND_URL"]).rstrip("/") + "/api"
db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
PW = "ByteTalks123!"
ADMIN = ("admin@bytetalks.app", "D3WjHmkeB2WPkSgX8ZLLXf5")
MATCH = "6ae148878ee7eecde617a089"
TEST_EMAIL = "test_iter8_devices@bytetalks.app"


def login(email, pw=PW):
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": pw}, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def jti(tok):
    p = tok.split(".")[1]
    return json.loads(base64.urlsafe_b64decode(p + "=" * (-len(p) % 4)))["jti"]


def H(tok, dev=None):
    h = {"Authorization": f"Bearer {tok}"}
    if dev:
        h["X-Signal-Device"] = dev
    return h


# ---------- social sign-in rejection
class TestSocial:
    def test_google_bogus_session_401(self):
        r = requests.post(f"{BASE}/auth/google", json={"session_id": "bogus-session-123"}, timeout=30)
        assert r.status_code == 401, r.text
        assert "Google" in r.json()["detail"]

    def test_google_short_session_422(self):
        assert requests.post(f"{BASE}/auth/google", json={"session_id": "x"}, timeout=20).status_code == 422

    def test_apple_invalid_token_401(self):
        r = requests.post(f"{BASE}/auth/apple", json={"identity_token": "eyJhbGciOiJSUzI1NiJ9.invalid.token-abcdef", "name": "X"}, timeout=30)
        assert r.status_code == 401, r.text


# ---------- Signal devices (synthetic user + device docs)
@pytest.fixture(scope="class")
def dev_user():
    db.users.delete_many({"email": TEST_EMAIL})
    src = db.users.find_one({"email": "ethan@bytetalks.app"})
    doc = {k: v for k, v in src.items() if k != "_id"}
    doc.update({"email": TEST_EMAIL, "name": "TEST_Iter8", "is_seed": False, "pw_version": 0, "verified": True, "status": "active"})
    uid = str(db.users.insert_one(doc).inserted_id)
    yield uid
    db.signal_devices.delete_many({"user_id": uid})
    db.users.delete_many({"email": TEST_EMAIL})


def mkdev(uid, active, pending, jti_val, expires_min=15, created_ago=0):
    n = datetime.datetime.utcnow()
    return str(db.signal_devices.insert_one({
        "user_id": uid, "device_id": 1, "sig_uid": f"{uid}.{ObjectId()}", "identity": {}, "registration_id": 1,
        "active": active, "pending": pending, "link_code": "x" if pending else None, "link_attempts": 0,
        "link_expires": n + datetime.timedelta(minutes=expires_min), "platform": "web", "session_jti": jti_val,
        "created_at": n - datetime.timedelta(minutes=created_ago), "spk": None, "lr": None, "ec": [], "kem": []}).inserted_id)


class TestDevices:
    def test_list_hides_expired_pending(self, dev_user):
        t = login(TEST_EMAIL)
        a = mkdev(dev_user, True, False, jti(t))
        live_p = mkdev(dev_user, False, True, "j-live")
        exp_p = mkdev(dev_user, False, True, "j-exp", expires_min=-5, created_ago=30)
        ids = [d["id"] for d in requests.get(f"{BASE}/signal/devices", headers=H(t, a), timeout=20).json()]
        assert live_p in ids and a in ids
        assert exp_p not in ids
        # caller's own expired pending record is still shown
        ids2 = [d["id"] for d in requests.get(f"{BASE}/signal/devices", headers=H(t, exp_p), timeout=20).json()]
        assert exp_p in ids2

    def test_delete_pending_sets_pending_false(self, dev_user):
        t = login(TEST_EMAIL)
        a = mkdev(dev_user, True, False, jti(t))
        t2 = login(TEST_EMAIL)
        p = mkdev(dev_user, False, True, jti(t2))
        r = requests.delete(f"{BASE}/signal/devices/{p}", headers=H(t, a), timeout=20)
        assert r.status_code == 200, r.text
        d = db.signal_devices.find_one({"_id": ObjectId(p)})
        assert d["pending"] is False and d["active"] is False and d["revoked_reason"] == "revoked"
        assert requests.get(f"{BASE}/me", headers=H(t2), timeout=20).status_code == 401
        listed = {x["id"]: x for x in requests.get(f"{BASE}/signal/devices", headers=H(t, a), timeout=20).json()}
        assert p not in listed or listed[p]["pending"] is False

    def test_takeover_revokes_active_and_pending(self, dev_user):
        db.signal_devices.delete_many({"user_id": dev_user})
        ta, tp, tme = login(TEST_EMAIL), login(TEST_EMAIL), login(TEST_EMAIL)
        a = mkdev(dev_user, True, False, jti(ta))
        other_p = mkdev(dev_user, False, True, jti(tp))
        me = mkdev(dev_user, False, True, jti(tme))
        bad = requests.post(f"{BASE}/signal/takeover", json={"password": "wrong-pass"}, headers=H(tme, me), timeout=20)
        assert bad.status_code == 400
        r = requests.post(f"{BASE}/signal/takeover", json={"password": PW}, headers=H(tme, me), timeout=20)
        assert r.status_code == 200, r.text
        da, dp, dm = (db.signal_devices.find_one({"_id": ObjectId(x)}) for x in (a, other_p, me))
        assert dm["active"] is True and dm["pending"] is False
        assert da["active"] is False and da["revoked_reason"] == "revoked"
        assert dp["pending"] is False and dp["active"] is False and dp["revoked_reason"] == "revoked"
        assert requests.get(f"{BASE}/me", headers=H(ta), timeout=20).status_code == 401
        assert requests.get(f"{BASE}/me", headers=H(tp), timeout=20).status_code == 401
        assert requests.get(f"{BASE}/me", headers=H(tme), timeout=20).status_code == 200


# ---------- Claude AI
@pytest.fixture(scope="module")
def maya():
    return login("maya@bytetalks.app")


class TestAI:
    def test_icebreakers(self, maya):
        r = requests.post(f"{BASE}/ai/icebreakers/{MATCH}", headers=H(maya), timeout=90)
        assert r.status_code == 200, r.text
        ib = r.json()["icebreakers"]
        assert len(ib) == 3 and all(isinstance(x, str) and x for x in ib)

    def test_date_ideas(self, maya):
        r = requests.post(f"{BASE}/ai/date-ideas/{MATCH}", headers=H(maya), timeout=90)
        assert r.status_code == 200, r.text
        ideas = r.json()["ideas"]
        assert 1 <= len(ideas) <= 3 and all(i["title"] and i["why"] for i in ideas)

    def test_bio(self, maya):
        r = requests.post(f"{BASE}/ai/bio", json={"draft": "I like hiking and coffee"}, headers=H(maya), timeout=90)
        assert r.status_code == 200, r.text
        assert len(r.json()["bios"]) == 2

    def test_non_member_404(self):
        t = login("ethan@bytetalks.app")
        assert requests.post(f"{BASE}/ai/icebreakers/{MATCH}", headers=H(t), timeout=30).status_code == 404
        assert requests.post(f"{BASE}/ai/date-ideas/{MATCH}", headers=H(t), timeout=30).status_code == 404

    def test_unauth_401(self):
        assert requests.post(f"{BASE}/ai/bio", json={"draft": ""}, timeout=20).status_code in (401, 403)

    def test_report_summary_admin_and_forbidden(self, maya):
        at = login(*ADMIN)
        reps = requests.get(f"{BASE}/admin/reports", headers=H(at), timeout=20).json()
        if not reps:
            reps = requests.get(f"{BASE}/admin/reports?status=resolved", headers=H(at), timeout=20).json()
        if not reps:
            pytest.skip("no reports")
        rid = reps[0]["id"]
        assert requests.post(f"{BASE}/admin/reports/{rid}/ai-summary", headers=H(maya), timeout=20).status_code == 403
        r = requests.post(f"{BASE}/admin/reports/{rid}/ai-summary", headers=H(at), timeout=90)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["summary"] and d["risk"] in ("low", "medium", "high") and d["suggested_action"] in ("dismiss", "warn", "suspend", "ban")
        assert requests.post(f"{BASE}/admin/reports/{ObjectId()}/ai-summary", headers=H(at), timeout=20).status_code == 404
