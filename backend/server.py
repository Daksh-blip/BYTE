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
from typing import Annotated, Optional, List
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
    created_at: datetime = Field(default_factory=now)


class Match(BaseDocument):
    users: List[str]
    created_at: datetime = Field(default_factory=now)
    last_message_at: Optional[datetime] = None
    last_sender_id: Optional[str] = None
    unread: dict = {}
    active: bool = True


class Message(BaseDocument):
    match_id: str
    sender_id: str
    ciphertext: str
    nonce: str
    sender_public_key: str
    recipient_public_key: str
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
              "paused": u.paused, "age_min": u.age_min, "age_max": u.age_max, "verified": u.verified})
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


def make_token(uid: str) -> str:
    t = now()
    return jwt.encode({"sub": uid, "typ": "access", "iat": t, "exp": t + timedelta(days=JWT_DAYS)}, JWT_SECRET, algorithm="HS256")


def digest(v: str) -> str:
    return hashlib.sha256(v.encode()).hexdigest()


async def user_from_token(token: Optional[str]) -> User:
    if not token:
        raise HTTPException(401, "Not authenticated")
    try:
        p = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        if p.get("typ") != "access":
            raise ValueError()
        doc = await db.users.find_one({"_id": ObjectId(p["sub"])})
    except Exception:
        raise HTTPException(401, "Invalid or expired session")
    if not doc:
        raise HTTPException(401, "User not found")
    return User.from_mongo(doc)


async def current_user(creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer)) -> User:
    return await user_from_token(creds.credentials if creds else None)


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
        logger.error("Email send failed: %s %s", e.response.status_code, e.response.text)
        raise HTTPException(502, "Failed to send email")


def code_email(name: str, code: str, purpose: str) -> tuple[str, str]:
    title = "Verify your email" if purpose == "verify" else "Reset your password"
    line = ("Use this code to verify your email and finish creating your account."
            if purpose == "verify" else "Use this code in the app to set a new password.")
    html = (
        '<table role="presentation" width="100%" style="background:#090A0F"><tr><td style="padding:32px;'
        'font-family:Arial,sans-serif;color:#F2F2F4">'
        f'<h2 style="color:#00E5FF;margin:0 0 16px">{escape(EMAIL_FROM_NAME)}</h2>'
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
        raise HTTPException(400, "Code expired. Request a new one.")
    if row["attempts"] >= 5:
        raise HTTPException(400, "Too many wrong attempts. Request a new code.")
    if not secrets.compare_digest(row["code_hash"], digest(code.strip())):
        await db.auth_codes.update_one({"_id": row["_id"]}, {"$inc": {"attempts": 1}})
        raise HTTPException(400, "Incorrect code")
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


class KeyIn(BaseModel):
    public_key: str = Field(min_length=40, max_length=60)


class SwipeIn(BaseModel):
    target_id: str
    action: str
    note: str = Field(default="", max_length=140)


class MessageIn(BaseModel):
    ciphertext: str = Field(min_length=1, max_length=20000)
    nonce: str = Field(min_length=20, max_length=40)
    sender_public_key: str
    recipient_public_key: str


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
        raise HTTPException(400, "Incorrect code")
    await consume_code(email, "verify", body.code)
    await db.users.update_one({"_id": ObjectId(u.id)}, {"$set": {"verified": True}})
    u.verified = True
    return {"token": make_token(u.id), "user": private_profile(u)}


@api.post("/auth/login")
async def login(body: LoginIn, request: Request):
    rate_limit(request, "login", 10, 300)
    rate_limit_key("login", str(body.email).lower(), 8, 300)
    u = User.from_mongo(await db.users.find_one({"email": str(body.email).lower()}))
    if not u or not check_pw(body.password, u.password_hash):
        raise HTTPException(401, "Invalid email or password")
    if not u.verified:
        raise HTTPException(403, "EMAIL_NOT_VERIFIED")
    return {"token": make_token(u.id), "user": private_profile(u)}


@api.post("/auth/forgot-password")
async def forgot_password(body: EmailIn, request: Request):
    rate_limit(request, "forgot", 5, 3600)
    email = str(body.email).lower()
    u = User.from_mongo(await db.users.find_one({"email": email}))
    res = {"email_sent": True}
    if u:
        res = await issue_code(email, u.name, "reset")
    return {"message": "If that email has an account, a reset code was sent", **res}


@api.post("/auth/reset-password")
async def reset_password(body: ResetIn, request: Request):
    rate_limit(request, "reset", 10, 3600)
    email = str(body.email).lower()
    rate_limit_key("reset", email, 8, 3600)
    u = User.from_mongo(await db.users.find_one({"email": email}))
    if not u:
        raise HTTPException(400, "Incorrect code")
    await consume_code(email, "reset", body.code)
    await db.users.update_one({"_id": ObjectId(u.id)}, {"$set": {"password_hash": hash_pw(body.password), "verified": True}})
    return {"message": "Password updated. You can sign in now."}


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


@api.put("/me/public-key")
async def set_public_key(body: KeyIn, me: User = Depends(current_user)):
    await db.users.update_one({"_id": ObjectId(me.id)}, {"$set": {"public_key": body.public_key}})
    return {"ok": True}


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
    await user_from_token(creds.credentials if creds else token)
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
    msgs = [{"match_id": m["match_id"], "sent_by_me": m["sender_id"] == uid, "ciphertext": m["ciphertext"],
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
    q = {"onboarded": True, "paused": False, "_id": {"$nin": [ObjectId(x) for x in exclude if ObjectId.is_valid(x)]}}
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
            await db.matches.update_one({"_id": existing["_id"]}, {"$set": {
                "active": True, "created_at": now(), "last_message_at": None, "last_sender_id": None, "unread": {a: 0, b: 0}}})
        return str(existing["_id"])
    res = await db.matches.insert_one(Match(users=pair, unread={a: 0, b: 0}).to_mongo())
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
        u = User.from_mongo(await db.users.find_one({"_id": oid(s["from_id"]), "paused": False}))
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
    return {"id": m.id, "user": public_profile(other), "created_at": m.created_at.isoformat()}


@api.delete("/matches/{match_id}")
async def unmatch(match_id: str, me: User = Depends(current_user)):
    m = await load_match(match_id, me)
    await db.matches.update_one({"_id": ObjectId(m.id)}, {"$set": {"active": False}})
    await db.messages.delete_many({"match_id": m.id})
    # Clear likes between the pair so an unmatch never silently rematches.
    await db.swipes.delete_many({"$or": [{"from_id": m.users[0], "to_id": m.users[1]}, {"from_id": m.users[1], "to_id": m.users[0]}]})
    return {"ok": True}


def msg_out(m: Message) -> dict:
    return {"id": m.id, "sender_id": m.sender_id, "ciphertext": m.ciphertext, "nonce": m.nonce,
            "sender_public_key": m.sender_public_key, "recipient_public_key": m.recipient_public_key,
            "created_at": m.created_at.isoformat()}


@api.get("/matches/{match_id}/messages")
async def get_messages(match_id: str, me: User = Depends(current_user)):
    m = await load_match(match_id, me)
    msgs = [Message.from_mongo(d) async for d in db.messages.find({"match_id": m.id}).sort("created_at", 1).limit(500)]
    if m.unread.get(me.id):
        await db.matches.update_one({"_id": ObjectId(m.id)}, {"$set": {f"unread.{me.id}": 0}})
    return [msg_out(x) for x in msgs]


@api.post("/matches/{match_id}/messages")
async def send_message(match_id: str, body: MessageIn, me: User = Depends(current_user)):
    m = await load_match(match_id, me)
    other_id = next(u for u in m.users if u != me.id)
    if other_id in await blocked_ids(me.id):
        raise HTTPException(403, "You can't message this person")
    other = User.from_mongo(await db.users.find_one({"_id": oid(other_id)}))
    if body.sender_public_key != me.public_key or not other or body.recipient_public_key != other.public_key:
        raise HTTPException(409, "Security keys changed. Refresh the chat and try again.")
    msg = Message(match_id=m.id, sender_id=me.id, **body.model_dump())
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
    await seed()
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
