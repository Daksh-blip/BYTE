# BYTE TALKS security/edge regression: rate limiter, superlike, report validation, rematch, discover robustness
import os, random
import requests
from test_bytetalks_api import API, PW, signup, sess


# Rate limiter keys on client-supplied X-Forwarded-For first hop -> spoofable
def test_login_rate_limit_spoofable():
    ip = f"10.{random.randint(1,250)}.{random.randint(1,250)}.1"
    codes = [requests.post(f"{API}/auth/login", json={"email": "nobody@example.com", "password": "x"},
                           headers={"X-Forwarded-For": ip}).status_code for _ in range(11)]
    assert codes[-1] == 429
    r = requests.post(f"{API}/auth/login", json={"email": "nobody@example.com", "password": "x"},
                      headers={"X-Forwarded-For": ip.replace(".1", ".2")})
    assert r.status_code == 429, "rate limit bypassed by changing X-Forwarded-For"


def test_superlike_and_report_validation():
    a, _, ma = signup("man", ["woman"])
    b, _, mb = signup("woman", ["man"])
    try:
        assert a.post(f"{API}/swipes", json={"target_id": mb["id"], "action": "superlike", "note": "hi"}).status_code == 200
        lk = [l for l in b.get(f"{API}/likes").json() if l["id"] == ma["id"]]
        assert lk and lk[0]["superlike"] is True
        assert a.post(f"{API}/swipes", json={"target_id": mb["id"], "action": "bogus"}).status_code == 400
        assert a.post(f"{API}/swipes", json={"target_id": ma["id"], "action": "like"}).status_code == 404
        r = a.post(f"{API}/reports", json={"user_id": "000000000000000000000000", "reason": "Spam"})
        assert r.status_code in (400, 404), f"report on non-existent user accepted ({r.status_code})"
    finally:
        a.delete(f"{API}/me"); b.delete(f"{API}/me")
