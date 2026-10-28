import asyncio
import os
import re
import uuid
import random
import hashlib
import secrets
import logging
import ipaddress
import time
from collections import defaultdict, deque
from datetime import datetime, timezone, timedelta, date
from html import escape
from html.parser import HTMLParser
from pathlib import Path
from typing import Annotated, Literal, Optional, List
from urllib.parse import urlparse

import bcrypt
import httpx
import jwt
import requests
from bson import ObjectId
from dotenv import load_dotenv
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, UploadFile, File, Query
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ReturnDocument
from pydantic import BaseModel, Field, EmailStr, BeforeValidator, ConfigDict
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("bytetalks")

client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]

JWT_SECRET = os.environ["JWT_SECRET"]
JWT_DAYS = 30
APP_NAME = "byte-talks"

app = FastAPI()


@app.get("/health", include_in_schema=False)
@app.head("/health", include_in_schema=False)
async def health():
    return {"status": "ok"}


api = APIRouter(prefix="/api")
bearer = HTTPBearer(auto_error=False)


def now():
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------- Mongo models
PyObjectId = Annotated[str, BeforeValidator(lambda v: str(v) if isinstance(v, ObjectId) else v)]


class BaseDocument(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    id: Optional[PyObjectId] = Field(default=None, alias="_id")

    @classmethod
    def from_mongo(cls, doc):
        return cls.model_validate(doc) if doc else None

    def to_mongo(self):
        d = self.model_dump(by_alias=True, exclude={"id"})
        if self.id:
            d["_id"] = ObjectId(self.id)
        return d


class Photo(BaseModel):
    id: str
    path: Optional[str] = None
    url: Optional[str] = None


class User(BaseDocument):
    email: str
    password_hash: str
    verified: bool = False
    name: str = ""
    dob: Optional[str] = None
    gender: Optional[str] = None
    interested_in: List[str] = []
    bio: str = ""
    job: str = ""
    city: str = ""
    interests: List[str] = []
    photos: List[Photo] = []
    public_key: Optional[str] = None
    onboarded: bool = False
    paused: bool = False
    photo_verified: bool = False
    age_min: int = 18
    age_max: int = 60
    is_seed: bool = False
    intention: Optional[str] = None
    pronouns: str = ""
    languages: List[str] = []
    prompts: List[dict] = []
    role: str = "user"
    pw_version: int = 0
    status: str = "active"  # active | warned | suspended | banned
    status_reason: str = ""
    suspended_until: Optional[datetime] = None
    created_at: datetime = Field(default_factory=now)


class Match(BaseDocument):
    users: List[str]
    created_at: datetime = Field(default_factory=now)
    last_message_at: Optional[datetime] = None
    last_sender_id: Optional[str] = None
    unread: dict = {}
    active: bool = True
    # Records without this field predate the Signal upgrade and are legacy NaCl-box chats.
    protocol: str = "nacl-box-v1"


LEGACY_PROTOCOL = "nacl-box-v1"
SIGNAL_PROTOCOL = "signal-v1"  # @open-e2ee/signal-protocol-sdk 13.3 (PQXDH + Double Ratchet + SPQR)


class Message(BaseDocument):
    match_id: str
    sender_id: str
    # Legacy records have no `protocol` field and are always read as nacl-box-v1; they are never rewritten.
    protocol: str = LEGACY_PROTOCOL
    ciphertext: str = ""
    nonce: Optional[str] = None
    sender_public_key: Optional[str] = None
    recipient_public_key: Optional[str] = None
    sender_device: Optional[str] = None
    recipient_device: Optional[str] = None
    kind: Optional[str] = None  # system events, e.g. "upgraded"
    created_at: datetime = Field(default_factory=now)


def age_of(dob: Optional[str]) -> Optional[int]:
    if not dob:
        return None
    try:
        d = date.fromisoformat(dob)
    except ValueError:
        return None
    t = date.today()
    return t.year - d.year - ((t.month, t.day) < (d.month, d.day))


def photo_url(p: Photo) -> str:
    return p.url if p.url else f"/api/files/{p.path}"


def public_profile(u: User) -> dict:
    return {
        "id": u.id, "name": u.name, "age": age_of(u.dob), "gender": u.gender, "bio": u.bio,
        "job": u.job, "city": u.city, "interests": u.interests,
        "photos": [{"id": p.id, "url": photo_url(p)} for p in u.photos],
        "photo_verified": u.photo_verified, "public_key": u.public_key,
        "intention": u.intention, "pronouns": u.pronouns, "languages": u.languages, "prompts": u.prompts,
        "is_demo": u.is_seed,
    }


INTENTION_GROUPS = {"long_term": "serious", "long_term_open": "serious", "short_term_open": "casual",
                    "new_friends": "friends", "figuring_out": "open"}


def compatibility(me: User, other: User) -> dict:
    """Transparent, rule-based estimate from info both people chose to share. Not a prediction."""
    reasons, score = [], 40
    shared = [i for i in other.interests if i in set(me.interests)]
    if shared:
        score += min(30, 10 * len(shared))
        reasons.append(f"You both like {', '.join(shared[:3])}")
    if me.intention and other.intention:
        if me.intention == other.intention:
            score += 20
            reasons.append("Looking for the same kind of relationship")
        elif INTENTION_GROUPS.get(me.intention) == INTENTION_GROUPS.get(other.intention) or "open" in (
                INTENTION_GROUPS.get(me.intention), INTENTION_GROUPS.get(other.intention)):
            score += 10
            reasons.append("Compatible relationship goals")
    langs = [l for l in other.languages if l in set(me.languages)]
    if langs:
        score += 5
        reasons.append(f"You both speak {', '.join(langs[:2])}")
    if me.city and other.city and me.city.strip().lower() == other.city.strip().lower():
        score += 5
        reasons.append(f"Both in {other.city}")
    return {"score": min(score, 99), "reasons": reasons, "shared_interests": shared}


def private_profile(u: User) -> dict:
    d = public_profile(u)
    d.update({"email": u.email, "dob": u.dob, "interested_in": u.interested_in, "onboarded": u.onboarded,
              "paused": u.paused, "age_min": u.age_min, "age_max": u.age_max, "verified": u.verified,
              "role": u.role, "status": u.status, "status_reason": u.status_reason,
              "suspended_until": u.suspended_until.isoformat() if u.suspended_until else None})
    return d


# ---------------------------------------------------------------- rate limiting
_hits: dict = defaultdict(deque)


def rate_limit(request: Request, name: str, limit: int, window: int):
    # Use the right-most X-Forwarded-For entry: it's appended by our ingress and can't be spoofed by the client.
    # Walk X-Forwarded-For from the right and take the first public IP: entries to its left are client-controlled.
    ip = request.client.host if request.client else "x"
    for part in reversed((request.headers.get("x-forwarded-for") or "").split(",")):
        try:
            addr = ipaddress.ip_address(part.strip())
        except ValueError:
            continue
        if addr.is_global:
            ip = str(addr)
            break
    _check(("ip", name, ip), limit, window)


def rate_limit_key(name: str, key: str, limit: int, window: int):
    _check(("key", name, key), limit, window)


def _check(key, limit: int, window: int):
    q = _hits[key]
    t = time.time()
    while q and q[0] < t - window:
        q.popleft()
    if len(q) >= limit:
        raise HTTPException(429, "Too many attempts. Please wait a bit and try again.")
    q.append(t)


# ---------------------------------------------------------------- auth helpers
def hash_pw(p: str) -> str:
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt(rounds=12)).decode()


def check_pw(p: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(p.encode(), h.encode())
    except ValueError:
        return False


def make_token(uid: str, pwv: int = 0, typ: str = "access") -> str:
    """Access tokens last JWT_DAYS. Media tokens are read-only for photo files, short-lived, and safe to put in image URLs."""
    t = now()
    ttl = timedelta(days=JWT_DAYS) if typ == "access" else timedelta(hours=6)
    return jwt.encode({"sub": uid, "typ": typ, "pwv": pwv, "iat": t, "exp": t + ttl, "jti": secrets.token_hex(8)},
                      JWT_SECRET, algorithm="HS256")


def check_pw_bytes(pw: str):
    if len(pw.encode()) > 72:
        raise HTTPException(400, "Password is too long (max 72 bytes)")


def digest(v: str) -> str:
    return hashlib.sha256(v.encode()).hexdigest()


async def user_from_token(token: Optional[str], typ: str = "access") -> User:
    """Validates the token AND its password version against the DB on every request, so a password
    change or reset revokes every older session immediately (there are no refresh tokens)."""
    if not token:
        raise HTTPException(401, "Not authenticated")
    try:
        p = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        if p.get("typ") != typ:
            raise ValueError()
        doc = await db.users.find_one({"_id": ObjectId(p["sub"])})
    except Exception:
        raise HTTPException(401, "Invalid or expired session")
    if not doc:
        raise HTTPException(401, "User not found")
    if int(p.get("pwv", 0)) != int(doc.get("pw_version", 0)):
        raise HTTPException(401, "Your password was changed. Please sign in again.")
    if p.get("jti") and await db.revoked_sessions.find_one({"jti": p["jti"]}, {"_id": 1}):
        raise HTTPException(401, "This device was signed out. Please sign in again.")
    return User.from_mongo(doc)


def token_jti(request: Request) -> Optional[str]:
    auth = request.headers.get("authorization", "")
    try:
        return jwt.decode(auth.split(" ", 1)[1], JWT_SECRET, algorithms=["HS256"]).get("jti")
    except Exception:
        return None


def is_restricted(u: User) -> bool:
    if u.status == "banned":
        return True
    return u.status == "suspended" and bool(u.suspended_until) and u.suspended_until.replace(tzinfo=timezone.utc) > now()


RESTRICTED_OK = {("GET", "/api/me"), ("DELETE", "/api/me"), ("GET", "/api/me/export"), ("POST", "/api/appeals"), ("GET", "/api/appeals")}


async def current_user(request: Request, creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer)) -> User:
    u = await user_from_token(creds.credentials if creds else None)
    if u.status == "suspended" and not is_restricted(u):
        await db.users.update_one({"_id": ObjectId(u.id)}, {"$set": {"status": "active", "suspended_until": None}})
        u.status, u.suspended_until = "active", None
    if is_restricted(u) and (request.method, request.url.path) not in RESTRICTED_OK:
        raise HTTPException(403, "ACCOUNT_RESTRICTED")
    return u


async def require_admin(me: User = Depends(current_user)) -> User:
    if me.role != "admin":
        raise HTTPException(403, "Admins only")
    return me


async def audit(admin: User, action: str, target_id: str, detail: str = ""):
    await db.audit_log.insert_one({"admin_id": admin.id, "action": action, "target_id": target_id,
                                   "detail": detail[:500], "created_at": now()})


# ---------------------------------------------------------------- email (Emergent managed)
EMAIL_BASE_URL = "https://integrations.emergentagent.com"
EMAIL_KEY = os.environ.get("EMERGENT_EMAIL_KEY")
EMAIL_FROM_NAME = os.environ["EMAIL_FROM_NAME"]

_SHORTENERS = ("bit.ly", "tinyurl.com", "t.co", "is.gd", "cutt.ly", "goo.gl", "rebrand.ly")
_CRED_ASK = ("reply with your password", "reply with the code", "send your password", "cvv",
             "send us your password", "enter your password below", "confirm your card number",
             "your full card number", "seed phrase", "recovery phrase", "verify your card",
             "social security number", "confirm your bank details")
_HOSTISH = re.compile(r"\b(?:https?://)?((?:[a-z0-9-]+\.)+[a-z]{2,})", re.I)


def _host_ok(host: str) -> bool:
    if not host or "xn--" in host:
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    return not any(host == s or host.endswith("." + s) for s in _SHORTENERS)


def _same_site(shown: str, real: str) -> bool:
    return shown == real or real.endswith("." + shown) or shown.endswith("." + real)


class _EmailScan(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags, self.urls, self.anchors = set(), [], []
        self._href, self._text = None, []

    def handle_starttag(self, tag, attrs):
        self.tags.add(tag.lower())
        self.urls += [v for k, v in attrs if k.lower() in ("href", "src") and v]
        if tag.lower() == "a":
            self._href = dict((k.lower(), v) for k, v in attrs).get("href")
            self._text = []

    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "a" and self._href is not None:
            self.anchors.append((self._href, "".join(self._text)))
            self._href, self._text = None, []


def _assert_safe_email(subject: str, html: str) -> None:
    scan = _EmailScan()
    scan.feed(html)
    if scan.tags & {"form", "input", "textarea", "select"}:
        raise ValueError("No forms or input fields in email (G2)")
    body = f"{subject}\n{html}".lower()
    for p in _CRED_ASK:
        if p in body:
            raise ValueError(f"Email asks the recipient for credentials: {p!r} (G2)")
    for url in scan.urls:
        low = url.strip().lower()
        if low.startswith(("mailto:", "tel:", "cid:", "#")):
            continue
        if not low.startswith("https://"):
            raise ValueError(f"Email links/assets must be absolute https: {url!r} (G3)")
        host = urlparse(low).hostname or ""
        if not _host_ok(host) or urlparse(low).username is not None:
            raise ValueError(f"Shortened, numeric-host or credential-bearing URL: {url!r} (G3)")
    for href, text in scan.anchors:
        real = urlparse(href.strip().lower()).hostname or ""
        if not real:
            continue
        for m in _HOSTISH.finditer(text):
            if not _same_site(m.group(1).lower(), real):
                raise ValueError(f"Anchor text {m.group(1)!r} != real link host {real!r} (G3)")


async def send_email(*, to: str, subject: str, html: str) -> bool:
    """Returns True when sent. False when the email key is not provisioned (dev mode)."""
    _assert_safe_email(subject, html)
    if not EMAIL_KEY:
        logger.warning("EMERGENT_EMAIL_KEY not set; email to %s not sent (dev mode)", to)
        return False
    payload = {"to": [to], "subject": subject, "html": html, "from_name": EMAIL_FROM_NAME}
    try:
        async with httpx.AsyncClient(timeout=30) as c:
            resp = await c.post(f"{EMAIL_BASE_URL}/api/v1/email/send", headers={"X-Email-Key": EMAIL_KEY}, json=payload)
        resp.raise_for_status()
        return True
    except httpx.HTTPStatusError as e:
        try:
            code = e.response.json().get("code", "")
        except ValueError:
            code = ""
        if code in ("insufficient_credits", "integration_disabled", "daily_limit_reached"):
            logger.warning("Email paused: %s", code)
            raise HTTPException(503, "Email is temporarily unavailable")
        if e.response.status_code == 429:
            raise HTTPException(429, "Too many emails sent. Please wait a minute and try again.")
        if e.response.status_code in (400, 422):
            raise HTTPException(400, "We couldn't send an email to that address. Check it and try again.")
        logger.error("Email send failed: %s %s", e.response.status_code, e.response.text)
        raise HTTPException(503, "Email is temporarily unavailable. Please try again shortly.")


def code_email(name: str, code: str, purpose: str) -> tuple[str, str]:
    title = "Verify your email" if purpose == "verify" else "Reset your password"
    line = ("Use this code to verify your email and finish creating your account."
            if purpose == "verify" else "Use this code in the app to set a new password.")
    html = (
        '<table role="presentation" width="100%" style="background:#0A0607"><tr><td style="padding:32px;'
        'font-family:Arial,sans-serif;color:#F2F2F4">'
        f'<h2 style="color:#FF2D46;margin:0 0 16px">{escape(EMAIL_FROM_NAME)}</h2>'
        f'<p>Hi {escape(name or "there")},</p><p>{line}</p>'
        f'<p style="font-size:32px;letter-spacing:8px;font-weight:bold;color:#FFFFFF">{escape(code)}</p>'
        '<p>This code expires in 15 minutes. If you did not request it, you can ignore this email.</p>'
        f'<p style="font-size:12px;color:#8B8D99">Sent by {escape(EMAIL_FROM_NAME)}. We never ask for your '
        'password by email.</p></td></tr></table>'
    )
    return f"{EMAIL_FROM_NAME}: {title}", html


async def issue_code(email: str, name: str, kind: str) -> dict:
    code = f"{secrets.randbelow(1_000_000):06d}"
    await db.auth_codes.delete_many({"email": email, "kind": kind})
    await db.auth_codes.insert_one({"email": email, "kind": kind, "code_hash": digest(code), "attempts": 0,
                                    "expires_at": now() + timedelta(minutes=15)})
    subject, html = code_email(name, code, kind)
    sent = await send_email(to=email, subject=subject, html=html)
    return {"email_sent": sent} if sent else {"email_sent": False, "dev_code": code}


async def consume_code(email: str, kind: str, code: str):
    row = await db.auth_codes.find_one({"email": email, "kind": kind})
    if not row or row["expires_at"].replace(tzinfo=timezone.utc) < now():
        raise HTTPException(400, "Incorrect or expired code")
    if row["attempts"] >= 5:
        raise HTTPException(400, "Too many wrong attempts. Request a new code.")
    if not secrets.compare_digest(row["code_hash"], digest(code.strip())):
        await db.auth_codes.update_one({"_id": row["_id"]}, {"$inc": {"attempts": 1}})
        raise HTTPException(400, "Incorrect or expired code")
    await db.auth_codes.delete_one({"_id": row["_id"]})


# ---------------------------------------------------------------- object storage
STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")
storage_key = None


def init_storage():
    global storage_key
    if storage_key:
        return storage_key
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
    resp.raise_for_status()
    storage_key = resp.json()["storage_key"]
    return storage_key


def put_object(path: str, data: bytes, content_type: str) -> dict:
    global storage_key
    key = init_storage()
    resp = requests.put(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key, "Content-Type": content_type},
                        data=data, timeout=120)
    if resp.status_code == 503:
        storage_key = None
        key = init_storage()
        resp = requests.put(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key, "Content-Type": content_type},
                            data=data, timeout=120)
    if resp.status_code == 402:
        raise HTTPException(402, "Photo storage is out of credits right now")
    resp.raise_for_status()
    return resp.json()


def get_object(path: str):
    key = init_storage()
    resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


# ---------------------------------------------------------------- request bodies
class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)
    name: str = Field(min_length=1, max_length=40)


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(max_length=72)


class EmailIn(BaseModel):
    email: EmailStr


class VerifyIn(BaseModel):
    email: EmailStr
    code: str = Field(min_length=6, max_length=6)


class ResetIn(BaseModel):
    email: EmailStr
    code: str = Field(min_length=6, max_length=6)
    password: str = Field(min_length=8, max_length=72)


class ProfileIn(BaseModel):
    name: Optional[str] = Field(default=None, max_length=40)
    dob: Optional[str] = None
    gender: Optional[str] = None
    interested_in: Optional[List[str]] = None
    bio: Optional[str] = Field(default=None, max_length=500)
    job: Optional[str] = Field(default=None, max_length=60)
    city: Optional[str] = Field(default=None, max_length=60)
    interests: Optional[List[str]] = None
    onboarded: Optional[bool] = None
    paused: Optional[bool] = None
    age_min: Optional[int] = Field(default=None, ge=18, le=99)
    age_max: Optional[int] = Field(default=None, ge=18, le=99)
    intention: Optional[str] = None
    pronouns: Optional[str] = Field(default=None, max_length=20)
    languages: Optional[List[str]] = None
    prompts: Optional[List[dict]] = None


class SwipeIn(BaseModel):
    target_id: str
    action: str
    note: str = Field(default="", max_length=140)


class MessageIn(BaseModel):
    # Only Signal messages can be sent. Legacy NaCl sends were retired, so nothing can downgrade.
    protocol: Literal["signal-v1"]
    ciphertext: str = Field(min_length=1, max_length=20000)
    recipient_device: str = Field(min_length=1, max_length=40)


class BlockIn(BaseModel):
    user_id: str


class ReportIn(BaseModel):
    user_id: str
    reason: str = Field(min_length=1, max_length=60)
    details: str = Field(default="", max_length=1000)


GENDERS = {"woman", "man", "nonbinary"}
INTENTIONS = set(INTENTION_GROUPS)


def oid(v: str) -> ObjectId:
    try:
        return ObjectId(v)
    except Exception:
        raise HTTPException(404, "Not found")


# ---------------------------------------------------------------- auth routes
@api.post("/auth/register")
async def register(body: RegisterIn, request: Request):
    rate_limit(request, "register", 30, 3600)
    check_pw_bytes(body.password)
    email = str(body.email).lower()
    existing = User.from_mongo(await db.users.find_one({"email": email}))
    if existing and existing.verified:
        raise HTTPException(400, "An account with this email already exists. Try signing in.")
    if existing:
        await db.users.update_one({"_id": ObjectId(existing.id)},
                                  {"$set": {"password_hash": hash_pw(body.password), "name": body.name.strip()}})
    else:
        await db.users.insert_one(User(email=email, password_hash=hash_pw(body.password), name=body.name.strip()).to_mongo())
    res = await issue_code(email, body.name, "verify")
    return {"message": "Verification code sent", "email": email, **res}


@api.post("/auth/resend-code")
async def resend_code(body: EmailIn, request: Request):
    rate_limit(request, "resend", 5, 900)
    email = str(body.email).lower()
    u = User.from_mongo(await db.users.find_one({"email": email}))
    if not u or u.verified:
        return {"message": "If the account needs verification, a code was sent", "email_sent": True}
    res = await issue_code(email, u.name, "verify")
    return {"message": "Verification code sent", **res}


@api.post("/auth/verify-email")
async def verify_email(body: VerifyIn, request: Request):
    rate_limit(request, "verify", 20, 900)
    email = str(body.email).lower()
    rate_limit_key("verify", email, 10, 900)
    u = User.from_mongo(await db.users.find_one({"email": email}))
    if not u:
        raise HTTPException(400, "Incorrect or expired code")
    await consume_code(email, "verify", body.code)
    await db.users.update_one({"_id": ObjectId(u.id)}, {"$set": {"verified": True}})
    u.verified = True
    return {"token": make_token(u.id, u.pw_version), "user": private_profile(u)}


@api.post("/auth/login")
async def login(body: LoginIn, request: Request):
    rate_limit(request, "login", 10, 300)
    rate_limit_key("login", str(body.email).lower(), 8, 300)
    u = User.from_mongo(await db.users.find_one({"email": str(body.email).lower()}))
    if not u or not check_pw(body.password, u.password_hash):
        raise HTTPException(401, "Invalid email or password")
    if not u.verified:
        raise HTTPException(403, "EMAIL_NOT_VERIFIED")
    return {"token": make_token(u.id, u.pw_version), "user": private_profile(u)}


@api.post("/auth/forgot-password")
async def forgot_password(body: EmailIn, request: Request):
    rate_limit(request, "forgot", 5, 3600)
    email = str(body.email).lower()
    u = User.from_mongo(await db.users.find_one({"email": email}))
    if u:
        # Send in the background so response time doesn't reveal whether the account exists.
        async def _send():
            try:
                await issue_code(email, u.name, "reset")
            except Exception as e:  # noqa: BLE001
                logger.warning("Reset email failed: %s", getattr(e, "detail", e))
        asyncio.create_task(_send())
    return {"message": "If that email has an account, a reset code was sent", "email_sent": True}


@api.post("/auth/reset-password")
async def reset_password(body: ResetIn, request: Request):
    rate_limit(request, "reset", 10, 3600)
    email = str(body.email).lower()
    rate_limit_key("reset", email, 8, 3600)
    u = User.from_mongo(await db.users.find_one({"email": email}))
    check_pw_bytes(body.password)
    if not u:
        raise HTTPException(400, "Incorrect or expired code")
    await consume_code(email, "reset", body.code)
    await db.users.update_one({"_id": ObjectId(u.id)}, {"$set": {"password_hash": hash_pw(body.password), "verified": True},
                                                       "$inc": {"pw_version": 1}})
    notify_password_changed(u)
    # The email is returned only after the code proved ownership, so the app can pre-fill the login form.
    return {"message": "Password updated. You can sign in now.", "email": email}


class ChangePasswordIn(BaseModel):
    current_password: str = Field(max_length=72)
    new_password: str = Field(min_length=8, max_length=72)


@api.post("/me/password")
async def change_password(body: ChangePasswordIn, request: Request, me: User = Depends(current_user)):
    rate_limit(request, "change_pw", 10, 900)
    if not check_pw(body.current_password, me.password_hash):
        raise HTTPException(400, "Current password is incorrect")
    if body.current_password == body.new_password:
        raise HTTPException(400, "Choose a password different from your current one")
    check_pw_bytes(body.new_password)
    # Compare-and-swap on pw_version: if another change landed first, this one fails instead of racing.
    doc = await db.users.find_one_and_update(
        {"_id": ObjectId(me.id), "pw_version": me.pw_version} if me.pw_version else
        {"_id": ObjectId(me.id), "pw_version": {"$in": [0, None]}},
        {"$set": {"password_hash": hash_pw(body.new_password)}, "$inc": {"pw_version": 1}},
        return_document=ReturnDocument.AFTER)
    if not doc:
        raise HTTPException(401, "Your password was changed. Please sign in again.")
    notify_password_changed(me)
    # Other sessions are signed out; this device gets a fresh token, so its Signal device follows the new session.
    jti = token_jti(request)
    new_token = make_token(me.id, int(doc["pw_version"]))
    if jti:
        new_jti = jwt.decode(new_token, JWT_SECRET, algorithms=["HS256"])["jti"]
        await db.signal_devices.update_many({"user_id": me.id, "session_jti": jti}, {"$set": {"session_jti": new_jti}})
    return {"message": "Password changed", "token": new_token}


@api.get("/me/media-token")
async def media_token(me: User = Depends(current_user)):
    """Short-lived, photo-only token for image URLs, so the real session token never appears in URLs or access logs."""
    return {"token": make_token(me.id, me.pw_version, "media")}


_bg_tasks: set = set()


def notify_password_changed(u: User):
    security_notice(u, "Your password was changed",
                    "The password for your account was just changed, and every other device was signed out. "
                    "If this was not you, reset your password from the app straight away.")


def security_notice(u: User, subject: str, line: str):
    """Generic account-security email, sent in the background. Contains no tokens, codes or device details."""
    html = (
        '<table role="presentation" width="100%" style="background:#0A0607"><tr><td style="padding:32px;'
        'font-family:Arial,sans-serif;color:#F2F2F4">'
        f'<h2 style="color:#FF2D46;margin:0 0 16px">{escape(EMAIL_FROM_NAME)}</h2>'
        f'<p>Hi {escape(u.name or "there")},</p><p>{escape(line)}</p>'
        f'<p style="font-size:12px;color:#8B8D99">Sent by {escape(EMAIL_FROM_NAME)}. We never ask for your '
        'password by email.</p></td></tr></table>'
    )

    async def _send():
        try:
            await send_email(to=u.email, subject=f"{EMAIL_FROM_NAME}: {subject}", html=html)
        except Exception as e:  # noqa: BLE001
            logger.warning("Security notice failed: %s", getattr(e, "detail", type(e).__name__))
    t = asyncio.create_task(_send())
    _bg_tasks.add(t)
    t.add_done_callback(_bg_tasks.discard)


# ---------------------------------------------------------------- me / profile
@api.get("/me")
async def get_me(me: User = Depends(current_user)):
    return private_profile(me)


@api.put("/me")
async def update_me(body: ProfileIn, me: User = Depends(current_user)):
    upd = body.model_dump(exclude_none=True)
    if "dob" in upd:
        a = age_of(upd["dob"])
        if a is None:
            raise HTTPException(400, "Enter a valid date of birth")
        if a < 18:
            raise HTTPException(400, "You must be 18 or older to use BYTE TALKS")
        if a > 100:
            raise HTTPException(400, "Enter a valid date of birth")
    if "gender" in upd and upd["gender"] not in GENDERS:
        raise HTTPException(400, "Invalid gender")
    if "interested_in" in upd:
        upd["interested_in"] = [g for g in upd["interested_in"] if g in GENDERS]
    if "interests" in upd:
        upd["interests"] = [i.strip()[:30] for i in upd["interests"] if i.strip()][:10]
    if "intention" in upd and upd["intention"] not in INTENTIONS:
        raise HTTPException(400, "Invalid relationship intention")
    if "languages" in upd:
        upd["languages"] = [l.strip()[:20] for l in upd["languages"] if l.strip()][:5]
    if "prompts" in upd:
        clean = []
        for pr in upd["prompts"][:3]:
            q, a = str(pr.get("question", ""))[:80].strip(), str(pr.get("answer", ""))[:200].strip()
            if q and a:
                clean.append({"question": q, "answer": a})
        upd["prompts"] = clean
    if "name" in upd:
        upd["name"] = upd["name"].strip()
        if not upd["name"]:
            raise HTTPException(400, "Name is required")
    merged = me.model_copy(update=upd)
    if merged.age_min > merged.age_max:
        raise HTTPException(400, "Minimum age must be below maximum age")
    if upd.get("onboarded"):
        if not (merged.name and merged.dob and merged.gender and merged.interested_in and merged.photos):
            raise HTTPException(400, "Complete your name, birthday, gender, preferences and add a photo first")
    await db.users.update_one({"_id": ObjectId(me.id)}, {"$set": upd})
    if upd.get("onboarded") and not me.onboarded:
        await seed_likes_for(merged)
    return private_profile(merged)


@api.post("/me/photos")
async def upload_photo(file: UploadFile = File(...), me: User = Depends(current_user)):
    if len(me.photos) >= 6:
        raise HTTPException(400, "You can add up to 6 photos")
    ctype = file.content_type or "image/jpeg"
    if not ctype.startswith("image/"):
        raise HTTPException(400, "Only images are allowed")
    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(400, "Photo must be under 10 MB")
    ext = (file.filename or "photo.jpg").rsplit(".", 1)[-1].lower()
    if ext not in ("jpg", "jpeg", "png", "webp", "heic", "heif"):
        ext = "jpg"
    path = f"{APP_NAME}/uploads/{me.id}/{uuid.uuid4()}.{ext}"
    result = await run_in_threadpool(put_object, path, data, ctype)
    photo = Photo(id=str(uuid.uuid4()), path=result["path"])
    await db.users.update_one({"_id": ObjectId(me.id)}, {"$push": {"photos": photo.model_dump()}})
    me.photos.append(photo)
    return private_profile(me)


@api.delete("/me/photos/{photo_id}")
async def delete_photo(photo_id: str, me: User = Depends(current_user)):
    await db.users.update_one({"_id": ObjectId(me.id)}, {"$pull": {"photos": {"id": photo_id}}})
    me.photos = [p for p in me.photos if p.id != photo_id]
    if not me.photos and me.onboarded:
        pass
    return private_profile(me)


@api.put("/me/photos/{photo_id}/primary")
async def make_primary(photo_id: str, me: User = Depends(current_user)):
    ph = [p for p in me.photos if p.id == photo_id]
    if not ph:
        raise HTTPException(404, "Photo not found")
    me.photos = ph + [p for p in me.photos if p.id != photo_id]
    await db.users.update_one({"_id": ObjectId(me.id)}, {"$set": {"photos": [p.model_dump() for p in me.photos]}})
    return private_profile(me)


@api.get("/files/{path:path}")
async def get_file(path: str, token: Optional[str] = Query(default=None),
                   creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer)):
    if creds:
        await user_from_token(creds.credentials)
    else:
        await user_from_token(token, "media")
    if not await db.users.find_one({"photos.path": path}, {"_id": 1}):
        raise HTTPException(404, "File not found")
    content, ctype = await run_in_threadpool(get_object, path)
    return Response(content=content, media_type=ctype, headers={"Cache-Control": "private, max-age=86400"})


@api.get("/me/export")
async def export_data(me: User = Depends(current_user)):
    """Everything we store about you. Messages are included only as ciphertext: we cannot read them."""
    uid = me.id
    swipes = [{"to_id": x["to_id"], "action": x["action"], "note": x.get("note", ""), "at": x["created_at"].isoformat()}
              async for x in db.swipes.find({"from_id": uid})]
    matches = [{"id": str(m["_id"]), "with": next(u for u in m["users"] if u != uid), "created_at": m["created_at"].isoformat(),
                "active": m.get("active", True)} async for m in db.matches.find({"users": uid})]
    msgs = [{"match_id": m["match_id"], "sent_by_me": m["sender_id"] == uid, "protocol": m.get("protocol", LEGACY_PROTOCOL),
             "ciphertext": m.get("ciphertext", ""),
             "at": m["created_at"].isoformat()} async for m in db.messages.find({"match_id": {"$in": [x["id"] for x in matches]}})]
    blocks = [b["blocked_id"] async for b in db.blocks.find({"blocker_id": uid})]
    reports = [{"reported_id": r["reported_id"], "reason": r["reason"], "at": r["created_at"].isoformat()}
               async for r in db.reports.find({"reporter_id": uid})]
    return {"exported_at": now().isoformat(), "profile": private_profile(me), "swipes": swipes, "matches": matches,
            "encrypted_messages": msgs, "blocked_user_ids": blocks, "reports_filed": reports}


@api.delete("/me")
async def delete_account(me: User = Depends(current_user)):
    uid = me.id
    match_ids = [str(m["_id"]) async for m in db.matches.find({"users": uid}, {"_id": 1})]
    await db.messages.delete_many({"match_id": {"$in": match_ids}})
    await db.matches.delete_many({"users": uid})
    await db.swipes.delete_many({"$or": [{"from_id": uid}, {"to_id": uid}]})
    await db.blocks.delete_many({"$or": [{"blocker_id": uid}, {"blocked_id": uid}]})
    await db.reports.delete_many({"reporter_id": uid})
    await db.auth_codes.delete_many({"email": me.email})
    await db.signal_devices.delete_many({"user_id": uid})
    # Photo files become unreachable (the file route requires a DB record); storage has no delete API.
    await db.users.delete_one({"_id": ObjectId(uid)})
    return {"ok": True}


# ---------------------------------------------------------------- discovery
async def blocked_ids(uid: str) -> set:
    ids = set()
    async for b in db.blocks.find({"$or": [{"blocker_id": uid}, {"blocked_id": uid}]}):
        ids.add(b["blocked_id"] if b["blocker_id"] == uid else b["blocker_id"])
    return ids


@api.get("/discover")
async def discover(mode: str = Query(default="smart"), me: User = Depends(current_user)):
    swiped = {s["to_id"] async for s in db.swipes.find({"from_id": me.id}, {"to_id": 1})}
    exclude = swiped | await blocked_ids(me.id) | {me.id}
    q = {"onboarded": True, "paused": False, "status": {"$nin": ["banned", "suspended"]}, "role": {"$ne": "admin"}, "_id": {"$nin": [ObjectId(x) for x in exclude if ObjectId.is_valid(x)]}}
    if me.interested_in:
        q["gender"] = {"$in": me.interested_in}
    if mode == "new":
        q["created_at"] = {"$gte": now() - timedelta(days=14)}
    out = []
    async for doc in db.users.find(q).limit(300):
        u = User.from_mongo(doc)
        a = age_of(u.dob)
        if a is None or a < me.age_min or a > me.age_max or a < 18:
            continue
        if me.gender and u.interested_in and me.gender not in u.interested_in:
            continue
        p = public_profile(u)
        p["compatibility"] = compatibility(me, u)
        p["_created"] = u.created_at
        out.append(p)
    if mode == "interests":
        out = [p for p in out if p["compatibility"]["shared_interests"]]
        out.sort(key=lambda p: len(p["compatibility"]["shared_interests"]), reverse=True)
    elif mode == "new":
        out.sort(key=lambda p: p["_created"], reverse=True)
    elif mode == "explore":
        random.shuffle(out)
    else:
        # Smart Picks: fewer, more relevant. Small random jitter avoids always showing the same order.
        out.sort(key=lambda p: p["compatibility"]["score"] + random.random() * 8, reverse=True)
        out = out[:10]
    for p in out:
        p.pop("_created", None)
    return out[:30]


@api.post("/swipes/undo")
async def undo_swipe(me: User = Depends(current_user)):
    last = await db.swipes.find_one({"from_id": me.id}, sort=[("created_at", -1)])
    if not last or last["action"] != "pass":
        raise HTTPException(400, "Only your most recent pass can be undone")
    await db.swipes.delete_one({"_id": last["_id"]})
    u = User.from_mongo(await db.users.find_one({"_id": oid(last["to_id"])}))
    if not u:
        raise HTTPException(404, "Profile not found")
    p = public_profile(u)
    p["compatibility"] = compatibility(me, u)
    return p


async def create_match_if_mutual(a: str, b: str) -> Optional[str]:
    rev = await db.swipes.find_one({"from_id": b, "to_id": a, "action": {"$in": ["like", "superlike"]}})
    if not rev:
        return None
    pair = sorted([a, b])
    existing = await db.matches.find_one({"users": pair})
    if existing:
        if not existing.get("active", True):
            # A rematch starts empty (messages were deleted on unmatch), so it starts on Signal.
            await db.matches.update_one({"_id": existing["_id"]}, {"$set": {
                "active": True, "created_at": now(), "last_message_at": None, "last_sender_id": None, "unread": {a: 0, b: 0},
                "protocol": SIGNAL_PROTOCOL}})
        return str(existing["_id"])
    res = await db.matches.insert_one(Match(users=pair, unread={a: 0, b: 0}, protocol=SIGNAL_PROTOCOL).to_mongo())
    return str(res.inserted_id)


@api.post("/swipes")
async def swipe(body: SwipeIn, me: User = Depends(current_user)):
    if body.action not in ("like", "pass", "superlike"):
        raise HTTPException(400, "Invalid action")
    target = User.from_mongo(await db.users.find_one({"_id": oid(body.target_id)}))
    if not target or target.id == me.id:
        raise HTTPException(404, "Profile not found")
    if target.id in await blocked_ids(me.id):
        raise HTTPException(404, "Profile not found")
    await db.swipes.update_one({"from_id": me.id, "to_id": target.id},
                               {"$set": {"action": body.action, "note": body.note.strip() if body.action != "pass" else "",
                                         "created_at": now()}}, upsert=True)
    match_id = None
    if body.action != "pass":
        if target.is_seed and random.random() < 0.6:
            await db.swipes.update_one({"from_id": target.id, "to_id": me.id},
                                       {"$setOnInsert": {"action": "like", "created_at": now()}}, upsert=True)
        match_id = await create_match_if_mutual(me.id, target.id)
    return {"matched": bool(match_id), "match_id": match_id, "user": public_profile(target) if match_id else None}


@api.get("/likes")
async def likes(me: User = Depends(current_user)):
    mine = {s["to_id"] async for s in db.swipes.find({"from_id": me.id}, {"to_id": 1})}
    blocked = await blocked_ids(me.id)
    out = []
    async for s in db.swipes.find({"to_id": me.id, "action": {"$in": ["like", "superlike"]}}).sort("created_at", -1):
        if s["from_id"] in mine or s["from_id"] in blocked:
            continue
        u = User.from_mongo(await db.users.find_one({"_id": oid(s["from_id"]), "paused": False, "status": {"$nin": ["banned", "suspended"]}}))
        if u:
            p = public_profile(u)
            p["superlike"] = s["action"] == "superlike"
            p["note"] = s.get("note", "")
            p["compatibility"] = compatibility(me, u)
            out.append(p)
    return out


@api.get("/users/{user_id}")
async def get_user(user_id: str, me: User = Depends(current_user)):
    if user_id in await blocked_ids(me.id):
        raise HTTPException(404, "Profile not found")
    u = User.from_mongo(await db.users.find_one({"_id": oid(user_id)}))
    if not u or (not u.onboarded and u.id != me.id):
        raise HTTPException(404, "Profile not found")
    p = public_profile(u)
    if u.id != me.id:
        p["compatibility"] = compatibility(me, u)
    return p


# ---------------------------------------------------------------- matches & messages
async def load_match(match_id: str, me: User) -> Match:
    m = Match.from_mongo(await db.matches.find_one({"_id": oid(match_id), "users": me.id, "active": True}))
    if not m:
        raise HTTPException(404, "Match not found")
    return m


@api.get("/matches")
async def matches(me: User = Depends(current_user)):
    out = []
    async for doc in db.matches.find({"users": me.id, "active": True}).sort("created_at", -1):
        m = Match.from_mongo(doc)
        other_id = next(u for u in m.users if u != me.id)
        other = User.from_mongo(await db.users.find_one({"_id": oid(other_id)}))
        if not other:
            continue
        out.append({
            "id": m.id, "user": public_profile(other), "created_at": m.created_at.isoformat(),
            "last_message_at": m.last_message_at.isoformat() if m.last_message_at else None,
            "last_sender_id": m.last_sender_id, "unread": m.unread.get(me.id, 0),
        })
    out.sort(key=lambda x: x["last_message_at"] or x["created_at"], reverse=True)
    return out


@api.get("/matches/{match_id}")
async def match_detail(match_id: str, me: User = Depends(current_user)):
    m = await load_match(match_id, me)
    other_id = next(u for u in m.users if u != me.id)
    other = User.from_mongo(await db.users.find_one({"_id": oid(other_id)}))
    return {"id": m.id, "user": public_profile(other), "created_at": m.created_at.isoformat(), "protocol": m.protocol}


@api.delete("/matches/{match_id}")
async def unmatch(match_id: str, me: User = Depends(current_user)):
    m = await load_match(match_id, me)
    await db.matches.update_one({"_id": ObjectId(m.id)}, {"$set": {"active": False}})
    await db.messages.delete_many({"match_id": m.id})
    # Clear likes between the pair so an unmatch never silently rematches.
    await db.swipes.delete_many({"$or": [{"from_id": m.users[0], "to_id": m.users[1]}, {"from_id": m.users[1], "to_id": m.users[0]}]})
    return {"ok": True}


def msg_out(m: Message) -> dict:
    out = {"id": m.id, "sender_id": m.sender_id, "protocol": m.protocol, "created_at": m.created_at.isoformat()}
    if m.protocol == LEGACY_PROTOCOL:
        out.update(ciphertext=m.ciphertext, nonce=m.nonce, sender_public_key=m.sender_public_key,
                   recipient_public_key=m.recipient_public_key)
    elif m.protocol == SIGNAL_PROTOCOL:
        out.update(ciphertext=m.ciphertext, sender_device=m.sender_device, recipient_device=m.recipient_device)
    else:
        out.update(kind=m.kind)
    return out


@api.get("/matches/{match_id}/messages")
async def get_messages(match_id: str, me: User = Depends(current_user)):
    m = await load_match(match_id, me)
    msgs = [Message.from_mongo(d) async for d in db.messages.find({"match_id": m.id}).sort("created_at", 1).limit(500)]
    if m.unread.get(me.id):
        await db.matches.update_one({"_id": ObjectId(m.id)}, {"$set": {f"unread.{me.id}": 0}})
    return [msg_out(x) for x in msgs]


@api.post("/matches/{match_id}/upgrade-encryption")
async def upgrade_encryption(match_id: str, me: User = Depends(current_user)):
    """Explicit, authenticated, one-way upgrade of a legacy chat to Signal. There is no endpoint to revert."""
    m = await load_match(match_id, me)
    if m.protocol == SIGNAL_PROTOCOL:
        return {"protocol": SIGNAL_PROTOCOL}
    res = await db.matches.update_one({"_id": ObjectId(m.id), "protocol": {"$ne": SIGNAL_PROTOCOL}},
                                      {"$set": {"protocol": SIGNAL_PROTOCOL, "upgraded_at": now(), "upgraded_by": me.id}})
    if res.modified_count:
        await db.messages.insert_one(Message(match_id=m.id, sender_id=me.id, protocol="system", kind="upgraded").to_mongo())
    return {"protocol": SIGNAL_PROTOCOL}


# ---------------------------------------------------------------- Signal relay (public keys + routing only)
# One active Signal device per account (deviceId 1). Enrolling a new device replaces the old one, and peers
# see an identity-change warning. The server never receives private keys or plaintext.
B64 = r"^[A-Za-z0-9+/=]+$"


class SignalIdentity(BaseModel):
    version: Literal[1]
    x25519PublicKey: str = Field(min_length=40, max_length=64, pattern=B64)
    ed25519PublicKey: str = Field(min_length=40, max_length=64, pattern=B64)


class ProvisionIn(BaseModel):
    deviceId: int = Field(ge=1, le=1)
    identity: SignalIdentity
    registrationId: int = Field(ge=1, le=16380)
    identityType: Literal["aci"] = "aci"
    platform: str = Field(default="", max_length=20)


class PreKeyIn(BaseModel):
    type: Literal["ecPreKey", "ecSignedPreKey", "kemOneTimePreKey", "kemLastResortPreKey"]
    keyId: int = Field(ge=0, le=2**31)
    publicKey: str = Field(min_length=40, max_length=2200, pattern=B64)
    signature: Optional[str] = Field(default=None, max_length=200, pattern=B64)


class PreKeysIn(BaseModel):
    keys: List[PreKeyIn] = Field(max_length=210)


MAX_OTPKS = 200


def request_device(request: Request) -> str:
    return request.headers.get("x-signal-device", "")


async def active_device(uid: str) -> Optional[dict]:
    return await db.signal_devices.find_one({"user_id": uid, "active": True})


async def my_device(request: Request, me: User) -> dict:
    dev_id = request_device(request)
    d = await db.signal_devices.find_one({"_id": oid(dev_id), "user_id": me.id}) if dev_id else None
    if not d:
        raise HTTPException(409, "DEVICE_UNKNOWN")
    if not d.get("active"):
        raise HTTPException(409, "DEVICE_REVOKED")
    return d


async def require_contact(me: User, uid: str):
    if uid == me.id:
        return
    if uid in await blocked_ids(me.id) or not await db.matches.find_one({"users": sorted([me.id, uid]), "active": True}, {"_id": 1}):
        raise HTTPException(404, "Not found")


def _meta(k: Optional[dict]):
    if not k:
        return None
    at = int(k["at"].replace(tzinfo=timezone.utc).timestamp() * 1000)
    return {"keyId": k["keyId"], "createdAt": at, "expiresAt": at + 30 * 86400 * 1000, "publicKey": k["publicKey"]}


def device_out(d: dict, current: str = "") -> dict:
    return {"id": str(d["_id"]), "platform": d.get("platform", ""), "active": d.get("active", False),
            "created_at": d["created_at"].isoformat(), "revoked_at": d["revoked_at"].isoformat() if d.get("revoked_at") else None,
            "revoked_reason": d.get("revoked_reason"), "current": str(d["_id"]) == current}


@api.post("/signal/identity")
async def signal_provision(body: ProvisionIn, request: Request, me: User = Depends(current_user)):
    ident = body.identity.model_dump()
    cur = await active_device(me.id)
    if cur and cur["identity"] == ident and cur["registration_id"] == body.registrationId:
        return {"device": str(cur["_id"]), "created": False}
    had_device = cur is not None
    await db.signal_devices.update_many({"user_id": me.id, "active": True},
                                        {"$set": {"active": False, "revoked_at": now(), "revoked_reason": "replaced",
                                                  "ec": [], "kem": []}})
    res = await db.signal_devices.insert_one({
        "user_id": me.id, "device_id": 1, "identity": ident, "registration_id": body.registrationId, "active": True,
        "platform": body.platform, "session_jti": token_jti(request), "created_at": now(),
        "spk": None, "lr": None, "ec": [], "kem": []})
    if had_device:
        security_notice(me, "A new device was set up for secure chat",
                        "A new device was just set up for your encrypted chats, replacing the previous one. "
                        "If this was not you, change your password straight away.")
    return {"device": str(res.inserted_id), "created": True}


@api.get("/signal/device-status")
async def signal_device_status(device: str = Query(...), me: User = Depends(current_user)):
    d = await db.signal_devices.find_one({"_id": oid(device), "user_id": me.id})
    return {"active": bool(d and d.get("active")), "revoked_reason": d.get("revoked_reason") if d else "unknown"}


@api.get("/signal/inventory")
async def signal_inventory(request: Request, me: User = Depends(current_user)):
    dev_id = request_device(request)
    d = await db.signal_devices.find_one({"_id": oid(dev_id), "user_id": me.id, "active": True}) if dev_id else None
    if not d:
        return {"ecSignedPreKey": None, "kemLastResortPreKey": None, "ecOneTimePreKeyCount": 0, "kemOneTimePreKeyCount": 0}
    return {"ecSignedPreKey": _meta(d.get("spk")), "kemLastResortPreKey": _meta(d.get("lr")),
            "ecOneTimePreKeyCount": len(d.get("ec", [])), "kemOneTimePreKeyCount": len(d.get("kem", []))}


@api.post("/signal/prekeys")
async def signal_upload_prekeys(body: PreKeysIn, request: Request, me: User = Depends(current_user)):
    d = await my_device(request, me)
    sets, push = {}, {"ec": [], "kem": []}
    for k in body.keys:
        rec = {"keyId": k.keyId, "publicKey": k.publicKey, "signature": k.signature, "at": now()}
        if k.type == "ecSignedPreKey":
            if not k.signature:
                raise HTTPException(400, "Signed prekey needs a signature")
            sets["spk"] = rec
        elif k.type == "kemLastResortPreKey":
            if not k.signature:
                raise HTTPException(400, "KEM prekey needs a signature")
            sets["lr"] = rec
        elif k.type == "ecPreKey":
            push["ec"].append(rec)
        else:
            if not k.signature:
                raise HTTPException(400, "KEM prekey needs a signature")
            push["kem"].append(rec)
    upd: dict = {}
    if sets:
        upd["$set"] = sets
    pushes = {f: {"$each": v, "$slice": -MAX_OTPKS} for f, v in push.items() if v}
    if pushes:
        upd["$push"] = pushes
    if upd:
        await db.signal_devices.update_one({"_id": d["_id"], "active": True}, upd)
    return {"ok": True}


@api.post("/signal/prekeys/clear-kem")
async def signal_clear_kem(request: Request, me: User = Depends(current_user)):
    d = await my_device(request, me)
    await db.signal_devices.update_one({"_id": d["_id"]}, {"$set": {"kem": []}})
    return {"cleared": len(d.get("kem", []))}


@api.get("/signal/identity/{user_id}")
async def signal_identity(user_id: str, me: User = Depends(current_user)):
    await require_contact(me, user_id)
    d = await active_device(user_id)
    if not d:
        return {"identity": None, "device": None, "registrationId": None}
    return {"identity": d["identity"], "device": str(d["_id"]), "registrationId": d["registration_id"]}


@api.post("/signal/bundle/{user_id}")
async def signal_bundle(user_id: str, me: User = Depends(current_user)):
    await require_contact(me, user_id)
    if user_id == me.id:
        raise HTTPException(400, "Cannot fetch your own bundle")
    rate_limit_key("bundle", me.id, 60, 3600)
    # Atomically consume one EC and one KEM one-time prekey (the pre-update document holds the popped ones).
    d = await db.signal_devices.find_one_and_update({"user_id": user_id, "active": True}, {"$pop": {"ec": -1, "kem": -1}},
                                                    return_document=ReturnDocument.BEFORE)
    if not d or not d.get("spk") or not d.get("lr"):
        raise HTTPException(409, "NO_SECURE_DEVICE")
    ec, kem = (d.get("ec") or [None])[0], (d.get("kem") or [None])[0]
    return {"device": str(d["_id"]), "bundle": {
        "registrationId": d["registration_id"], "deviceId": 1, "identity": d["identity"],
        "ecSignedPreKey": {"keyId": d["spk"]["keyId"], "publicKey": d["spk"]["publicKey"], "signature": d["spk"]["signature"]},
        "ecOneTimePreKey": {"keyId": ec["keyId"], "publicKey": ec["publicKey"]} if ec else None,
        "kemLastResortPreKey": {"keyId": d["lr"]["keyId"], "publicKey": d["lr"]["publicKey"], "signature": d["lr"]["signature"]},
        "kemOneTimePreKey": {"keyId": kem["keyId"], "publicKey": kem["publicKey"], "signature": kem["signature"]} if kem else None,
    }}


@api.get("/signal/devices")
async def signal_devices(request: Request, me: User = Depends(current_user)):
    cur = request_device(request)
    docs = [d async for d in db.signal_devices.find({"user_id": me.id}).sort("created_at", -1).limit(20)]
    return [device_out(d, cur) for d in docs]


@api.delete("/signal/devices/{device_id}")
async def signal_revoke(device_id: str, request: Request, me: User = Depends(current_user)):
    cur = request_device(request)
    if not cur:
        raise HTTPException(409, "Secure chat is still starting on this device. Try again in a moment.")
    if device_id == cur:
        raise HTTPException(400, "Use Sign out to remove this device")
    d = await db.signal_devices.find_one({"_id": oid(device_id), "user_id": me.id})
    if not d:
        raise HTTPException(404, "Device not found")
    await db.signal_devices.update_one({"_id": d["_id"]}, {"$set": {"active": False, "revoked_at": now(),
                                                                    "revoked_reason": "revoked", "ec": [], "kem": []}})
    # Also end that device's login session, so it can't quietly re-enroll without the password.
    if d.get("session_jti"):
        await db.revoked_sessions.update_one({"jti": d["session_jti"]}, {"$set": {"jti": d["session_jti"], "at": now()}}, upsert=True)
    return {"ok": True}



@api.post("/matches/{match_id}/messages")
async def send_message(match_id: str, body: MessageIn, request: Request, me: User = Depends(current_user)):
    m = await load_match(match_id, me)
    other_id = next(u for u in m.users if u != me.id)
    if other_id in await blocked_ids(me.id):
        raise HTTPException(403, "You can't message this person")
    if m.protocol != SIGNAL_PROTOCOL:
        raise HTTPException(409, "UPGRADE_REQUIRED")
    mine = await active_device(me.id)
    if not mine or mine["_id"] != oid(request_device(request)):
        raise HTTPException(409, "DEVICE_NOT_ACTIVE")
    theirs = await active_device(other_id)
    if not theirs or str(theirs["_id"]) != body.recipient_device:
        raise HTTPException(409, "RECIPIENT_DEVICE_CHANGED")
    # Routing metadata is set by the server from trusted context, never taken from the client.
    msg = Message(match_id=m.id, sender_id=me.id, protocol=SIGNAL_PROTOCOL, ciphertext=body.ciphertext,
                  sender_device=str(mine["_id"]), recipient_device=body.recipient_device)
    res = await db.messages.insert_one(msg.to_mongo())
    msg.id = str(res.inserted_id)
    await db.matches.update_one({"_id": ObjectId(m.id)}, {"$set": {"last_message_at": msg.created_at, "last_sender_id": me.id},
                                                          "$inc": {f"unread.{other_id}": 1}})
    return msg_out(msg)


# ---------------------------------------------------------------- safety
@api.post("/blocks")
async def block(body: BlockIn, me: User = Depends(current_user)):
    if body.user_id == me.id or not ObjectId.is_valid(body.user_id) or not await db.users.find_one({"_id": ObjectId(body.user_id)}, {"_id": 1}):
        raise HTTPException(400, "Invalid user")
    await db.blocks.update_one({"blocker_id": me.id, "blocked_id": body.user_id},
                               {"$set": {"created_at": now()}}, upsert=True)
    await db.matches.update_many({"users": {"$all": [me.id, body.user_id]}}, {"$set": {"active": False}})
    return {"ok": True}


@api.get("/blocks")
async def list_blocks(me: User = Depends(current_user)):
    out = []
    async for b in db.blocks.find({"blocker_id": me.id}).sort("created_at", -1):
        u = User.from_mongo(await db.users.find_one({"_id": oid(b["blocked_id"])}))
        if u:
            out.append({"id": u.id, "name": u.name, "photo": photo_url(u.photos[0]) if u.photos else None})
    return out


@api.delete("/blocks/{user_id}")
async def unblock(user_id: str, me: User = Depends(current_user)):
    await db.blocks.delete_one({"blocker_id": me.id, "blocked_id": user_id})
    return {"ok": True}


@api.post("/reports")
async def report(body: ReportIn, me: User = Depends(current_user)):
    if body.user_id == me.id or not ObjectId.is_valid(body.user_id) or not await db.users.find_one({"_id": ObjectId(body.user_id)}, {"_id": 1}):
        raise HTTPException(400, "Invalid user")
    await db.reports.insert_one({"reporter_id": me.id, "reported_id": body.user_id, "reason": body.reason,
                                 "details": body.details, "status": "open", "created_at": now()})
    return {"ok": True}


# ---------------------------------------------------------------- moderation
class AppealIn(BaseModel):
    message: str = Field(min_length=10, max_length=1000)


class ResolveIn(BaseModel):
    action: str  # dismiss | warn | suspend | ban
    note: str = Field(default="", max_length=500)
    days: int = Field(default=7, ge=1, le=365)


class DecideIn(BaseModel):
    decision: str  # approve | deny
    note: str = Field(default="", max_length=500)


@api.get("/appeals")
async def my_appeals(me: User = Depends(current_user)):
    return [{"id": str(a["_id"]), "message": a["message"], "status": a["status"], "note": a.get("note", ""),
             "created_at": a["created_at"].isoformat()} async for a in db.appeals.find({"user_id": me.id}).sort("created_at", -1)]


@api.post("/appeals")
async def create_appeal(body: AppealIn, me: User = Depends(current_user)):
    if not is_restricted(me):
        raise HTTPException(400, "Your account isn't restricted")
    if await db.appeals.find_one({"user_id": me.id, "status": "open"}):
        raise HTTPException(400, "You already have an appeal under review")
    await db.appeals.insert_one({"user_id": me.id, "message": body.message.strip(), "status": "open",
                                 "restriction": me.status, "reason": me.status_reason, "created_at": now()})
    return {"ok": True}


async def brief(uid: str) -> dict:
    u = User.from_mongo(await db.users.find_one({"_id": ObjectId(uid)})) if ObjectId.is_valid(uid) else None
    if not u:
        return {"id": uid, "name": "Deleted user", "photo": None, "status": "deleted"}
    return {"id": u.id, "name": u.name, "email": u.email, "photo": photo_url(u.photos[0]) if u.photos else None,
            "status": u.status, "is_demo": u.is_seed}


@api.get("/admin/stats")
async def admin_stats(_: User = Depends(require_admin)):
    return {"users": await db.users.count_documents({"is_seed": False, "role": "user"}),
            "matches": await db.matches.count_documents({"active": True}),
            "open_reports": await db.reports.count_documents({"status": "open"}),
            "open_appeals": await db.appeals.count_documents({"status": "open"}),
            "suspended": await db.users.count_documents({"status": "suspended"}),
            "banned": await db.users.count_documents({"status": "banned"})}


@api.get("/admin/reports")
async def admin_reports(status: str = Query(default="open"), _: User = Depends(require_admin)):
    out = []
    async for r in db.reports.find({"status": status}).sort("created_at", -1).limit(100):
        out.append({"id": str(r["_id"]), "reason": r["reason"], "details": r.get("details", ""), "status": r["status"],
                    "created_at": r["created_at"].isoformat(), "resolution": r.get("resolution"),
                    "reported": await brief(r["reported_id"]), "reporter": await brief(r["reporter_id"]),
                    "prior_reports": await db.reports.count_documents({"reported_id": r["reported_id"]})})
    return out


@api.post("/admin/reports/{report_id}/resolve")
async def resolve_report(report_id: str, body: ResolveIn, admin: User = Depends(require_admin)):
    if body.action not in ("dismiss", "warn", "suspend", "ban"):
        raise HTTPException(400, "Invalid action")
    r = await db.reports.find_one({"_id": oid(report_id)})
    if not r:
        raise HTTPException(404, "Report not found")
    if body.action != "dismiss":
        target = await db.users.find_one({"_id": oid(r["reported_id"])})
        if not target:
            raise HTTPException(404, "Reported user no longer exists")
        if target.get("role") == "admin":
            raise HTTPException(400, "Admins can't be actioned here")
        reason = body.note.strip() or r["reason"]
        upd = {"warn": {"status": "warned", "status_reason": reason, "suspended_until": None},
               "suspend": {"status": "suspended", "status_reason": reason, "suspended_until": now() + timedelta(days=body.days)},
               "ban": {"status": "banned", "status_reason": reason, "suspended_until": None}}[body.action]
        await db.users.update_one({"_id": target["_id"]}, {"$set": upd})
    await db.reports.update_many({"reported_id": r["reported_id"], "status": "open"} if body.action != "dismiss" else {"_id": r["_id"]},
                                 {"$set": {"status": "resolved", "resolution": body.action, "resolved_by": admin.id, "resolved_at": now()}})
    await audit(admin, f"report_{body.action}", r["reported_id"], body.note)
    return {"ok": True}


@api.get("/admin/appeals")
async def admin_appeals(status: str = Query(default="open"), _: User = Depends(require_admin)):
    return [{"id": str(a["_id"]), "message": a["message"], "status": a["status"], "restriction": a.get("restriction"),
             "reason": a.get("reason", ""), "created_at": a["created_at"].isoformat(), "user": await brief(a["user_id"])}
            async for a in db.appeals.find({"status": status}).sort("created_at", 1).limit(100)]


@api.post("/admin/appeals/{appeal_id}/decide")
async def decide_appeal(appeal_id: str, body: DecideIn, admin: User = Depends(require_admin)):
    if body.decision not in ("approve", "deny"):
        raise HTTPException(400, "Invalid decision")
    a = await db.appeals.find_one({"_id": oid(appeal_id), "status": "open"})
    if not a:
        raise HTTPException(404, "Appeal not found")
    if body.decision == "approve":
        await db.users.update_one({"_id": oid(a["user_id"])}, {"$set": {"status": "active", "status_reason": "", "suspended_until": None}})
    await db.appeals.update_one({"_id": a["_id"]}, {"$set": {"status": "approved" if body.decision == "approve" else "denied",
                                                             "note": body.note.strip(), "decided_by": admin.id, "decided_at": now()}})
    await audit(admin, f"appeal_{body.decision}", a["user_id"], body.note)
    return {"ok": True}


@api.get("/admin/audit")
async def admin_audit(_: User = Depends(require_admin)):
    return [{"action": x["action"], "target_id": x["target_id"], "detail": x.get("detail", ""), "admin_id": x["admin_id"],
             "created_at": x["created_at"].isoformat()} async for x in db.audit_log.find().sort("created_at", -1).limit(50)]


async def seed_admin():
    email = os.environ["ADMIN_EMAIL"].strip().lower()
    await db.users.update_one({"email": email}, {
        "$set": {"role": "admin", "verified": True},
        "$setOnInsert": {k: v for k, v in User(email=email, password_hash=hash_pw(os.environ["ADMIN_PASSWORD"]),
                                               name="Moderator").to_mongo().items() if k not in ("role", "verified", "email")},
    }, upsert=True)


# ---------------------------------------------------------------- seed data
def unsplash(pid: str) -> str:
    return f"https://images.unsplash.com/photo-{pid}?w=900&q=80&auto=format&fit=crop"


ALL = ["woman", "man", "nonbinary"]
SEEDS = [
    ("maya@bytetalks.app", "Maya", "1997-04-12", "woman", ["man"], "Product designer who sketches on trains. Looking for someone to get lost in bookstores with.", "Product Designer", "Brooklyn", ["Design", "Coffee", "Books", "Hiking"], ["1544005313-94ddf0286df2", "1494790108377-be9c29b29330"]),
    ("leo@bytetalks.app", "Leo", "1995-09-03", "man", ["woman"], "Backend engineer by day, amateur chef by night. I make a mean ramen.", "Software Engineer", "Austin", ["Cooking", "Tech", "Running", "Jazz"], ["1507003211169-0a1dd7228f2d", "1500648767791-00dcc994a43e"]),
    ("ava@bytetalks.app", "Ava", "1998-01-22", "woman", ALL, "Climber, cat person, and certified sunset chaser.", "Marine Biologist", "San Diego", ["Climbing", "Ocean", "Cats", "Photography"], ["1506863530036-1efeddceb993", "1438761681033-6461ffad8d80"]),
    ("noah@bytetalks.app", "Noah", "1994-06-15", "man", ALL, "Architect who believes good conversation beats good wifi.", "Architect", "Chicago", ["Architecture", "Cycling", "Vinyl", "Travel"], ["1506794778202-cad84cf45f1d", "1539571696357-5a69c17a67c6"]),
    ("zara@bytetalks.app", "Zara", "1996-11-30", "woman", ALL, "Startup founder. Ask me about my plant collection (it is out of control).", "Founder", "New York", ["Startups", "Plants", "Yoga", "Podcasts"], ["1552699611-e2c208d5d9cf", "1534528741775-53994a69daeb"]),
    ("kai@bytetalks.app", "Kai", "1999-02-08", "nonbinary", ALL, "Illustrator and synth nerd. Let's trade playlists.", "Illustrator", "Portland", ["Art", "Synths", "Gaming", "Anime"], ["1492562080023-ab3db95bfbce"]),
    ("sofia@bytetalks.app", "Sofia", "1993-07-19", "woman", ALL, "Doctor who dances salsa on weekends. Kindness is my love language.", "Physician", "Miami", ["Dancing", "Travel", "Wine", "Fitness"], ["1517841905240-472988babdf9", "1524504388940-b1c1722653e1"]),
    ("ethan@bytetalks.app", "Ethan", "1996-03-27", "man", ALL, "Data scientist. Weekend hiker. Will always share my fries.", "Data Scientist", "Seattle", ["Hiking", "AI", "Board Games", "Coffee"], ["1500648767791-00dcc994a43e"]),
    ("lena@bytetalks.app", "Lena", "1997-12-05", "woman", ALL, "Writer, night-owl, and amateur astronomer. Tell me your favorite constellation.", "Writer", "Denver", ["Writing", "Astronomy", "Poetry", "Tea"], ["1531123897727-8f129e1688ce", "1488426862026-3ee34a7d66df"]),
    ("omar@bytetalks.app", "Omar", "1992-08-14", "man", ALL, "Musician and coffee roaster. Let's find the best espresso in town.", "Musician", "Los Angeles", ["Music", "Coffee", "Surfing", "Film"], ["1539571696357-5a69c17a67c6"]),
]
SEED_PASSWORD = "ByteTalks123!"
SEED_PROMPTS = [
    ("A perfect first date", "Coffee, a long walk, and a bookstore we can get lost in."),
    ("I geek out on", "Tiny details in good design and anything about space."),
    ("Let's debate", "Pineapple on pizza is not just valid, it's superior."),
    ("My simple pleasures", "Sunday markets, fresh bread, and a playlist on shuffle."),
    ("You should message me if", "You have a great food recommendation in your city."),
]


async def seed():
    pw = hash_pw(SEED_PASSWORD)
    for i, (email, name, dob, gender, interested, bio, job, city, interests, photos) in enumerate(SEEDS):
        if await db.users.find_one({"email": email}):
            await db.users.update_one({"email": email, "is_seed": True, "intention": None}, {"$set": {
                "intention": list(INTENTION_GROUPS)[i % 5], "photo_verified": False,
                "languages": ["English"] + (["Spanish"] if i % 3 == 0 else []),
                "prompts": [{"question": SEED_PROMPTS[i % len(SEED_PROMPTS)][0], "answer": SEED_PROMPTS[i % len(SEED_PROMPTS)][1]}]}})
            continue
        u = User(email=email, password_hash=pw, verified=True, name=name, dob=dob, gender=gender,
                 interested_in=interested, bio=bio, job=job, city=city, interests=interests,
                 photos=[Photo(id=str(uuid.uuid4()), url=unsplash(p)) for p in photos],
                 onboarded=True, is_seed=True, photo_verified=False,
                 intention=list(INTENTION_GROUPS)[i % 5], languages=["English"] + (["Spanish"] if i % 3 == 0 else []),
                 prompts=[{"question": SEED_PROMPTS[i % len(SEED_PROMPTS)][0], "answer": SEED_PROMPTS[i % len(SEED_PROMPTS)][1]}])
        await db.users.insert_one(u.to_mongo())


async def seed_likes_for(u: User):
    """Give new members a warm welcome: a few demo profiles like them."""
    seeds = [User.from_mongo(d) async for d in db.users.find({"is_seed": True, "_id": {"$ne": ObjectId(u.id)}})]
    seeds = [s for s in seeds if s.gender in u.interested_in and (not s.interested_in or u.gender in s.interested_in)]
    random.shuffle(seeds)
    for s in seeds[:3]:
        await db.swipes.update_one({"from_id": s.id, "to_id": u.id},
                                   {"$setOnInsert": {"action": random.choice(["like", "like", "superlike"]), "created_at": now()}},
                                   upsert=True)


@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.swipes.create_index([("from_id", 1), ("to_id", 1)], unique=True)
    await db.swipes.create_index("to_id")
    await db.matches.create_index("users")
    await db.messages.create_index([("match_id", 1), ("created_at", 1)])
    await db.auth_codes.create_index("expires_at", expireAfterSeconds=0)
    await db.signal_devices.create_index([("user_id", 1), ("active", 1)])
    await db.revoked_sessions.create_index("jti", unique=True)
    await db.revoked_sessions.create_index("at", expireAfterSeconds=(JWT_DAYS + 1) * 86400)
    await seed()
    await seed_admin()
    try:
        await run_in_threadpool(init_storage)
        logger.info("Object storage initialized")
    except Exception as e:
        logger.error("Storage init failed: %s", e)


app.include_router(api)
app.add_middleware(CORSMiddleware, allow_credentials=True, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
