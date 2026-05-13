import base64
import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from profile_db import ProfileDB
from rfid import RFIDConfig, RFIDReader
from simplify import SimplifyConfig, TextSimplifier
from tts import synthesize_speech

# Load .env from project root and backend folder so DATASET_PATH / OPENAI_API_KEY work when
# starting uvicorn from any working directory.
_BACKEND_DIR = Path(__file__).resolve().parent
_PROJECT_ROOT = _BACKEND_DIR.parent


class IdentifyRequest(BaseModel):
    card_id: str = Field(..., min_length=1)


class ProfileUpsertRequest(BaseModel):
    card_id: str = Field(..., min_length=1)
    reading_level: str = Field(..., min_length=1)
    voice: str
    pace: str
    tone: str


class SimplifyRequest(BaseModel):
    card_id: str = Field(..., min_length=1)
    text: str = Field(..., min_length=1)


class TTSRequest(BaseModel):
    text: str = Field(..., min_length=1)
    voice: str
    pace: str
    tone: str


def create_app() -> FastAPI:
    load_dotenv(_PROJECT_ROOT / ".env")
    load_dotenv(_BACKEND_DIR / ".env")

    dataset_path = os.getenv("DATASET_PATH", "")
    model_path = os.getenv("LOCAL_MODEL_PATH", "")
    db_path = os.getenv("PROFILE_DB_PATH", "smart_reading.db")
    openai_model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

    app = FastAPI(title="Smart Reading Assistant API", version="1.0.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    db = ProfileDB(db_path=db_path)
    rfid_reader = RFIDReader(RFIDConfig(mock_mode=True))
    simplifier = TextSimplifier(
        SimplifyConfig(
            dataset_path=dataset_path,
            local_model_path=model_path,
            openai_model=openai_model,
        )
    )

    @app.get("/health")
    def health():
        return {"status": "ok"}

    @app.post("/identify")
    def identify_user(payload: IdentifyRequest):
        card_id = rfid_reader.read_card_id(payload.card_id)
        if not card_id:
            raise HTTPException(status_code=400, detail="Invalid card ID.")

        profile = db.get_by_card_id(card_id)
        if profile:
            return {"known_user": True, "profile": profile.__dict__}
        return {"known_user": False, "card_id": card_id}

    @app.post("/profile/upsert")
    def upsert_profile(payload: ProfileUpsertRequest):
        card_id = rfid_reader.read_card_id(payload.card_id)
        if not card_id:
            raise HTTPException(status_code=400, detail="Invalid card ID.")

        existing = db.get_by_card_id(card_id)
        if existing:
            updated = db.update_profile(
                card_id=card_id,
                reading_level=payload.reading_level,
                voice=payload.voice,
                pace=payload.pace,
                tone=payload.tone,
            )
            return {"action": "updated", "profile": updated.__dict__ if updated else None}

        created = db.create_profile(
            card_id=card_id,
            reading_level=payload.reading_level,
            voice=payload.voice,
            pace=payload.pace,
            tone=payload.tone,
        )
        return {"action": "created", "profile": created.__dict__}

    @app.post("/simplify")
    def simplify_text(payload: SimplifyRequest):
        profile = db.get_by_card_id(payload.card_id.strip().upper())
        if not profile:
            raise HTTPException(status_code=404, detail="User not found for this card ID.")

        simplified_text, source = simplifier.simplify_text(payload.text, profile.level)
        return {
            "simplified_text": simplified_text,
            "source": source,
            "level": profile.level,
            "user_code": profile.user_code,
        }

    @app.post("/tts")
    def tts(payload: TTSRequest):
        audio_bytes = synthesize_speech(
            text=payload.text,
            voice=payload.voice,
            pace=payload.pace,
            tone=payload.tone,
        )
        audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")
        return {"audio_base64": audio_b64}

    @app.post("/page-complete")
    def page_complete(payload: IdentifyRequest):
        message = "Page complete. Please turn to the next page."
        voice = "female"
        pace = "normal"
        tone = "clear"

        audio_bytes = synthesize_speech(
            text=message,
            voice=voice,
            pace=pace,
            tone=tone,
        )
        audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")
        return {"message": message, "audio_base64": audio_b64}

    return app


app = create_app()
