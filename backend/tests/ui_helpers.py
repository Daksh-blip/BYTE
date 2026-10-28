# Helper CLI for UI tests: set reset code, ids, matches, legacy chat setup/cleanup, password revert
import sys, os, hashlib, json, datetime
from pymongo import MongoClient
from bson import ObjectId
from dotenv import load_dotenv
import requests

load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")
db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") + "/api"
PW = "ByteTalks123!"


def uid(email):
    return str(db.users.find_one({"email": email})["_id"])


def main():
    cmd = sys.argv[1]
    if cmd == "setcode":
        r = db.auth_codes.update_one({"email": sys.argv[2], "kind": "reset"},
                                     {"$set": {"code_hash": hashlib.sha256(b"123456").hexdigest(), "attempts": 0}})
        print("matched", r.matched_count)
    elif cmd == "ensure_match":
        a, b = uid(sys.argv[2]), uid(sys.argv[3])
        m = db.matches.find_one({"users": sorted([a, b])})
        if not m:
            res = db.matches.insert_one({"users": sorted([a, b]), "created_at": datetime.datetime.utcnow(),
                                   "unread": {}, "active": True, "protocol": "signal-v1"})
            m = db.matches.find_one({"_id": res.inserted_id})
        print(json.dumps(m, default=str))
    elif cmd == "legacy_setup":
        import uuid
        a, b = uid("maya@bytetalks.app"), uid("noah@bytetalks.app")
        db.matches.delete_many({"users": sorted([a, b])})
        res = db.matches.insert_one({"users": sorted([a, b]), "created_at": datetime.datetime.utcnow(),
                               "unread": {}, "active": True})
        mid = str(res.inserted_id)
        db.messages.insert_one({"match_id": mid, "sender_id": b,
                                "ciphertext": "Y2lwaGVy", "nonce": "bm9uY2U=", "sender_public_key": "k" * 44,
                                "recipient_public_key": "j" * 44, "created_at": datetime.datetime.utcnow()})
        print(mid)
    elif cmd == "legacy_check":
        mid = sys.argv[2]
        print("match:", {k: v for k, v in db.matches.find_one({"_id": ObjectId(mid)}).items() if k != "_id"})
        for m in db.messages.find({"match_id": mid}):
            m.pop("_id", None)
            print("msg:", m)
    elif cmd == "legacy_cleanup":
        mid = sys.argv[2]
        db.messages.delete_many({"match_id": mid})
        db.matches.delete_many({"_id": ObjectId(mid)})
        print("cleaned")
    elif cmd == "msgs":
        for m in db.messages.find({"match_id": sys.argv[2]}).sort("created_at", -1).limit(int(sys.argv[3])):
            m.pop("_id", None)
            print({k: (str(v)[:80]) for k, v in m.items()})
    elif cmd == "change_pw":  # email old new
        t = requests.post(f"{BASE}/auth/login", json={"email": sys.argv[2], "password": sys.argv[3]}).json()["token"]
        r = requests.post(f"{BASE}/me/password", json={"current_password": sys.argv[3], "new_password": sys.argv[4]},
                          headers={"Authorization": f"Bearer {t}"})
        print(r.status_code, r.text[:200])
    elif cmd == "login":
        r = requests.post(f"{BASE}/auth/login", json={"email": sys.argv[2], "password": sys.argv[3]})
        print(r.status_code, r.text[:120])


main()
