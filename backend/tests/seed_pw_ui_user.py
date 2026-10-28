# Seeds an onboarded, verified UI test user (delivered@resend.dev) cloned from demo Noah, and sets a known reset code.
import sys, hashlib
from datetime import datetime, timedelta, timezone
import bcrypt
from pymongo import MongoClient
from dotenv import load_dotenv
import os

load_dotenv("/app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
EMAIL = "delivered@resend.dev"
cmd = sys.argv[1]
if cmd == "user":
    db.users.delete_many({"email": EMAIL})
    d = db.users.find_one({"email": "noah@bytetalks.app"})
    d.pop("_id")
    d.update(email=EMAIL, name="TESTPw", is_seed=False, public_key=None, verified=True, status="active",
             password_changed_at=None, password_hash=bcrypt.hashpw(sys.argv[2].encode(), bcrypt.gensalt(4)).decode())
    print(db.users.insert_one(d).inserted_id)
elif cmd == "code":
    db.auth_codes.delete_many({"email": EMAIL, "kind": "reset"})
    db.auth_codes.insert_one({"email": EMAIL, "kind": "reset", "code_hash": hashlib.sha256(b"123456").hexdigest(),
                              "attempts": 0, "expires_at": datetime.now(timezone.utc) + timedelta(minutes=15)})
    print("code set")
elif cmd == "suspend":
    db.users.update_one({"email": EMAIL}, {"$set": {"status": "suspended", "suspended_until": datetime.now(timezone.utc) + timedelta(days=2)}}); print("suspended")
elif cmd == "clean":
    db.users.delete_many({"email": EMAIL}); db.auth_codes.delete_many({"email": EMAIL}); print("cleaned")
