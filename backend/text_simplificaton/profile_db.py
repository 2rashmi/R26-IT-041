import sqlite3
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional


@dataclass
class UserProfile:
    user_code: str
    card_id: str
    reading_level: str
    level: str
    voice: str
    pace: str
    tone: str
    created_at: str
    updated_at: str


class ProfileDB:
    """SQLite helper for user profile and RFID/card mapping."""

    def __init__(self, db_path: str = "smart_reading.db") -> None:
        self.db_path = Path(db_path)
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS user_profiles (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_code TEXT UNIQUE NOT NULL,
                    card_id TEXT UNIQUE NOT NULL,
                    reading_level TEXT NOT NULL,
                    level TEXT NOT NULL,
                    voice TEXT NOT NULL,
                    pace TEXT NOT NULL,
                    tone TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            cols = {row["name"] for row in conn.execute("PRAGMA table_info(user_profiles)").fetchall()}
            # Migrate older DBs that still have the legacy `age` column.
            # SQLite can't drop columns directly on old versions, so we rebuild the table.
            if "age" in cols:
                if "reading_level" not in cols:
                    conn.execute(
                        "ALTER TABLE user_profiles ADD COLUMN reading_level TEXT NOT NULL DEFAULT 'Moderate'"
                    )
                conn.executescript(
                    """
                    CREATE TABLE user_profiles_new (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_code TEXT UNIQUE NOT NULL,
                        card_id TEXT UNIQUE NOT NULL,
                        reading_level TEXT NOT NULL,
                        level TEXT NOT NULL,
                        voice TEXT NOT NULL,
                        pace TEXT NOT NULL,
                        tone TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    );
                    INSERT INTO user_profiles_new
                        (id, user_code, card_id, reading_level, level, voice, pace, tone, created_at, updated_at)
                    SELECT id, user_code, card_id, reading_level, level, voice, pace, tone, created_at, updated_at
                    FROM user_profiles;
                    DROP TABLE user_profiles;
                    ALTER TABLE user_profiles_new RENAME TO user_profiles;
                    """
                )
            elif "reading_level" not in cols:
                conn.execute(
                    "ALTER TABLE user_profiles ADD COLUMN reading_level TEXT NOT NULL DEFAULT 'Moderate'"
                )
            conn.commit()

    @staticmethod
    def normalize_reading_level(value: str) -> str:
        """Return canonical display form: 'Very Simple' | 'Moderate' | 'Light'."""
        s = str(value or "").strip().lower()
        if s in ("very simple", "very_simple", "verysimple", "simple"):
            return "Very Simple"
        if s in ("light",):
            return "Light"
        return "Moderate"

    def _next_user_code(self) -> str:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT user_code FROM user_profiles ORDER BY id DESC LIMIT 1"
            ).fetchone()
            if not row:
                return "U001"

            latest_code = row["user_code"]
            latest_num = int(latest_code.replace("U", ""))
            return f"U{latest_num + 1:03d}"

    def get_by_card_id(self, card_id: str) -> Optional[UserProfile]:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM user_profiles WHERE card_id = ?",
                (card_id,),
            ).fetchone()
            if not row:
                return None
            row_dict = dict(row)
            allowed_fields = {
                "user_code",
                "card_id",
                "reading_level",
                "level",
                "voice",
                "pace",
                "tone",
                "created_at",
                "updated_at",
            }
            clean_row = {key: row_dict[key] for key in allowed_fields if key in row_dict}
            return UserProfile(**clean_row)

    def create_profile(
        self,
        card_id: str,
        reading_level: str,
        voice: str,
        pace: str,
        tone: str,
    ) -> UserProfile:
        now = datetime.utcnow().isoformat()
        user_code = self._next_user_code()
        canonical = self.normalize_reading_level(reading_level)

        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO user_profiles (
                    user_code, card_id, reading_level, level, voice, pace, tone, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (user_code, card_id, canonical, canonical, voice, pace, tone, now, now),
            )
            conn.commit()

        return self.get_by_card_id(card_id)  # type: ignore[return-value]

    def update_profile(
        self,
        card_id: str,
        reading_level: str,
        voice: str,
        pace: str,
        tone: str,
    ) -> Optional[UserProfile]:
        now = datetime.utcnow().isoformat()
        canonical = self.normalize_reading_level(reading_level)

        with self._connect() as conn:
            conn.execute(
                """
                UPDATE user_profiles
                SET reading_level = ?, level = ?, voice = ?, pace = ?, tone = ?, updated_at = ?
                WHERE card_id = ?
                """,
                (canonical, canonical, voice, pace, tone, now, card_id),
            )
            conn.commit()

        return self.get_by_card_id(card_id)
