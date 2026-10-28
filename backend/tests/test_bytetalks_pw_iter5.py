# Iteration 5 retest of password fixes: pw_version revocation, uniform reset/verify errors,
# forgot-password timing, 72-byte limit (multi-byte), change-password token.
# Run right after `sudo supervisorctl restart backend` (in-memory rate limits).
import os
import time
import hashlib
import statistics
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
LONG_MB = "密" * 25  # 25 chars, 75 bytes


def mk_user(email, pw=PW, verified=True):
    db.users.delete_many({"email": email})
    db.auth_codes.delete_many({"email": email})
    h = bcrypt.hashpw(pw.encode(), bcrypt.gensalt(rounds=4)).decode()
    r = db.users.insert_one({"email": email, "password_hash": h, "verified": verified, "name": "TEST_pw5",
                             "role": "user", "status": "active", "created_at": datetime.now(timezone.utc)})
    return str(r.inserted_id)


def put_code(email, kind="reset", code="123456", minutes=15):
    db.auth_codes.delete_many({"email": email, "kind": kind})
    db.auth_codes.insert_one({"email": email, "kind": kind, "code_hash": hashlib.sha256(code.encode()).hexdigest(),
                              "attempts": 0, "expires_at": datetime.now(timezone.utc) + timedelta(minutes=minutes)})


def login(email, pw):
    return requests.post(f"{API}/auth/login", json={"email": email, "password": pw})


def me(tok):
    return requests.get(f"{API}/me", headers={"Authorization": f"Bearer {tok}"})


@pytest.fixture(scope="module", autouse=True)
def cleanup():
    yield
    db.users.delete_many({"email": {"$regex": "^test_pw5_"}})
    db.auth_codes.delete_many({"email": {"$regex": "^test_pw5_"}})


class TestRevocation:
    # change-password revokes every older token, even ones issued <1s before; new token works
    def test_change_pw_revokes_fresh_tokens(self):
        e = "test_pw5_chg@example.com"
        uid = mk_user(e)
        t1 = login(e, PW).json()["token"]
        t2 = login(e, PW).json()["token"]
        assert jwt.decode(t1, JWT_SECRET, algorithms=["HS256"])["pwv"] == 0
        r = requests.post(f"{API}/me/password", json={"current_password": PW, "new_password": "NewPassw0rd!"},
                          headers={"Authorization": f"Bearer {t1}"})
        assert r.status_code == 200, r.text
        new = r.json()["token"]
        assert me(t1).status_code == 401
        assert me(t2).status_code == 401
        assert me(new).status_code == 200 and me(new).json()["email"] == e
        assert db.users.find_one({"email": e})["pw_version"] == 1
        # second change with the new token -> pwv 2, previous new token revoked
        r2 = requests.post(f"{API}/me/password", json={"current_password": "NewPassw0rd!", "new_password": "Third0ne!!"},
                           headers={"Authorization": f"Bearer {new}"})
        assert r2.status_code == 200
        assert me(new).status_code == 401
        assert me(r2.json()["token"]).status_code == 200
        assert login(e, "Third0ne!!").status_code == 200

    # reset-password revokes all tokens issued before it
    def test_reset_revokes_fresh_tokens(self):
        e = "test_pw5_rst@example.com"
        mk_user(e)
        t1 = login(e, PW).json()["token"]
        put_code(e)
        r = requests.post(f"{API}/auth/reset-password", json={"email": e, "code": "123456", "password": "ResetPassw0rd!"})
        assert r.status_code == 200, r.text
        assert me(t1).status_code == 401
        lr = login(e, "ResetPassw0rd!")
        assert lr.status_code == 200
        assert me(lr.json()["token"]).status_code == 200

    # legacy users without pw_version field still work with pwv=0 tokens
    def test_legacy_user_no_pw_version(self):
        e = "test_pw5_legacy@example.com"
        mk_user(e)
        assert "pw_version" not in db.users.find_one({"email": e})
        t = login(e, PW).json()["token"]
        assert me(t).status_code == 200


class TestUniformErrors:
    # same message for unknown email / no code / wrong code / expired
    def test_reset_errors_identical(self):
        e = "test_pw5_err@example.com"
        mk_user(e)
        body = lambda em: {"email": em, "code": "000000", "password": "Whatever123!"}
        unknown = requests.post(f"{API}/auth/reset-password", json=body("test_pw5_nobody@example.com"))
        nocode = requests.post(f"{API}/auth/reset-password", json=body(e))
        put_code(e, code="123456")
        wrong = requests.post(f"{API}/auth/reset-password", json=body(e))
        put_code(e, code="000000", minutes=-1)
        expired = requests.post(f"{API}/auth/reset-password", json=body(e))
        msgs = {(x.status_code, x.json().get("detail")) for x in (unknown, nocode, wrong, expired)}
        assert msgs == {(400, "Incorrect or expired code")}, msgs

    def test_verify_errors_identical(self):
        e = "test_pw5_verr@example.com"
        mk_user(e, verified=False)
        b = lambda em: {"email": em, "code": "000000"}
        unknown = requests.post(f"{API}/auth/verify-email", json=b("test_pw5_nobody2@example.com"))
        nocode = requests.post(f"{API}/auth/verify-email", json=b(e))
        put_code(e, kind="verify", code="123456")
        wrong = requests.post(f"{API}/auth/verify-email", json=b(e))
        msgs = {(x.status_code, x.json().get("detail")) for x in (unknown, nocode, wrong)}
        assert msgs == {(400, "Incorrect or expired code")}, msgs


class TestForgotTiming:
    # existing (real send in background) vs unknown email: same body and similar latency
    def test_forgot_same_body_and_timing(self):
        def t(email):
            s = time.perf_counter()
            r = requests.post(f"{API}/auth/forgot-password", json={"email": email})
            return r, time.perf_counter() - s
        r1, d1 = t("delivered@resend.dev")
        r2, d2 = t("test_pw5_ghost@example.com")
        assert r1.status_code == r2.status_code == 200
        assert r1.json() == r2.json()
        assert "dev_code" not in r1.json()
        print(f"existing={d1:.3f}s unknown={d2:.3f}s")
        assert abs(d1 - d2) < 0.6


class TestByteLimit:
    # >72 BYTES multi-byte passwords rejected with 400 (not 500)
    def test_register_multibyte(self):
        r = requests.post(f"{API}/auth/register", json={"email": "test_pw5_mb@example.com", "password": LONG_MB, "name": "TEST"})
        assert r.status_code == 400 and "72" in r.json()["detail"]
        assert db.users.find_one({"email": "test_pw5_mb@example.com"}) is None

    def test_reset_multibyte(self):
        e = "test_pw5_mbr@example.com"
        mk_user(e)
        put_code(e)
        r = requests.post(f"{API}/auth/reset-password", json={"email": e, "code": "123456", "password": LONG_MB})
        assert r.status_code == 400 and "72" in r.json()["detail"]
        # code not consumed by a rejected password
        assert db.auth_codes.find_one({"email": e, "kind": "reset"}) is not None

    def test_change_multibyte(self):
        e = "test_pw5_mbc@example.com"
        mk_user(e)
        tok = login(e, PW).json()["token"]
        r = requests.post(f"{API}/me/password", json={"current_password": PW, "new_password": LONG_MB},
                          headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 400 and "72" in r.json()["detail"]
        assert me(tok).status_code == 200  # not revoked

    def test_login_multibyte_no_500(self):
        r = login("test_pw5_mbc@example.com", LONG_MB)
        assert r.status_code == 401

    def test_exactly_72_bytes_ok(self):
        e = "test_pw5_72@example.com"
        mk_user(e)
        tok = login(e, PW).json()["token"]
        pw72 = "é" * 36  # 72 bytes
        r = requests.post(f"{API}/me/password", json={"current_password": PW, "new_password": pw72},
                          headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 200, r.text
        assert login(e, pw72).status_code == 200
