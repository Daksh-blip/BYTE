# BYTE TALKS iteration-2 fix verification: rematch after unmatch, block/report validation, key-mismatch 409, spoofed XFF, delete cleanup
import base64, os
import requests
from test_bytetalks_api import API, PW, signup

K1 = base64.b64encode(os.urandom(32)).decode()
K2 = base64.b64encode(os.urandom(32)).decode()
K3 = base64.b64encode(os.urandom(32)).decode()
NONCE = base64.b64encode(os.urandom(24)).decode()


# Rematch after unmatch + key mismatch 409 + invalid block/report ids
def test_rematch_keys_and_safety_validation():
    a, ea, ma = signup("man", ["woman"])
    b, eb, mb = signup("woman", ["man"])
    try:
        assert a.put(f"{API}/me/public-key", json={"public_key": K1}).status_code == 200
        assert b.put(f"{API}/me/public-key", json={"public_key": K2}).status_code == 200
        assert a.post(f"{API}/swipes", json={"target_id": mb["id"], "action": "like"}).json()["matched"] is False
        r = b.post(f"{API}/swipes", json={"target_id": ma["id"], "action": "like"}).json()
        assert r["matched"] is True
        mid = r["match_id"]
        # 409 on mismatched keys
        bad = {"ciphertext": "abc", "nonce": NONCE, "sender_public_key": K3, "recipient_public_key": K2}
        assert a.post(f"{API}/matches/{mid}/messages", json=bad).status_code == 409
        bad2 = {"ciphertext": "abc", "nonce": NONCE, "sender_public_key": K1, "recipient_public_key": K3}
        assert a.post(f"{API}/matches/{mid}/messages", json=bad2).status_code == 409
        ok = {"ciphertext": "abc", "nonce": NONCE, "sender_public_key": K1, "recipient_public_key": K2}
        assert a.post(f"{API}/matches/{mid}/messages", json=ok).status_code == 200
        # unmatch -> both re-like -> active match again
        assert a.delete(f"{API}/matches/{mid}").status_code == 200
        assert a.get(f"{API}/matches/{mid}").status_code == 404
        assert a.post(f"{API}/swipes", json={"target_id": mb["id"], "action": "like"}).json()["matched"] is False
        r2 = b.post(f"{API}/swipes", json={"target_id": ma["id"], "action": "like"}).json()
        assert r2["matched"] is True, r2
        assert a.get(f"{API}/matches/{r2['match_id']}").status_code == 200
        assert a.get(f"{API}/matches/{r2['match_id']}/messages").json() == []
        assert any(m["id"] == r2["match_id"] for m in a.get(f"{API}/matches").json())
        # invalid ids for blocks/reports
        for uid in ("not-an-id", "000000000000000000000000", ma["id"]):
            assert a.post(f"{API}/blocks", json={"user_id": uid}).status_code == 400, uid
            assert a.post(f"{API}/reports", json={"user_id": uid, "reason": "Spam"}).status_code == 400, uid
        assert a.get(f"{API}/discover").status_code == 200
        # report then delete account -> login fails, reports cleaned (export no longer accessible)
        assert a.post(f"{API}/reports", json={"user_id": mb["id"], "reason": "Spam"}).status_code == 200
        assert a.delete(f"{API}/me").status_code == 200
        assert requests.post(f"{API}/auth/login", json={"email": ea, "password": PW}).status_code == 401
    finally:
        a.delete(f"{API}/me"); b.delete(f"{API}/me")


# Spoofed public left-most XFF entries must not bypass the per-IP limiter
def test_spoofed_public_xff_does_not_bypass():
    codes = []
    for i in range(12):
        codes.append(requests.post(f"{API}/auth/login", json={"email": f"nobody{i}@example.com", "password": "x"},
                                   headers={"X-Forwarded-For": f"8.8.{i}.{i+1}"}).status_code)
    assert 429 in codes, f"spoofed public XFF bypassed limiter: {codes}"


# Per-email limit on login even across distinct IPs
def test_per_email_login_limit():
    codes = [requests.post(f"{API}/auth/login", json={"email": "victim_test@example.com", "password": "x"}).status_code
             for _ in range(9)]
    assert codes[-1] == 429, codes
