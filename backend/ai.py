"""Claude helper for BYTE TALKS. Only profile text and report metadata are ever sent, never chat messages (they're E2EE)."""
import json
import os
import re
import uuid

from emergentintegrations.llm.chat import LlmChat, StreamDone, TextDelta, UserMessage

MODEL = "claude-sonnet-5-5"


def _key() -> str:
    # The user's own Anthropic key wins when it's set; otherwise the Emergent LLM key.
    return (os.environ.get("ANTHROPIC_API_KEY") or "").strip() or os.environ["EMERGENT_LLM_KEY"]


async def ask_json(system: str, prompt: str):
    """Streams one Claude answer, collects it and parses the JSON it returns."""
    chat = LlmChat(api_key=_key(), session_id=f"bt-{uuid.uuid4().hex}",
                   system_message=system + "\nReply with valid JSON only. No markdown, no code fences.").with_model("anthropic", MODEL)
    parts = []
    async for ev in chat.stream_message(UserMessage(text=prompt)):
        if isinstance(ev, TextDelta):
            parts.append(ev.content)
        elif isinstance(ev, StreamDone):
            break
    text = "".join(parts).strip()
    m = re.search(r"[\[{].*[\]}]", text, re.S)
    return json.loads(m.group(0) if m else text)


def profile_brief(p: dict) -> dict:
    return {k: p.get(k) for k in ("name", "age", "bio", "job", "city", "interests", "intention", "languages")} | {
        "prompts": [{"q": x.get("question") or x.get("q"), "a": x.get("answer") or x.get("a")} for x in (p.get("prompts") or [])][:3]}
