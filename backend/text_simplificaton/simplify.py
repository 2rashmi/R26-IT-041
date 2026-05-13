import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Tuple

import pandas as pd
from openai import OpenAI


@dataclass
class SimplifyConfig:
    dataset_path: str
    local_model_path: str
    # Chat Completions model (override with env OPENAI_MODEL in api.py).
    openai_model: str = "gpt-4o-mini"


class TextSimplifier:
    """
    Simplification pipeline (current product behavior):
    1) exact dataset lookup (wide or long CSV format)
    2) OpenAI API when the text is not in the dataset

    Local model helpers remain for compatibility but are not used in simplify_text().
    """

    def __init__(self, config: SimplifyConfig) -> None:
        self.config = config
        # _dataset_format is "wide", "long", or None — see _load_dataset()
        self.dataset_df, self._dataset_format = self._load_dataset(config.dataset_path)
        self.local_pipeline = self._load_local_model(config.local_model_path)

    @staticmethod
    def _normalize_text(text: str) -> str:
        return " ".join(text.strip().lower().split())

    @staticmethod
    def _strip_column_names(df: pd.DataFrame) -> pd.DataFrame:
        """Remove BOM / stray whitespace from CSV header names."""
        df = df.copy()
        df.columns = [str(c).strip().lstrip("\ufeff").strip() for c in df.columns]
        return df

    @staticmethod
    def _users_level_to_internal(cell) -> Optional[str]:
        """Map dataset reading-level cell to very simple | moderate | light (case-insensitive)."""
        s = str(cell).strip().lower()
        if s in ("very simple", "very_simple", "verysimple", "simple", "child", "children"):
            return "very simple"
        if s in ("moderate", "intermediate", "medium", "teen", "middle"):
            return "moderate"
        if s in ("light", "adult", "adults"):
            return "light"
        return None

    def _standardize_columns(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Normalize common header variants so wide/long detection works
        (case differences, BOM, 'Input' vs 'original_text').
        """
        df = self._strip_column_names(df)
        lower_to_actual = {c.lower(): c for c in df.columns}

        # Long format (current): Input, Reading_level, Output
        # Also accept legacy "Users Level" for back-compat.
        level_col_key = None
        for cand in ("reading_level", "reading level", "users level", "user level", "level"):
            if cand in lower_to_actual:
                level_col_key = cand
                break
        if "input" in lower_to_actual and "output" in lower_to_actual and level_col_key:
            return df.rename(
                columns={
                    lower_to_actual["input"]: "Input",
                    lower_to_actual[level_col_key]: "Reading_level",
                    lower_to_actual["output"]: "Output",
                }
            )

        # Wide format (legacy): three level columns + one source text column
        level_keys = ("child", "intermediate", "adult")
        if all(k in lower_to_actual for k in level_keys):
            renames = {
                lower_to_actual["child"]: "child",
                lower_to_actual["intermediate"]: "intermediate",
                lower_to_actual["adult"]: "adult",
            }
            orig_key = None
            for cand in ("original_text", "input", "original", "text", "source"):
                if cand in lower_to_actual:
                    orig_key = lower_to_actual[cand]
                    break
            if orig_key:
                renames[orig_key] = "original_text"
            return df.rename(columns=renames)

        return df

    def _load_dataset(self, path: str) -> Tuple[Optional[pd.DataFrame], Optional[str]]:
        """
        Load CSV in one of two shapes:
        - Wide: original_text, child, intermediate, adult
        - Long (RFID.ipynb style): Input, Users Level, Output
        Returns (dataframe, format_label) or (None, None).
        """
        if not path:
            return None, None
        file_path = Path(path)
        if not file_path.exists():
            return None, None

        df = None
        # utf-8-sig strips BOM; cp1252 matches many Windows Excel exports.
        for encoding in ("utf-8-sig", "utf-8", "cp1252"):
            try:
                df = pd.read_csv(file_path, encoding=encoding)
                break
            except (UnicodeDecodeError, UnicodeError):
                continue
        if df is None:
            try:
                df = pd.read_csv(file_path)
            except Exception:
                return None, None

        df = self._standardize_columns(df)
        cols = set(df.columns)

        # Wide format (legacy: one row per original text, columns per level)
        required_wide = {"original_text", "child", "intermediate", "adult"}
        if required_wide.issubset(cols):
            df = df.copy()
            df["normalized_original"] = df["original_text"].fillna("").apply(self._normalize_text)
            return df, "wide"

        # Long format: Input + Reading_level + Output (current dataset)
        required_long = {"Input", "Reading_level", "Output"}
        if required_long.issubset(cols):
            df = df.copy()
            df["normalized_input"] = df["Input"].fillna("").apply(self._normalize_text)
            # Case-insensitive level matching for lookup
            df["_level_internal"] = df["Reading_level"].apply(self._users_level_to_internal)
            return df, "long"

        return None, None

    def _load_local_model(self, model_path: str):
        if not model_path:
            return None
        if not Path(model_path).exists():
            return None

        try:
            from transformers import pipeline

            return pipeline("text2text-generation", model=model_path, tokenizer=model_path)
        except Exception:
            return None

    def _dataset_lookup(self, text: str, level: str) -> Optional[str]:
        """Return simplified text from dataset if input matches exactly for this level."""
        if self.dataset_df is None or self._dataset_format is None:
            return None
        norm = self._normalize_text(text)
        # Normalize incoming level the same way we normalize dataset cells.
        internal = self._users_level_to_internal(level) or "moderate"

        if self._dataset_format == "wide":
            # Legacy wide-format CSV: map new reading levels to old age-buckets.
            wide_map = {"very simple": "child", "moderate": "intermediate", "light": "adult"}
            level_col = wide_map.get(internal, "intermediate")
            rows = self.dataset_df[self.dataset_df["normalized_original"] == norm]
            if rows.empty:
                return None
            value = rows.iloc[0].get(level_col)
            if pd.isna(value):
                return None
            return str(value).strip()

        if self._dataset_format == "long":
            mask_input = self.dataset_df["normalized_input"] == norm
            mask_level = self.dataset_df["_level_internal"] == internal
            rows = self.dataset_df[mask_input & mask_level]
            if rows.empty:
                return None
            value = rows.iloc[0].get("Output")
            if pd.isna(value):
                return None
            return str(value).strip()

        return None

    def _local_model_simplify(self, text: str, level: str) -> Optional[str]:
        if self.local_pipeline is None:
            return None
        try:
            prompt = f"Simplify for {level} level: {text}"
            result = self.local_pipeline(prompt, max_length=256, do_sample=False)
            if not result:
                return None
            simplified = result[0].get("generated_text", "").strip()
            return simplified or None
        except Exception:
            return None

    def _openai_fallback(self, text: str, level: str) -> Optional[str]:
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            return None

        client = OpenAI(api_key=api_key)
        # Map internal level to a clear instruction for the model.
        internal = self._users_level_to_internal(level) or "moderate"
        level_instructions = {
            "very simple": (
                "Very Simple: rewrite for a young child. Use very short sentences and "
                "the most basic everyday words. Avoid idioms, slang and complex grammar."
            ),
            "moderate": (
                "Moderate: rewrite in plain, everyday English. Short clear sentences, "
                "common vocabulary, no slang or jargon."
            ),
            "light": (
                "Light: keep most of the original wording and structure. Only lightly "
                "smooth out slang or awkward phrasing while preserving the original tone."
            ),
        }
        guidance = level_instructions.get(internal, level_instructions["moderate"])

        system_prompt = (
            "You simplify text for visually impaired readers. "
            "Keep meaning accurate. Use short, clear sentences."
        )
        user_prompt = (
            f"Reading level: {level}\n"
            f"{guidance}\n\n"
            f"Original text:\n{text}\n\n"
            "Return only the simplified text."
        )

        # Prefer Chat Completions — works with standard API keys and most chat models.
        preferred = (self.config.openai_model or "").strip()
        fallback_models = ("gpt-4o-mini", "gpt-4o", "gpt-3.5-turbo")
        models_to_try = []
        if preferred:
            models_to_try.append(preferred)
        for m in fallback_models:
            if m not in models_to_try:
                models_to_try.append(m)

        for model_name in models_to_try:
            try:
                response = client.chat.completions.create(
                    model=model_name,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    temperature=0.2,
                )
                choice = response.choices[0].message.content if response.choices else None
                if choice and str(choice).strip():
                    return str(choice).strip()
            except Exception:
                continue

        # Secondary: Responses API (only if Chat Completions all failed)
        try:
            response = client.responses.create(
                model=models_to_try[0] if models_to_try else "gpt-4o-mini",
                input=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.2,
            )
            if response.output_text and response.output_text.strip():
                return response.output_text.strip()
        except Exception:
            pass

        return None

    def simplify_text(self, text: str, level: str) -> Tuple[str, str]:
        # 1) Dataset only when a matching row exists — never call OpenAI in that case.
        dataset_result = self._dataset_lookup(text, level)
        if dataset_result:
            return dataset_result, "dataset lookup"

        # 2) Not in dataset: use OpenAI only (local model intentionally skipped here).
        openai_result = self._openai_fallback(text, level)
        if openai_result:
            return openai_result, "OpenAI API"

        return text, "no simplification source available"
