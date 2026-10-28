# Password-related tests: register validation, login, forgot/reset, change-password, JWT invalidation.
# Uses fresh TEST_ users inserted directly in Mongo (verified, bcrypt) so no emails are sent,
# except forgot-password for an existing account which uses delivered@resend.dev.
# Run right after `sudo supervisorctl restart backend` (in-memory rate limits).
import os
import time
import hashlib
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
import pytest
import requests
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")
BASE_URL = (os.environ.get("EXPO_BACKEND_URL") or os.environ["EXPO_PUBLIC_BACKEND_URL"]).rstrip("/")
API = f"{BASE_URL}/api"
db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
JWT_SECRET = os.environ["JWT_SECRET"]
PW = "OldPassw0rd!"
SAFE_EMAIL = "delivered@resend.dev"


def mk_user(email, pw=PW, verified=True):
    db.users.delete_many({"email": email})
    db.auth_codes.delete_many({"email": email})
    h = bcrypt.hashpw(pw.encode(), bcrypt.gensalt(rounds=4)).decode()
    r = db.users.insert_one({"email": email, "password_hash": h, "verified": verified, "name": "TEST_pw",
                             "role": "user", "status": "active", "created_at": datetime.now(timezone.utc)})
    return str(r.inserted_id)


def old_token(uid, age=120):
    t = datetime.now(timezone.utc) - timedelta(seconds=age)
    return jwt.encode({"sub": uid, "typ": "access", "iat": t, "exp": t + timedelta(days=30)}, JWT_SECRET, algorithm="HS256")


def put_code(email, code="123456", attempts=0, minutes=15):
    db.auth_codes.delete_many({"email": email, "kind": "reset"})
    db.auth_codes.insert_one({"email": email, "kind": "reset", "code_hash": hashlib.sha256(code.encode()).hexdigest(),
                              "attempts": attempts, "expires_at": datetime.now(timezone.utc) + timedelta(minutes=minutes)})


def me(tok):
    return requests.get(f"{API}/me", headers={"Authorization": f"Bearer {tok}"})


@pytest.fixture(scope="module", autouse=True)
def cleanup():
    yield
    db.users.delete_many({"email": {"$regex": "^test_pw_"}})
    db.auth_codes.delete_many({"email": {"$regex": "^test_pw_"}})


# --- registration validation
class TestRegisterValidation:
    def test_short_password_422(self):
        r = requests.post(f"{API}/auth/register", json={"email": "test_pw_reg@example.com", "password": "short1", "name": "T"})
        assert r.status_code == 422, r.text
        assert "8" in r.text

    def test_long_password_422(self):
        r = requests.post(f"{API}/auth/register", json={"email": "test_pw_reg@example.com", "password": "a" * 73, "name": "T"})
        assert r.status_code == 422, r.text
        assert db.users.find_one({"email": "test_pw_reg@example.com"}) is None


# --- login
class TestLogin:
    def test_wrong_pw_and_unknown_email_same_401(self):
        mk_user("test_pw_login@example.com")
        a = requests.post(f"{API}/auth/login", json={"email": "test_pw_login@example.com", "password": "WrongPass1!"})
        b = requests.post(f"{API}/auth/login", json={"email": "test_pw_nobody_x@example.com", "password": "WrongPass1!"})
        assert a.status_code == 401 and b.status_code == 401
        assert a.json()["detail"] == b.json()["detail"] == "Invalid email or password"

    def test_unverified_403(self):
        mk_user("test_pw_unver@example.com", verified=False)
        r = requests.post(f"{API}/auth/login", json={"email": "test_pw_unver@example.com", "password": PW})
        assert r.status_code == 403 and r.json()["detail"] == "EMAIL_NOT_VERIFIED"

    def test_unverified_wrong_pw_gives_401(self):
        r = requests.post(f"{API}/auth/login", json={"email": "test_pw_unver@example.com", "password": "nope12345"})
        assert r.status_code == 401


# --- forgot password (no enumeration)
class TestForgot:
    def test_same_message_existing_and_missing(self):
        if not db.users.find_one({"email": SAFE_EMAIL}):
            mk_user(SAFE_EMAIL)
        a = requests.post(f"{API}/auth/forgot-password", json={"email": SAFE_EMAIL})
        b = requests.post(f"{API}/auth/forgot-password", json={"email": "test_pw_ghost_zz@example.com"})
        assert a.status_code == 200, a.text
        assert b.status_code == 200, b.text
        assert a.json()["message"] == b.json()["message"]
        assert "dev_code" not in a.json() and "dev_code" not in b.json()
        row = db.auth_codes.find_one({"email": SAFE_EMAIL, "kind": "reset"})
        assert row and len(row["code_hash"]) == 64 and row["attempts"] == 0
        db.auth_codes.delete_many({"email": SAFE_EMAIL})


# --- reset password
class TestReset:
    E = "test_pw_reset@example.com"

    def test_wrong_code_attempts_then_lockout(self):
        mk_user(self.E)
        put_code(self.E)
        for i in range(5):
            r = requests.post(f"{API}/auth/reset-password", json={"email": self.E, "code": "000000", "password": "NewPassw0rd!"})
            assert r.status_code == 400 and r.json()["detail"] == "Incorrect or expired code", r.text
            assert db.auth_codes.find_one({"email": self.E})["attempts"] == i + 1
        r = requests.post(f"{API}/auth/reset-password", json={"email": self.E, "code": "123456", "password": "NewPassw0rd!"})
        assert r.status_code == 400 and "Too many wrong attempts" in r.json()["detail"]

    def test_expired_code(self):
        put_code(self.E, minutes=-1)
        r = requests.post(f"{API}/auth/reset-password", json={"email": self.E, "code": "123456", "password": "NewPassw0rd!"})
        assert r.status_code == 400 and "expired" in r.json()["detail"].lower()

    def test_short_new_password_422(self):
        put_code(self.E)
        r = requests.post(f"{API}/auth/reset-password", json={"email": self.E, "code": "123456", "password": "short"})
        assert r.status_code == 422

    def test_correct_code_success_and_single_use(self):
        # separate email: self.E already consumed 7 of its 8/h per-email reset attempts above
        self.E = "test_pw_reset_ok@example.com"
        uid = mk_user(self.E)
        tok = old_token(uid)
        assert me(tok).status_code == 200
        put_code(self.E)
        r = requests.post(f"{API}/auth/reset-password", json={"email": self.E, "code": "123456", "password": "NewPassw0rd!"})
        assert r.status_code == 200, r.text
        assert db.auth_codes.find_one({"email": self.E, "kind": "reset"}) is None
        assert me(tok).status_code == 401
        r2 = requests.post(f"{API}/auth/reset-password", json={"email": self.E, "code": "123456", "password": "Another1234!"})
        assert r2.status_code == 400
        new = requests.post(f"{API}/auth/login", json={"email": self.E, "password": "NewPassw0rd!"})
        assert new.status_code == 200 and new.json()["token"]
        assert me(new.json()["token"]).status_code == 200
        old = requests.post(f"{API}/auth/login", json={"email": self.E, "password": PW})
        assert old.status_code == 401

    def test_reset_marks_unverified_user_verified(self):
        e = "test_pw_reset_unv@example.com"
        mk_user(e, verified=False)
        put_code(e)
        r = requests.post(f"{API}/auth/reset-password", json={"email": e, "code": "123456", "password": "NewPassw0rd!"})
        assert r.status_code == 200
        assert db.users.find_one({"email": e})["verified"] is True


# --- change password (settings)
class TestChangePassword:
    E = "test_pw_change@example.com"

    def test_change_password_flow(self):
        uid = mk_user(self.E)
        tok = old_token(uid)
        h = {"Authorization": f"Bearer {tok}"}
        r = requests.post(f"{API}/me/password", headers=h, json={"current_password": "WrongCur1!", "new_password": "Brandnew123!"})
        assert r.status_code == 400 and r.json()["detail"] == "Current password is incorrect"
        r = requests.post(f"{API}/me/password", headers=h, json={"current_password": PW, "new_password": "short"})
        assert r.status_code == 422
        r = requests.post(f"{API}/me/password", headers=h, json={"current_password": PW, "new_password": PW})
        assert r.status_code == 400 and "different" in r.json()["detail"]
        r = requests.post(f"{API}/me/password", json={"current_password": PW, "new_password": "Brandnew123!"})
        assert r.status_code == 401
        r = requests.post(f"{API}/me/password", headers=h, json={"current_password": PW, "new_password": "Brandnew123!"})
        assert r.status_code == 200 and r.json()["message"] == "Password changed"
        new_tok = r.json()["token"]
        assert me(new_tok).status_code == 200
        assert me(tok).status_code == 401
        lg = requests.post(f"{API}/auth/login", json={"email": self.E, "password": "Brandnew123!"})
        assert lg.status_code == 200

    def test_token_issued_just_before_change_is_invalidated(self):
        # Edge: token issued <1-2s before the change (iat second granularity + changed_at = now-1s)
        e = "test_pw_change2@example.com"
        mk_user(e)
        lg = requests.post(f"{API}/auth/login", json={"email": e, "password": PW})
        assert lg.status_code == 200
        tok = lg.json()["token"]
        r = requests.post(f"{API}/me/password", headers={"Authorization": f"Bearer {tok}"},
                          json={"current_password": PW, "new_password": "Brandnew123!"})
        assert r.status_code == 200
        assert me(r.json()["token"]).status_code == 200
        assert me(tok).status_code == 401, "old session token still valid right after password change"
