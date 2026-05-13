import asyncio
from typing import Dict

import edge_tts


VOICE_MAP: Dict[str, str] = {
    "male": "en-US-GuyNeural",
    "female": "en-US-JennyNeural",
}

# Aligned with notebook pipeline (Smart Voice Assistant) pace curve.
PACE_MAP: Dict[str, str] = {
    "slow": "-45%",
    "normal": "-20%",
    "fast": "+0%",
}

# Pitch + volume per tone (notebook TONE_MAP). Unknown tone → neutral.
TONE_STYLE: Dict[str, Dict[str, str]] = {
    "calm": {"pitch": "-5Hz", "volume": "-5%"},
    "friendly": {"pitch": "+10Hz", "volume": "+0%"},
    "playful": {"pitch": "+25Hz", "volume": "+5%"},
    "expressive": {"pitch": "+15Hz", "volume": "+5%"},
    "emotional": {"pitch": "+18Hz", "volume": "+0%"},
    "narrative": {"pitch": "+5Hz", "volume": "+0%"},
    "neutral": {"pitch": "+0Hz", "volume": "+0%"},
    "formal": {"pitch": "-10Hz", "volume": "+0%"},
    "informative": {"pitch": "-2Hz", "volume": "+0%"},
    "engaging": {"pitch": "+12Hz", "volume": "+5%"},
    "light expressive": {"pitch": "+8Hz", "volume": "+0%"},
    "clear": {"pitch": "+0Hz", "volume": "+5%"},
    "instructional": {"pitch": "-5Hz", "volume": "+0%"},
    "supportive": {"pitch": "+8Hz", "volume": "+0%"},
    "energetic": {"pitch": "+20Hz", "volume": "+10%"},
}


async def _synthesize_async(text: str, voice: str, pace: str, tone: str) -> bytes:
    selected_voice = VOICE_MAP.get(voice, VOICE_MAP["female"])
    selected_rate = PACE_MAP.get(pace, PACE_MAP["normal"])
    tone_key = (tone or "").strip().lower()
    style = TONE_STYLE.get(tone_key, TONE_STYLE["neutral"])
    selected_pitch = style["pitch"]
    selected_volume = style["volume"]

    communicate = edge_tts.Communicate(
        text=text,
        voice=selected_voice,
        rate=selected_rate,
        volume=selected_volume,
        pitch=selected_pitch,
    )
    audio_chunks = []
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            audio_chunks.append(chunk["data"])
    return b"".join(audio_chunks)


def synthesize_speech(text: str, voice: str, pace: str, tone: str) -> bytes:
    """Return MP3 bytes generated locally using edge-tts."""
    return asyncio.run(_synthesize_async(text, voice, pace, tone))
