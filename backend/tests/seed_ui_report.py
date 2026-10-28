# helper (not a test): leo reports lena so the admin UI has an item to action
import requests, sys
U = open("/app/frontend/.env").read().split("EXPO_PUBLIC_BACKEND_URL=")[1].split()[0].strip('"') + "/api"


def lg(e, p="ByteTalks123!"):
    r = requests.post(U + "/auth/login", json={"email": e, "password": p}, timeout=20)
    r.raise_for_status()
    return {"Authorization": "Bearer " + r.json()["token"]}, r.json()["user"]


A, _ = lg("admin@bytetalks.app", __import__("dotenv").dotenv_values("/app/backend/.env").get("ADMIN_PASSWORD", ""))
L, _ = lg("leo@bytetalks.app")
N, lena = lg("lena@bytetalks.app")
print("lena", lena["id"], lena["status"])
print("open reports before", [(x["id"], x["reported"]["name"], x["reason"]) for x in requests.get(U + "/admin/reports", headers=A, timeout=20).json()])
print("open appeals", requests.get(U + "/admin/appeals", headers=A, timeout=20).json())
if "--report" in sys.argv:
    r = requests.post(U + "/reports", headers=L, json={"user_id": lena["id"], "reason": "fake_profile", "details": "TEST_ui report"}, timeout=20)
    print("report", r.status_code, r.text)
print("stats", requests.get(U + "/admin/stats", headers=A, timeout=20).json())
