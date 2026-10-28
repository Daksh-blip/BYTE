# Iteration 9: prompt/photo likes (POST /swipes liked_kind/liked_ref, GET /likes liked payload) and demo-profile host gating
import os

import bcrypt
import pytest
import requests
from bson import ObjectId
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")
BASE = (os.environ.get("EXPO_BACKEND_URL") or os.environ["EXPO_PUBLIC_BACKEND_URL"]).rstrip("/") + "/api"
LOCAL = "http://localhost:8001/api"
db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
PW = "TestPass123!"
A_EMAIL, B_EMAIL = "test_iter9_a@example.com", "test_iter9_b@example.com"


def clone(src, email, name):
    db.users.delete_many({"email": email})
    d = db.users.find_one({"email": src})
    d.pop("_id")
    d.update(email=email, name=name, is_seed=False, public_key=None, verified=True, status="active", paused=False,
             password_changed_at=None, password_hash=bcrypt.hashpw(PW.encode(), bcrypt.gensalt(4)).decode())
    return str(db.users.insert_one(d).inserted_id)


def login(email):
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": PW}, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def H(tok, host=None):
    h = {"Authorization": f"Bearer {tok}"}
    if host:
        h["Host"] = host
    return h


@pytest.fixture(scope="module")
def users():
    a = clone("maya@bytetalks.app", A_EMAIL, "TEST_A")  # woman, shows men
    b = clone("leo@bytetalks.app", B_EMAIL, "TEST_B")  # man, shows women
    ta, tb = login(A_EMAIL), login(B_EMAIL)
    seed = db.users.find_one({"email": "leo@bytetalks.app"})
    seed_id = str(seed["_id"])
    # A demo profile likes A so /likes has a seed entry to filter
    db.swipes.update_one({"from_id": seed_id, "to_id": a}, {"$set": {"action": "like", "note": "", "created_at": seed.get("created_at")}}, upsert=True)
    yield {"a": a, "b": b, "ta": ta, "tb": tb, "seed": seed_id}
    ids = [a, b]
    db.swipes.delete_many({"$or": [{"from_id": {"$in": ids}}, {"to_id": {"$in": ids}}]})
    db.matches.delete_many({"users": {"$in": ids}})
    db.users.delete_many({"email": {"$in": [A_EMAIL, B_EMAIL]}})


# Demo profile gating by host
class TestDemoGating:
    def test_preview_discover_has_demo(self, users):
        r = requests.get(f"{BASE}/discover?mode=explore", headers=H(users["tb"]), timeout=20)
        assert r.status_code == 200
        assert any(p.get("is_demo") for p in r.json()), "preview should include demo profiles"

    def test_preview_likes_has_demo(self, users):
        r = requests.get(f"{BASE}/likes", headers=H(users["ta"]), timeout=20)
        assert r.status_code == 200
        assert any(p["id"] == users["seed"] and p.get("is_demo") for p in r.json())

    def test_live_host_discover_no_demo(self, users):
        r = requests.get(f"{LOCAL}/discover?mode=explore", headers=H(users["tb"], "bytetalks.app"), timeout=20)
        assert r.status_code == 200
        assert not any(p.get("is_demo") for p in r.json()), [p["name"] for p in r.json()]

    def test_live_host_likes_no_demo(self, users):
        r = requests.get(f"{LOCAL}/likes", headers=H(users["ta"], "bytetalks.app"), timeout=20)
        assert r.status_code == 200
        assert not any(p.get("is_demo") for p in r.json())

    def test_localhost_discover_has_demo(self, users):
        r = requests.get(f"{LOCAL}/discover?mode=explore", headers=H(users["tb"]), timeout=20)
        assert r.status_code == 200 and any(p.get("is_demo") for p in r.json())


# Prompt / photo likes
class TestPromptPhotoLikes:
    def test_invalid_prompt_ref(self, users):
        for ref in ["99", "abc", "-1", ""]:
            r = requests.post(f"{BASE}/swipes", headers=H(users["tb"]), json={"target_id": users["a"], "action": "like", "liked_kind": "prompt", "liked_ref": ref, "note": ""}, timeout=20)
            assert r.status_code == 400, (ref, r.status_code, r.text)

    def test_invalid_photo_ref(self, users):
        r = requests.post(f"{BASE}/swipes", headers=H(users["tb"]), json={"target_id": users["a"], "action": "like", "liked_kind": "photo", "liked_ref": "nope", "note": ""}, timeout=20)
        assert r.status_code == 400

    def test_invalid_kind_422(self, users):
        r = requests.post(f"{BASE}/swipes", headers=H(users["tb"]), json={"target_id": users["a"], "action": "like", "liked_kind": "video", "liked_ref": "0"}, timeout=20)
        assert r.status_code == 422

    def test_note_too_long_422(self, users):
        r = requests.post(f"{BASE}/swipes", headers=H(users["tb"]), json={"target_id": users["a"], "action": "like", "liked_kind": "prompt", "liked_ref": "0", "note": "x" * 141}, timeout=20)
        assert r.status_code == 422

    def test_prompt_like_and_likes_payload(self, users):
        r = requests.post(f"{BASE}/swipes", headers=H(users["tb"]), json={"target_id": users["a"], "action": "like", "liked_kind": "prompt", "liked_ref": "0", "note": ""}, timeout=20)
        assert r.status_code == 200, r.text
        assert r.json()["matched"] is False
        a_doc = db.users.find_one({"_id": ObjectId(users["a"])})
        lk = requests.get(f"{BASE}/likes", headers=H(users["ta"]), timeout=20).json()
        me = next(p for p in lk if p["id"] == users["b"])
        assert me["liked"] == {"kind": "prompt", "question": a_doc["prompts"][0]["question"], "answer": a_doc["prompts"][0]["answer"]}
        assert me["note"] == ""

    def test_photo_like_with_note(self, users):
        a_doc = db.users.find_one({"_id": ObjectId(users["a"])})
        pid = a_doc["photos"][0]["id"]
        r = requests.post(f"{BASE}/swipes", headers=H(users["tb"]), json={"target_id": users["a"], "action": "like", "liked_kind": "photo", "liked_ref": pid, "note": "  TEST nice pic  "}, timeout=20)
        assert r.status_code == 200, r.text
        lk = requests.get(f"{BASE}/likes", headers=H(users["ta"]), timeout=20).json()
        me = next(p for p in lk if p["id"] == users["b"])
        assert me["liked"]["kind"] == "photo" and me["liked"]["photo_url"]
        assert me["note"] == "TEST nice pic"

    def test_plain_like_clears_liked(self, users):
        r = requests.post(f"{BASE}/swipes", headers=H(users["tb"]), json={"target_id": users["a"], "action": "like"}, timeout=20)
        assert r.status_code == 200
        me = next(p for p in requests.get(f"{BASE}/likes", headers=H(users["ta"]), timeout=20).json() if p["id"] == users["b"])
        assert me["liked"] is None

    def test_superlike_with_prompt(self, users):
        r = requests.post(f"{BASE}/swipes", headers=H(users["tb"]), json={"target_id": users["a"], "action": "superlike", "liked_kind": "prompt", "liked_ref": "0", "note": "TEST"}, timeout=20)
        assert r.status_code == 200
        me = next(p for p in requests.get(f"{BASE}/likes", headers=H(users["ta"]), timeout=20).json() if p["id"] == users["b"])
        assert me["superlike"] is True and me["liked"]["kind"] == "prompt"

    def test_pass_ignores_liked(self, users):
        r = requests.post(f"{BASE}/swipes", headers=H(users["ta"]), json={"target_id": users["b"], "action": "pass", "liked_kind": "prompt", "liked_ref": "99"}, timeout=20)
        assert r.status_code == 200
        doc = db.swipes.find_one({"from_id": users["a"], "to_id": users["b"]})
        assert doc["liked"] is None and doc["note"] == ""
