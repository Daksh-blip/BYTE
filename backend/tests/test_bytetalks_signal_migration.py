# Legacy (nacl-box-v1) -> Signal migration: legacy records preserved, explicit one-way upgrade, no downgrade.
import datetime
import os

import requests
from bson import ObjectId
from pymongo import MongoClient

BASE = (os.environ.get("EXPO_BACKEND_URL") or os.environ["EXPO_PUBLIC_BACKEND_URL"]).rstrip("/") + "/api"
db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
PW = "ByteTalks123!"


def session(email):
    s = requests.Session()
    r = s.post(f"{BASE}/auth/login", json={"email": email, "password": PW})
    assert r.status_code == 200, r.text
    s.headers["Authorization"] = f"Bearer {r.json()['token']}"
    return s, r.json()["user"]["id"]


def test_legacy_preserved_and_upgrade_one_way():
    a, ua = session("ava@bytetalks.app")
    b, ub = session("noah@bytetalks.app")
    pair = sorted([ua, ub])
    db.matches.delete_many({"users": pair})
    now = datetime.datetime.now(datetime.timezone.utc)
    mid = str(db.matches.insert_one({"users": pair, "created_at": now, "unread": {}, "active": True}).inserted_id)  # no protocol => legacy
    legacy = {"match_id": mid, "sender_id": ua, "ciphertext": "Y2lwaGVy" * 6, "nonce": "bm9uY2U=" * 4,
              "sender_public_key": "k" * 44, "recipient_public_key": "j" * 44, "created_at": now}
    lid = db.messages.insert_one(dict(legacy)).inserted_id
    try:
        assert a.get(f"{BASE}/matches/{mid}").json()["protocol"] == "nacl-box-v1"
        msgs = b.get(f"{BASE}/matches/{mid}/messages").json()
        assert msgs[0]["protocol"] == "nacl-box-v1" and msgs[0]["nonce"] == legacy["nonce"] and msgs[0]["ciphertext"] == legacy["ciphertext"]
        # A Signal send into a not-yet-upgraded chat is refused (upgrade must be explicit)
        r = a.post(f"{BASE}/matches/{mid}/messages", json={"protocol": "signal-v1", "ciphertexts": {"x": "eA=="}})
        assert r.status_code == 409 and r.json()["detail"] == "UPGRADE_REQUIRED"
        # Non-participant cannot upgrade
        c, _ = session("zara@bytetalks.app")
        assert c.post(f"{BASE}/matches/{mid}/upgrade-encryption").status_code == 404
        assert a.post(f"{BASE}/matches/{mid}/upgrade-encryption").json()["protocol"] == "signal-v1"
        assert a.post(f"{BASE}/matches/{mid}/upgrade-encryption").json()["protocol"] == "signal-v1"  # idempotent, one event
        msgs = b.get(f"{BASE}/matches/{mid}/messages").json()
        assert [m["protocol"] for m in msgs] == ["nacl-box-v1", "system"] and msgs[1]["kind"] == "upgraded"
        # Legacy record untouched in storage (never relabelled or rewritten)
        stored = db.messages.find_one({"_id": lid})
        assert "protocol" not in stored and stored["ciphertext"] == legacy["ciphertext"] and stored["nonce"] == legacy["nonce"]
        # Legacy-format sends stay impossible after upgrade (no downgrade)
        bad = {k: legacy[k] for k in ("ciphertext", "nonce", "sender_public_key", "recipient_public_key")}
        assert a.post(f"{BASE}/matches/{mid}/messages", json=bad).status_code == 422
        assert a.post(f"{BASE}/matches/{mid}/messages", json=dict(bad, protocol="nacl-box-v1")).status_code == 422
        assert db.matches.find_one({"_id": ObjectId(mid)})["protocol"] == "signal-v1"
    finally:
        db.messages.delete_many({"match_id": mid})
        db.matches.delete_one({"_id": ObjectId(mid)})


def test_retired_legacy_key_endpoint():
    a, _ = session("kai@bytetalks.app")
    assert a.put(f"{BASE}/me/public-key", json={"public_key": "k" * 44}).status_code in (404, 405)


def test_media_token_scope():
    a, _ = session("kai@bytetalks.app")
    mt = a.get(f"{BASE}/me/media-token").json()["token"]
    assert requests.get(f"{BASE}/me", headers={"Authorization": f"Bearer {mt}"}).status_code == 401
