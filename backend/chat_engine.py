#!/usr/bin/env python3
"""
chat_engine.py — Hybrid advisory chatbot for the Crop Irrigation dashboard.

Two modes, decided per message:
  1. STRUCTURED (button options)  → fast, deterministic answers built from the
     REAL pipeline summary (/api/summary data). No hallucination, no Gemini call.
  2. FREE-TEXT                    → Gemini, constrained by a system prompt that
     keeps it on-project (crop / irrigation / stress) and refuses off-topic.

If Gemini is unavailable (no key / network), it degrades to a rule-based reply
instead of erroring — so the demo never shows "couldn't reach server".

No new dependencies: uses urllib from the stdlib for the Gemini HTTP call.
"""

import os
import json
import urllib.request
import urllib.error
from typing import List, Dict, Optional, Callable

# ── Primary LLM: Groq (fast, reliable free tier) ─────────────────────────────
GROQ_MODEL = "llama-3.3-70b-versatile"
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"

# ── Fallback LLM: Gemini (used only if Groq key/call is unavailable) ──────────
GEMINI_MODEL = "gemini-flash-latest"
GEMINI_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    f"{GEMINI_MODEL}:generateContent"
)

# ── System prompt: keeps Gemini scoped to THIS project ───────────────────────
SYSTEM_PROMPT = """You are the advisory assistant embedded in an AI-driven crop \
irrigation dashboard for Punjab, India. The dashboard fuses optical (Sentinel-2) \
and SAR (Sentinel-1) satellite data via Google Earth Engine, classifies crops \
(Wheat, Rice, Cotton, Fallow), detects moisture stress, and generates FAO-56 \
based 8-day irrigation advisories.

RULES:
- Only answer questions about: crops, irrigation, moisture stress, soil, \
satellite/remote-sensing indices (NDVI/NDWI/SAR), and this dashboard's outputs.
- If asked anything off-topic (politics, sports, general chit-chat, coding), \
politely redirect: say you can only help with crop and irrigation questions.
- Keep answers under 80 words, practical, and specific to Punjab agriculture.
- When live data is provided in the context, use it. Never invent specific \
numbers that aren't given.
- Be concise and farmer-friendly. No markdown headers."""


# ── Structured option tree (the button flow) ─────────────────────────────────
# Each node: a canned answer template (filled with live data) + follow-up options.
OPTION_TREE: Dict[str, Dict] = {
    "__root__": {
        "prompt": "Pick a topic below, or just type a question.",
        "options": ["Crop overview", "Irrigation advice", "Moisture stress", "How does this work?"],
    },
    "Crop overview": {
        "answer": lambda d: (
            f"Across {d['total']} analysed pixels, the dominant crops are "
            f"{d['crop_summary']}. Average peak NDVI is {d['avg_ndvi']}, "
            f"indicating {'healthy' if d['avg_ndvi'] > 0.5 else 'moderate'} canopy vigour."
        ),
        "options": ["Irrigation advice", "Moisture stress", "Which crop needs most water?"],
    },
    "Irrigation advice": {
        "answer": lambda d: (
            f"{d['urgent']} pixel(s) are flagged Urgent and {d['soon']} need irrigation soon. "
            f"Wheat needs water at crown-root (21d) and flowering; Rice needs standing water "
            f"through tillering. Prioritise the Urgent zones first."
        ),
        "options": ["Which crop needs most water?", "Moisture stress", "Crop overview"],
    },
    "Moisture stress": {
        "answer": lambda d: (
            f"{d['stressed_pct']}% of cropland shows moisture stress "
            f"({d['high']} high, {d['moderate']} moderate). Stress is detected by combining "
            f"low VCI (NDVI-based) with SAR backscatter drop — a pre-visual drought signal."
        ),
        "options": ["Irrigation advice", "Crop overview", "How does this work?"],
    },
    "Which crop needs most water?": {
        "answer": lambda d: (
            f"By FAO-56 crop coefficient (Kc), Rice has the highest demand (Kc 1.20), then "
            f"Wheat (1.15), then Cotton (1.05). In your area the highest average deficit is in "
            f"the {d['top_deficit_crop']} zone."
        ),
        "options": ["Irrigation advice", "Moisture stress", "Crop overview"],
    },
    "How does this work?": {
        "answer": lambda d: (
            "The system fuses Sentinel-2 optical and Sentinel-1 radar over your field, "
            "masks non-cropland with Dynamic World, classifies crops from their seasonal "
            "NDVI/SAR signature, then applies FAO-56 water balance to flag irrigation needs."
        ),
        "options": ["Crop overview", "Irrigation advice", "Moisture stress"],
    },
}


def _summarize_live_data(summary: Optional[Dict]) -> Dict:
    """Turn /api/summary output into flat fields the templates can use."""
    if not summary:
        return {
            "total": 0, "crop_summary": "no data yet", "avg_ndvi": 0.0,
            "urgent": 0, "soon": 0, "stressed_pct": 0, "high": 0, "moderate": 0,
            "top_deficit_crop": "Wheat",
        }
    crop_dist = summary.get("crop_distribution", {})
    stress    = summary.get("stress_distribution", {})
    adv       = summary.get("advisory_distribution", {})
    total     = summary.get("total_pixels", 0) or 1

    crop_summary = ", ".join(
        f"{k} ({v})" for k, v in sorted(crop_dist.items(), key=lambda x: -x[1])
    ) or "no crops detected"

    stressed = stress.get("high", 0) + stress.get("moderate", 0)
    top_deficit_crop = max(crop_dist, key=crop_dist.get) if crop_dist else "Wheat"

    return {
        "total": summary.get("total_pixels", 0),
        "crop_summary": crop_summary,
        "avg_ndvi": summary.get("avg_peak_ndvi", 0.0),
        "urgent": adv.get("Urgent", 0),
        "soon": adv.get("Irrigate Soon", 0),
        "stressed_pct": round(stressed / total * 100),
        "high": stress.get("high", 0),
        "moderate": stress.get("moderate", 0),
        "top_deficit_crop": top_deficit_crop,
    }


def _call_gemini(message: str, history: List[Dict], live_ctx: str) -> Optional[str]:
    """Call Gemini via stdlib urllib. Returns None on any failure."""
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return None

    contents = []
    for turn in history[-6:]:  # keep last few turns for context
        role = "user" if turn.get("role") == "user" else "model"
        contents.append({"role": role, "parts": [{"text": turn.get("text", "")}]})
    contents.append({
        "role": "user",
        "parts": [{"text": f"{message}\n\n[Live dashboard data: {live_ctx}]"}],
    })

    payload = {
        "system_instruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": contents,
        "generationConfig": {
            "maxOutputTokens": 800,      # room for the answer (was 200 — too small)
            "temperature": 0.4,
            # gemini-flash-latest is a "thinking" model; without this it spends the
            # whole token budget on internal reasoning and truncates the reply.
            "thinkingConfig": {"thinkingBudget": 0},
        },
    }

    # Retry on transient 503 (model busy) / 429 spikes — Gemini free tier
    # intermittently throttles. 3 attempts with short backoff before giving up
    # to the rule-based fallback, so the demo stays smooth.
    import time
    for attempt in range(3):
        try:
            req = urllib.request.Request(
                f"{GEMINI_URL}?key={api_key}",
                data=json.dumps(payload).encode(),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode())
            return data["candidates"][0]["content"]["parts"][0]["text"].strip()
        except urllib.error.HTTPError as e:
            if e.code in (503, 429) and attempt < 2:
                time.sleep(1.2 * (attempt + 1))  # 1.2s, 2.4s backoff
                continue
            return None
        except Exception:
            return None
    return None


def _call_groq(message: str, history: List[Dict], live_ctx: str) -> Optional[str]:
    """Call Groq (OpenAI-compatible). Fast + reliable free tier. None on failure."""
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        return None

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for turn in history[-6:]:
        role = "user" if turn.get("role") == "user" else "assistant"
        messages.append({"role": role, "content": turn.get("text", "")})
    messages.append({"role": "user", "content": f"{message}\n\n[Live dashboard data: {live_ctx}]"})

    payload = {
        "model": GROQ_MODEL,
        "messages": messages,
        "max_tokens": 400,
        "temperature": 0.4,
    }

    import time
    for attempt in range(2):
        try:
            req = urllib.request.Request(
                GROQ_URL,
                data=json.dumps(payload).encode(),
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}",
                    "User-Agent": "Mozilla/5.0",  # Cloudflare rejects urllib's default UA (403/1010)
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=20) as resp:
                data = json.loads(resp.read().decode())
            return data["choices"][0]["message"]["content"].strip()
        except urllib.error.HTTPError as e:
            if e.code in (503, 429) and attempt < 1:
                time.sleep(1.0)
                continue
            return None
        except Exception:
            return None
    return None


def _rule_based_fallback(message: str, d: Dict) -> str:
    """Used when Gemini is unavailable — keeps things on-topic without erroring."""
    m = message.lower()
    if any(w in m for w in ["water", "irrigat", "deficit"]):
        return OPTION_TREE["Irrigation advice"]["answer"](d)
    if any(w in m for w in ["stress", "dry", "drought", "moisture"]):
        return OPTION_TREE["Moisture stress"]["answer"](d)
    if any(w in m for w in ["crop", "wheat", "rice", "cotton", "ndvi"]):
        return OPTION_TREE["Crop overview"]["answer"](d)
    if any(w in m for w in ["how", "work", "what", "explain"]):
        return OPTION_TREE["How does this work?"]["answer"](d)
    return ("I can help with crop classification, moisture stress, and irrigation "
            "advice for your fields. Try one of the topic buttons, or ask about water needs.")


def handle_chat(message: str, history: List[Dict], summary: Optional[Dict]) -> Dict:
    """
    Main entry. Returns {reply, options}.
    - If `message` matches a structured option → templated answer + follow-ups.
    - Else → Gemini (on-topic), falling back to rule-based if unavailable.
    """
    d = _summarize_live_data(summary)
    msg = (message or "").strip()

    # Greeting / empty → root menu
    if not msg or msg.lower() in ("hi", "hello", "hey", "start", "namaste"):
        node = OPTION_TREE["__root__"]
        return {"reply": "Hello! " + node["prompt"], "options": node["options"]}

    # Exact structured option match → deterministic answer
    node = OPTION_TREE.get(msg)
    if node and "answer" in node:
        return {"reply": node["answer"](d), "options": node.get("options", [])}

    # Free text → Groq first (fast/reliable), then Gemini, then rule-based.
    live_ctx = (f"{d['total']} pixels, crops: {d['crop_summary']}, "
                f"{d['stressed_pct']}% stressed, {d['urgent']} urgent")
    reply = _call_groq(msg, history, live_ctx)
    if reply is None:
        reply = _call_gemini(msg, history, live_ctx)
    if reply is None:
        reply = _rule_based_fallback(msg, d)

    # Always offer a way back into the structured flow
    return {"reply": reply, "options": OPTION_TREE["__root__"]["options"]}