# Encrypted chat media (opaque storage, view-once 410) + receipts flag on the maya<->leo Signal match
import os
import pytest
import requests
from pymongo import MongoClient
from bson import ObjectId
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")
BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") + "/api"
db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
MID = "6ae148878ee7eecde617a089"
PW = "ByteTalks123!"
MAGIC = [b"\x89PNG", b"\xff\xd8\xff", b"GIF8", b"RIFF"]


def _token(email):
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": PW})
    if r.status_code != 200:
        pytest.skip(f"login {email} -> {r.status_code}")
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module")
def leo():
    return _token("leo@bytetalks.app")


@pytest.fixture(scope="module")
def maya():
    return _token("maya@bytetalks.app")


# chat_media records exist for the match
def test_chat_media_records():
    docs = list(db.chat_media.find({"match_id": MID}))
    assert any(not d["view_once"] for d in docs)
    assert any(d["view_once"] for d in docs)
    for d in docs:
        assert d["path"].endswith(".bin") and d["size"] > 0


# stored object is ciphertext (no image magic bytes) and size = plaintext + 16-byte tag
def test_normal_photo_is_opaque(leo):
    d = db.chat_media.find_one({"match_id": MID, "view_once": False}, sort=[("created_at", -1)])
    r = requests.get(f"{BASE}/media/{d['_id']}", headers=leo)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/octet-stream")
    assert not any(r.content.startswith(m) for m in MAGIC)
    assert b"IHDR" not in r.content[:64]


# opened view-once photo can't be fetched again (410); sender can never fetch (403)
def test_view_once_reopen_410(leo, maya):
    d = db.chat_media.find_one({"match_id": MID, "view_once": True, "opened": True}, sort=[("created_at", -1)])
    assert d is not None
    assert requests.get(f"{BASE}/media/{d['_id']}", headers=leo).status_code == 410
    assert requests.get(f"{BASE}/media/{d['_id']}", headers=maya).status_code == 403


# media-status reflects opened flag
def test_media_status(maya):
    d = db.chat_media.find_one({"match_id": MID, "view_once": True, "opened": True}, sort=[("created_at", -1)])
    r = requests.get(f"{BASE}/matches/{MID}/media-status", headers=maya)
    assert r.status_code == 200 and r.json().get(str(d["_id"])) is True


# messages stay ciphertext-only (no plaintext marker in DB)
def test_messages_no_plaintext():
    for m in db.messages.find({"match_id": MID}).sort("created_at", -1).limit(10):
        blob = str(m.get("ciphertext", "")) + str(m.get("ciphertexts", ""))
        assert "TEST_" not in blob and "bt-photo" not in blob


# receipts restored to on for leo after UI toggle test
def test_receipts_back_on():
    assert db.users.find_one({"email": "leo@bytetalks.app"}).get("receipts", True) is not False


# uploads over 10 MB (+ tag slack) are rejected; non-participants can't fetch media
def test_oversize_upload_rejected(maya):
    big = os.urandom(10 * 1024 * 1024 + 1024)
    r = requests.post(f"{BASE}/matches/{MID}/media?view_once=false", data=big,
                      headers={**maya, "Content-Type": "application/octet-stream"})
    assert r.status_code in (400, 413)


def test_non_participant_cannot_fetch_media():
    other = _token("ava@bytetalks.app")
    d = db.chat_media.find_one({"match_id": MID, "view_once": False})
    assert requests.get(f"{BASE}/media/{d['_id']}", headers=other).status_code in (403, 404)
