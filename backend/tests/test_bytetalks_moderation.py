# BYTE TALKS iteration 3: admin role, moderation (reports/appeals/audit), restricted-account gating, discover exclusion
import os, random
import pytest, requests
from pymongo import MongoClient
from dotenv import dotenv_values

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
PW = "ByteTalks123!"
_env = dotenv_values("/app/backend/.env")
DB = MongoClient(_env["MONGO_URL"])[_env["DB_NAME"]]
ADMIN_EMAIL = "admin@bytetalks.app"
ADMIN_PW = "D3WjHmkeB2WPkSgX8ZLLXf5"
TARGET = "omar@bytetalks.app"  # demo user to suspend/restore


def login(email, pw=PW):
    s = requests.Session()
    s.headers["X-Forwarded-For"] = f"10.{random.randint(1,250)}.{random.randint(1,250)}.{random.randint(1,250)}"
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    s.headers["Authorization"] = f"Bearer {r.json()['token']}"
    return s, r.json()["user"]


@pytest.fixture(scope="module")
def admin():
    return login(ADMIN_EMAIL, ADMIN_PW)


@pytest.fixture(scope="module")
def leo():
    return login("leo@bytetalks.app")


@pytest.fixture(scope="module")
def target():
    s, u = login(TARGET)
    yield s, u
    # cleanup: reinstate target + drop test appeals/reports
    DB.users.update_one({"email": TARGET}, {"$set": {"status": "active", "status_reason": "", "suspended_until": None}})
    DB.appeals.delete_many({"user_id": u["id"], "message": {"$regex": "^TEST_"}})
    DB.reports.delete_many({"reported_id": u["id"], "details": {"$regex": "^TEST_"}})


# ---- admin access control
class TestAdminAccess:
    def test_admin_login_role(self, admin):
        assert admin[1]["role"] == "admin"

    @pytest.mark.parametrize("path", ["/admin/stats", "/admin/reports", "/admin/appeals", "/admin/audit"])
    def test_non_admin_403(self, leo, path):
        r = leo[0].get(f"{API}{path}")
        assert r.status_code == 403 and r.json()["detail"] == "Admins only"

    def test_non_admin_resolve_403(self, leo):
        assert leo[0].post(f"{API}/admin/reports/000000000000000000000000/resolve", json={"action": "dismiss"}).status_code == 403

    def test_unauth_401(self):
        assert requests.get(f"{API}/admin/stats").status_code in (401, 403)

    def test_stats_shape(self, admin):
        d = admin[0].get(f"{API}/admin/stats").json()
        for k in ("users", "matches", "open_reports", "open_appeals", "suspended", "banned"):
            assert isinstance(d[k], int)

    def test_admin_not_in_discover(self, leo, admin):
        for mode in ("smart", "explore", "new"):
            ids = [p["id"] for p in leo[0].get(f"{API}/discover", params={"mode": mode}).json()]
            assert admin[1]["id"] not in ids

    def test_invalid_actions(self, admin):
        assert admin[0].post(f"{API}/admin/reports/000000000000000000000000/resolve", json={"action": "nuke"}).status_code == 400
        assert admin[0].post(f"{API}/admin/reports/000000000000000000000000/resolve", json={"action": "dismiss"}).status_code == 404
        assert admin[0].post(f"{API}/admin/appeals/000000000000000000000000/decide", json={"decision": "maybe"}).status_code == 400
        assert admin[0].post(f"{API}/admin/appeals/000000000000000000000000/decide", json={"decision": "approve"}).status_code == 404


# ---- full moderation flow: report -> suspend -> restricted -> appeal -> approve -> active
class TestModerationFlow:
    def test_flow(self, admin, leo, target):
        A, L, (T, tu) = admin[0], leo[0], target
        r = L.post(f"{API}/reports", json={"user_id": tu["id"], "reason": "spam", "details": "TEST_report"})
        assert r.status_code == 200, r.text
        reps = [x for x in A.get(f"{API}/admin/reports").json() if x["reported"]["id"] == tu["id"]]
        assert reps and reps[0]["reporter"]["id"] == leo[1]["id"] and reps[0]["prior_reports"] >= 1
        r = A.post(f"{API}/admin/reports/{reps[0]['id']}/resolve", json={"action": "suspend", "note": "TEST_spam behaviour", "days": 3})
        assert r.status_code == 200, r.text
        assert not [x for x in A.get(f"{API}/admin/reports").json() if x["reported"]["id"] == tu["id"]]
        # audit entry
        assert any(x["action"] == "report_suspend" and x["target_id"] == tu["id"] for x in A.get(f"{API}/admin/audit").json())
        # restricted gating (existing token)
        r = T.get(f"{API}/discover"); assert r.status_code == 403 and r.json()["detail"] == "ACCOUNT_RESTRICTED"
        assert T.get(f"{API}/matches").status_code == 403
        assert T.post(f"{API}/swipes", json={"user_id": leo[1]["id"], "action": "like"}).status_code == 403
        me = T.get(f"{API}/me"); assert me.status_code == 200
        assert me.json()["status"] == "suspended" and me.json()["status_reason"] == "TEST_spam behaviour"
        assert T.get(f"{API}/appeals").status_code == 200
        assert T.get(f"{API}/me/export").status_code == 200
        # still can log in fresh
        T2, u2 = login(TARGET); assert u2["status"] == "suspended"
        # excluded from discover for others
        for mode in ("smart", "explore", "new", "interests"):
            ids = [p["id"] for p in L.get(f"{API}/discover", params={"mode": mode}).json()]
            assert tu["id"] not in ids
        # appeal
        assert T.post(f"{API}/appeals", json={"message": "short"}).status_code == 422
        r = T.post(f"{API}/appeals", json={"message": "TEST_ this was a misunderstanding"}); assert r.status_code == 200, r.text
        assert T.post(f"{API}/appeals", json={"message": "TEST_ second appeal attempt"}).status_code == 400
        assert T.get(f"{API}/appeals").json()[0]["status"] == "open"
        aps = [x for x in A.get(f"{API}/admin/appeals").json() if x["user"]["id"] == tu["id"]]
        assert aps and aps[0]["restriction"] == "suspended"
        r = A.post(f"{API}/admin/appeals/{aps[0]['id']}/decide", json={"decision": "approve", "note": "TEST_ok"})
        assert r.status_code == 200
        assert T.get(f"{API}/me").json()["status"] == "active"
        assert T.get(f"{API}/discover").status_code == 200
        assert T.get(f"{API}/appeals").json()[0]["status"] == "approved"
        # non-restricted can't appeal
        assert T.post(f"{API}/appeals", json={"message": "TEST_ not restricted now"}).status_code == 400

    def test_ban_and_deny(self, admin, leo, target):
        A, L, (T, tu) = admin[0], leo[0], target
        L.post(f"{API}/reports", json={"user_id": tu["id"], "reason": "harassment", "details": "TEST_report2"})
        rid = [x for x in A.get(f"{API}/admin/reports").json() if x["reported"]["id"] == tu["id"]][0]["id"]
        assert A.post(f"{API}/admin/reports/{rid}/resolve", json={"action": "ban", "note": "TEST_ban"}).status_code == 200
        assert T.get(f"{API}/discover").json()["detail"] == "ACCOUNT_RESTRICTED"
        assert T.post(f"{API}/appeals", json={"message": "TEST_ please unban me"}).status_code == 200
        aid = [x for x in A.get(f"{API}/admin/appeals").json() if x["user"]["id"] == tu["id"]][0]["id"]
        assert A.post(f"{API}/admin/appeals/{aid}/decide", json={"decision": "deny", "note": "TEST_upheld"}).status_code == 200
        assert T.get(f"{API}/me").json()["status"] == "banned"
        # after denial: is another appeal allowed? (spec says 'one appeal')
        r = T.post(f"{API}/appeals", json={"message": "TEST_ appeal after deny"})
        print("APPEAL_AFTER_DENY", r.status_code)

    def test_admin_cannot_action_admin(self, admin, leo):
        A = admin[0]
        leo[0].post(f"{API}/reports", json={"user_id": admin[1]["id"], "reason": "spam", "details": "TEST_admin"})
        reps = [x for x in A.get(f"{API}/admin/reports").json() if x["reported"]["id"] == admin[1]["id"]]
        if reps:
            assert A.post(f"{API}/admin/reports/{reps[0]['id']}/resolve", json={"action": "ban"}).status_code == 400
            assert A.post(f"{API}/admin/reports/{reps[0]['id']}/resolve", json={"action": "dismiss"}).status_code == 200
        DB.reports.delete_many({"reported_id": admin[1]["id"], "details": "TEST_admin"})
