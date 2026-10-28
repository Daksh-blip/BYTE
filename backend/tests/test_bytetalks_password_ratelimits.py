# Rate-limit tests for password endpoints. Each test restarts the backend to reset in-memory limits.
# Run separately: pytest tests/test_bytetalks_password_ratelimits.py -p no:xdist -n0
import subprocess
import time

import pytest
import requests

from test_bytetalks_passwords import API, mk_user, old_token, db, PW


def restart():
    subprocess.run(["sudo", "supervisorctl", "restart", "backend"], check=True, capture_output=True)
    for _ in range(30):
        try:
            if requests.post(f"{API}/auth/forgot-password", json={"email": "bad"}).status_code == 422:
                return
        except Exception:
            pass
        time.sleep(1)


def codes(fn, n):
    return [fn(i).status_code for i in range(n)]


@pytest.fixture(scope="module", autouse=True)
def cleanup():
    yield
    db.users.delete_many({"email": {"$regex": "^test_pw_"}})
    restart()


def test_login_per_email_8():
    restart()
    c = codes(lambda i: requests.post(f"{API}/auth/login", json={"email": "test_pw_rl@example.com", "password": "Wrong12345"}), 9)
    assert c[:8] == [401] * 8 and c[8] == 429, c


def test_login_per_ip_10_not_spoofable():
    restart()
    c = codes(lambda i: requests.post(f"{API}/auth/login", headers={"X-Forwarded-For": f"8.8.{i}.{i}"},
                                      json={"email": f"test_pw_rl{i}@example.com", "password": "Wrong12345"}), 11)
    assert c[:10] == [401] * 10 and c[10] == 429, c


def test_reset_per_ip_10_and_per_email_8():
    restart()
    c = codes(lambda i: requests.post(f"{API}/auth/reset-password", json={"email": "test_pw_rr@example.com", "code": "000000", "password": "NewPassw0rd!"}), 9)
    assert c[8] == 429 and 429 not in c[:8], c
    c2 = codes(lambda i: requests.post(f"{API}/auth/reset-password", json={"email": f"test_pw_rr{i}@example.com", "code": "000000", "password": "NewPassw0rd!"}), 2)
    assert c2 == [400, 429], c2  # 10th allowed, 11th blocked


def test_forgot_per_ip_5():
    restart()
    c = codes(lambda i: requests.post(f"{API}/auth/forgot-password", json={"email": f"test_pw_ghost{i}@example.com"}), 6)
    assert c == [200] * 5 + [429], c


def test_change_pw_10():
    restart()
    uid = mk_user("test_pw_rlc@example.com")
    h = {"Authorization": f"Bearer {old_token(uid)}"}
    c = codes(lambda i: requests.post(f"{API}/me/password", headers=h, json={"current_password": "nope", "new_password": "Brandnew123!"}), 11)
    assert c[:10] == [400] * 10 and c[10] == 429, c
