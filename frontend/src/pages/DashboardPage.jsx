import { useEffect, useRef, useState } from "react";
import ProfileDetails from "../components/ProfileDetails.jsx";
import SectionCard from "../components/SectionCard.jsx";
import StatusMessage from "../components/StatusMessage.jsx";
import {
  completePage,
  identifyUser,
  playTTS,
  saveOrUpdateProfile,
  simplifyText
} from "../services/api.js";
import {
  buildSimplifyInputFromDocument,
  predictDocumentTypeFromFile
} from "../services/documentPredict";

// Pipeline-aligned system TTS (notebook: speak_system_message uses clear tone).
const SYSTEM_VOICE_PROFILE = { voice: "female", pace: "normal", tone: "clear" };

// Spoken on load (notebook read_rfid_card_uid welcome + tap).
const WELCOME_TTS_TEXT = "Welcome to the Smart Voice Assistant Reading System.";
const TAP_RFID_TTS_TEXT = "Please tap your RFID card.";

// After new card / when declining previous prefs — notebook: next step is ask_preferences (one field at a time).
const READING_LEVEL_PROMPT_TTS_TEXT = `
When you are ready, press Set preferences by voice.
The system will ask you one question at a time: first your reading level, then voice, then pace, then tone.
`;

// Notebook ask_preferences — spoken before each microphone listen.
const PREFS_SPEAK_PROMPTS = {
  reading_level:
    "Reading level options very simple,moderate,light. Please say your reading level now.",
  voice: "Voice options male or female.please say your preferred voice now.",
  pace: "Please say your preferred Reading speed now.",
  tone: "Please say your preferred Reading tone now."
};

const PREFS_INVALID_RETRY_TTS = "Invalid input. Please say it again.";
const PREFS_NO_HEARD_TTS = "Sorry, I did not hear anything. Please try again.";

// Spoken when an unknown RFID card is presented for the first time.
const NEW_USER_TTS_TEXT = "New RFID card detected. Registering new user.";

// Notebook run_reading_session_with_rfid page announcements.
const READING_START_BEFORE_PLAY_TTS_TEXT =
  "Reading will start now. Please listen carefully.";

const PAGE_COMPLETE_AUTO_TTS_TEXT =
  "Page complete. Please turn to the next page.";

const SESSION_COMPLETE_TTS_TEXT = "Reading session complete.";

// After “Use these previous preferences?” — before the user answers by voice.
const PLEASE_SAY_YES_OR_NO_TTS = "Please say yes or no.";

// After first-time profile save (POST /profile/upsert action === "created").
const PROFILE_CREATED_TTS_TEXT = "Profile created.";

// Notebook listen_yes_no — match intents by last meaningful phrase in transcript.
const YES_REUSE_NEEDLES = ["yes please", "apply", "yeah", "yep", "sure", "use", "yes"];
const NO_REUSE_NEEDLES = ["do not", "don't", "dont", "nope", "nah", "change", "new", "no"];

function bestMatchEnd(haystack, needles) {
  const h = haystack.toLowerCase();
  let best = -1;
  for (const n of needles) {
    let pos = 0;
    while (pos <= h.length) {
      const i = h.indexOf(n, pos);
      if (i === -1) break;
      best = Math.max(best, i + n.length);
      pos = i + 1;
    }
  }
  return best;
}

function cleanSpokenText(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Notebook READING_LEVEL_ALIASES — returns display form for API. */
function parseReadingLevelOnly(raw) {
  const t = cleanSpokenText(raw);
  if (
    /\bvery\s+simple\b/.test(t) ||
    t.includes("verysimple") ||
    /\bvery\s+easy\b/.test(t) ||
    /\beasy\b/.test(t) ||
    (/\bsimple\b/.test(t) && !/\bmoderate\b/.test(t))
  ) {
    return "Very Simple";
  }
  if (/\blight\b/.test(t) || /\boriginal\b/.test(t) || /close\s+to\s+original/.test(t)) {
    return "Light";
  }
  if (/\bmoderate\b/.test(t) || /\bmedium\b/.test(t)) {
    return "Moderate";
  }
  return null;
}

/** Notebook VOICE_ALIASES */
function parseVoiceOnly(raw) {
  const t = cleanSpokenText(raw);
  if (
    /\bfemale\b/.test(t) ||
    /\bwoman\b/.test(t) ||
    /\bgirl\b/.test(t) ||
    /\blady\b/.test(t) ||
    /\bfemail\b/.test(t)
  ) {
    return "female";
  }
  if (/\bmale\b/.test(t) || /\bmail\b/.test(t) || /\bman\b/.test(t) || /\bboy\b/.test(t)) {
    return "male";
  }
  return null;
}

/** Notebook PACE_ALIASES */
function parsePaceOnly(raw) {
  const t = cleanSpokenText(raw);
  if (/\bslow\b/.test(t) || /\bslowly\b/.test(t)) return "slow";
  if (/\bfast\b/.test(t) || /\bquick\b/.test(t) || /\bquickly\b/.test(t)) return "fast";
  if (/\bnormal\b/.test(t) || /\bmedium\b/.test(t)) return "normal";
  return null;
}

/** Notebook TONE_ALIASES — longest phrase first. */
function parseToneOnly(raw) {
  const t = cleanSpokenText(raw);
  const toneChecks = [
    ["light expressive", /light\s+expressive/],
    ["instructional", /\binstructional\b/],
    ["supportive", /\bsupportive\b/],
    ["informative", /\binformative\b/],
    ["expressive", /\bexpressive\b/],
    ["emotional", /\bemotional\b/],
    ["narrative", /\bnarrative\b/],
    ["engaging", /\bengaging\b/],
    ["playful", /\bplayful\b/],
    ["friendly", /\bfriendly\b/],
    ["formal", /\bformal\b/],
    ["energetic", /\benergetic\b/],
    ["neutral", /\bneutral\b/],
    ["calm", /\bcalm\b/],
    ["clear", /\bclear\b/]
  ];
  for (const [value, re] of toneChecks) {
    if (re.test(t)) return value;
  }
  return null;
}

function DashboardPage() {
  const [cardIdInput, setCardIdInput] = useState("");
  const [activeCardId, setActiveCardId] = useState("");
  const [profile, setProfile] = useState(null);

  const [usePreviousPreferences, setUsePreviousPreferences] = useState(true);
  // Blank defaults for first-time users (no saved profile yet).
  const [readingLevel, setReadingLevel] = useState("");
  const [voice, setVoice] = useState("");
  const [pace, setPace] = useState("");
  const [tone, setTone] = useState("");

  const [readingText, setReadingText] = useState("");
  const [simplifiedText, setSimplifiedText] = useState("");
  const [simplifySource, setSimplifySource] = useState("");

  const [documentImageFile, setDocumentImageFile] = useState(null);
  const [documentImagePreviewUrl, setDocumentImagePreviewUrl] = useState(null);
  const [documentIdentifyResult, setDocumentIdentifyResult] = useState(null);
  const [pipelineStep, setPipelineStep] = useState(null);

  const [loading, setLoading] = useState(false);
  const [prefsVoiceListening, setPrefsVoiceListening] = useState(false);
  const [prefsWizardActive, setPrefsWizardActive] = useState(false);
  const [prefsWizardStep, setPrefsWizardStep] = useState(null);
  const [lastPrefVoiceTranscript, setLastPrefVoiceTranscript] = useState("");
  const [lastPreviousPrefsVoiceTranscript, setLastPreviousPrefsVoiceTranscript] = useState("");
  const reusePrefsVoiceResolvedRef = useRef(false);
  const profileRef = useRef(profile);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  profileRef.current = profile;

  useEffect(() => {
    return () => {
      if (documentImagePreviewUrl) {
        URL.revokeObjectURL(documentImagePreviewUrl);
      }
    };
  }, [documentImagePreviewUrl]);

  function clearMessages() {
    setErrorMessage("");
    setSuccessMessage("");
  }

  /** Notebook listen_until_valid: TTS prompt → one utterance → parse until valid. */
  function listenOnceUtterance() {
    return new Promise((resolve, reject) => {
      const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!Rec) {
        reject(new Error("Voice input is not supported in this browser."));
        return;
      }

      const rec = new Rec();
      rec.lang = "en-US";
      rec.continuous = false;
      rec.interimResults = false;
      rec.maxAlternatives = 1;

      let settled = false;

      rec.onresult = (event) => {
        settled = true;
        const transcript = event.results[0][0].transcript;
        resolve(transcript);
      };

      rec.onerror = () => {
        setPrefsVoiceListening(false);
        if (!settled) {
          settled = true;
          reject(new Error("Voice input failed."));
        }
      };

      rec.onend = () => {
        setPrefsVoiceListening(false);
        if (!settled) {
          settled = true;
          resolve(null);
        }
      };

      try {
        setPrefsVoiceListening(true);
        rec.start();
      } catch {
        setPrefsVoiceListening(false);
        if (!settled) {
          settled = true;
          reject(new Error("Could not start microphone."));
        }
      }
    });
  }

  async function listenUntilValidForField(stepKey, parseFn) {
    for (;;) {
      setPrefsWizardStep(stepKey);
      setErrorMessage("");
      await speakAnnouncement(PREFS_SPEAK_PROMPTS[stepKey], SYSTEM_VOICE_PROFILE);

      let transcript;
      try {
        transcript = await listenOnceUtterance();
      } catch (err) {
        setErrorMessage(err?.message || "Voice input failed. Please try again.");
        continue;
      }

      if (transcript == null || !String(transcript).trim()) {
        await speakAnnouncement(PREFS_NO_HEARD_TTS, SYSTEM_VOICE_PROFILE);
        continue;
      }

      setLastPrefVoiceTranscript(transcript.trim());
      const value = parseFn(transcript);
      if (value) {
        return value;
      }

      await speakAnnouncement(PREFS_INVALID_RETRY_TTS, SYSTEM_VOICE_PROFILE);
    }
  }

  /** Notebook listen_yes_no — last matching phrase wins. */
  function parseYesNoReuseFromTranscript(raw) {
    const t = String(raw || "").toLowerCase();
    const endYes = bestMatchEnd(t, YES_REUSE_NEEDLES);
    const endNo = bestMatchEnd(t, NO_REUSE_NEEDLES);

    if (endYes === -1 && endNo === -1) {
      return { usePrevious: null, ambiguous: false };
    }
    if (endYes > endNo) {
      return { usePrevious: true, ambiguous: false };
    }
    if (endNo > endYes) {
      return { usePrevious: false, ambiguous: false };
    }
    return { usePrevious: null, ambiguous: true };
  }

  function getVoiceProfileForTts() {
    const selectedVoice =
      usePreviousPreferences && profile ? profile.voice : voice || "female";
    const selectedPace =
      usePreviousPreferences && profile ? profile.pace : pace || "normal";
    const selectedTone =
      usePreviousPreferences && profile ? profile.tone : tone || "neutral";
    return {
      voice: selectedVoice,
      pace: selectedPace,
      tone: selectedTone
    };
  }

  function playFromBase64(audioBase64) {
    const audio = new Audio(`data:audio/mp3;base64,${audioBase64}`);
    audio.play();
  }

  // Plays one TTS segment and waits until playback ends. Throws if the API call fails.
  async function playTtsSegment(text, voiceProfile) {
    const v = voiceProfile?.voice || "female";
    const p = voiceProfile?.pace || "slow";
    const t = voiceProfile?.tone || "neutral";
    const result = await playTTS({ text, voice: v, pace: p, tone: t });
    if (result?.audio_base64) {
      await new Promise((resolve) => {
        const audio = new Audio(`data:audio/mp3;base64,${result.audio_base64}`);
        audio.addEventListener("ended", resolve);
        audio.addEventListener("error", resolve);
        audio.play().catch(() => resolve());
      });
    }
  }

  // Plays a TTS announcement and resolves when the audio finishes, so multiple
  // announcements can be chained without overlapping. Silent on failures.
  async function speakAnnouncement(text, voiceProfile) {
    try {
      await playTtsSegment(text, voiceProfile);
    } catch {
      // TTS is optional; ignore failures.
    }
  }

  // Speaks the reading-level prompt (system voice: female / normal / clear).
  function speakReadingLevelPrompt() {
    return speakAnnouncement(READING_LEVEL_PROMPT_TTS_TEXT, SYSTEM_VOICE_PROFILE);
  }

  // Announces a brand-new RFID card and then chains into the reading-level prompt
  // so the two messages play one after the other without overlapping.
  function speakNewUserThenReadingLevelPrompt() {
    queueMicrotask(async () => {
      await speakAnnouncement(NEW_USER_TTS_TEXT, SYSTEM_VOICE_PROFILE);
      await speakAnnouncement(READING_LEVEL_PROMPT_TTS_TEXT, SYSTEM_VOICE_PROFILE);
    });
  }

  // 1) Welcome + tap RFID (notebook read_rfid_card_uid) — system voice, sequential.
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(async () => {
      try {
        await speakAnnouncement(WELCOME_TTS_TEXT, SYSTEM_VOICE_PROFILE);
        if (!cancelled) {
          await speakAnnouncement(TAP_RFID_TTS_TEXT, SYSTEM_VOICE_PROFILE);
        }
      } catch {
        // Non-blocking if backend is offline.
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /** When user chose to keep saved prefs, form is read-only. */
  const preferencesReadOnly = Boolean(profile && usePreviousPreferences);

  // While a profile is loaded for this card, listen for "yes" / "no" (no button). Re-bind only if card_id changes.
  useEffect(() => {
    const cardId = profile?.card_id;
    if (!cardId) {
      reusePrefsVoiceResolvedRef.current = false;
      return undefined;
    }

    let cancelled = false;
    let recognition = null;

    reusePrefsVoiceResolvedRef.current = false;

    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Rec) {
      setErrorMessage("Voice input is not supported in this browser.");
      return undefined;
    }

    const stopRec = () => {
      try {
        recognition?.abort();
      } catch {
        try {
          recognition?.stop();
        } catch {
          /* noop */
        }
      }
      recognition = null;
    };

    const scheduleStart = (delayMs) => {
      if (cancelled || reusePrefsVoiceResolvedRef.current) return;
      window.setTimeout(() => {
        if (cancelled || reusePrefsVoiceResolvedRef.current) return;
        startRec();
      }, delayMs);
    };

    function startRec() {
      if (cancelled || reusePrefsVoiceResolvedRef.current) return;

      stopRec();
      recognition = new Rec();
      recognition.lang = "en-US";
      recognition.continuous = true;
      recognition.interimResults = false;

      recognition.onresult = (event) => {
        if (cancelled || reusePrefsVoiceResolvedRef.current) return;
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const res = event.results[i];
          if (!res.isFinal) continue;
          const transcript = res[0].transcript;
          setLastPreviousPrefsVoiceTranscript(transcript.trim());
          const parsed = parseYesNoReuseFromTranscript(transcript);
          if (parsed.ambiguous) {
            setErrorMessage('Heard both "yes" and "no". Please say only one answer.');
            continue;
          }
          if (parsed.usePrevious === null) {
            continue;
          }
          reusePrefsVoiceResolvedRef.current = true;
          stopRec();
          if (parsed.usePrevious) {
            setUsePreviousPreferences(true);
            queueMicrotask(async () => {
              await speakAnnouncement(
                "Previous preferences will be applied.",
                SYSTEM_VOICE_PROFILE
              );
              setSuccessMessage("Previous preferences will be applied.");
            });
          } else {
            setUsePreviousPreferences(false);
            queueMicrotask(async () => {
              await speakAnnouncement(
                "Okay. Please provide new preferences.",
                SYSTEM_VOICE_PROFILE
              );
              setSuccessMessage("Okay. Please provide new preferences.");
              await speakReadingLevelPrompt();
            });
          }
          return;
        }
      };

      recognition.onerror = () => {
        if (cancelled || reusePrefsVoiceResolvedRef.current) return;
        scheduleStart(250);
      };

      recognition.onend = () => {
        if (cancelled || reusePrefsVoiceResolvedRef.current) return;
        scheduleStart(150);
      };

      try {
        recognition.start();
      } catch {
        scheduleStart(300);
      }
    }

    scheduleStart(0);

    return () => {
      cancelled = true;
      stopRec();
      reusePrefsVoiceResolvedRef.current = false;
    };
  }, [profile?.card_id]);

  async function handleIdentify() {
    clearMessages();
    if (!cardIdInput.trim()) {
      setErrorMessage("Please enter RFID / Card ID (e.g. T001 or CARD001).");
      return;
    }

    try {
      setLoading(true);
      const normalized = cardIdInput.trim().toUpperCase();
      const result = await identifyUser(normalized);
      setActiveCardId(normalized);
      setCardIdInput(normalized);

      if (result.known_user) {
        const p = result.profile;
        setProfile(p);
        setReadingLevel(p.reading_level || p.level || "");
        setVoice(p.voice);
        setPace(p.pace);
        setTone(p.tone);
        setUsePreviousPreferences(true);

        // 3) Notebook get_or_create_user_profile_by_rfid: known card summary, then reuse question.
        const knownMsg = `Known RFID card detected. User code ${p.user_code}. Reading level ${p.reading_level || p.level}. Voice ${p.voice}. Pace ${p.pace}. Tone ${p.tone}.`;
        queueMicrotask(async () => {
          try {
            await speakAnnouncement(knownMsg, SYSTEM_VOICE_PROFILE);
            await speakAnnouncement("Use these previous preferences?", SYSTEM_VOICE_PROFILE);
            await speakAnnouncement(PLEASE_SAY_YES_OR_NO_TTS, SYSTEM_VOICE_PROFILE);
          } catch {
            // TTS failure should not block identification.
          }
        });
      } else {
        setProfile(null);
        setUsePreviousPreferences(false);
        // 2) First-time: empty preference fields.
        setReadingLevel("");
        setVoice("");
        setPace("");
        setTone("");
        setSuccessMessage("New card detected. Please enter preferences and save.");
        // Announce the new card, then prompt for the reading level (sequential).
        speakNewUserThenReadingLevelPrompt();
      }
    } catch (err) {
      setErrorMessage(err?.response?.data?.detail || "Failed to identify user.");
    } finally {
      setLoading(false);
    }
  }

  /** Notebook ask_preferences: reading level → voice → pace → tone, then save. */
  async function startVoicePreferences() {
    clearMessages();
    if (preferencesReadOnly) {
      setErrorMessage("Choose No under previous preferences to set options by voice.");
      return;
    }
    if (!activeCardId) {
      setErrorMessage("Please identify a card before setting preferences.");
      return;
    }

    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Rec) {
      setErrorMessage("Voice input is not supported in this browser.");
      return;
    }

    setPrefsWizardActive(true);
    try {
      const rl = await listenUntilValidForField("reading_level", parseReadingLevelOnly);
      setReadingLevel(rl);
      const v = await listenUntilValidForField("voice", parseVoiceOnly);
      setVoice(v);
      const p = await listenUntilValidForField("pace", parsePaceOnly);
      setPace(p);
      const t = await listenUntilValidForField("tone", parseToneOnly);
      setTone(t);
      setPrefsWizardStep(null);
      await persistPreferencesFromValues(rl, v, p, t);
    } finally {
      setPrefsWizardActive(false);
      setPrefsWizardStep(null);
      setPrefsVoiceListening(false);
    }
  }

  async function persistPreferencesFromValues(rl, v, p, t) {
    clearMessages();
    if (!activeCardId) {
      setErrorMessage("Please identify a card before saving preferences.");
      return;
    }
    if (preferencesReadOnly) {
      setErrorMessage("Preferences are locked while using previous settings. Choose No to edit.");
      return;
    }
    if (!v || !p || !t || !rl) {
      setErrorMessage("Please fill all preference fields (reading level, voice, pace, tone).");
      return;
    }

    try {
      setLoading(true);
      const result = await saveOrUpdateProfile({
        card_id: activeCardId,
        reading_level: rl,
        voice: v,
        pace: p,
        tone: t
      });
      setProfile(result.profile);
      setSuccessMessage(
        result.action === "created"
          ? `Profile created. User code: ${result.profile.user_code}`
          : "Preferences updated successfully."
      );
      if (result.action === "created") {
        await speakAnnouncement(PROFILE_CREATED_TTS_TEXT, SYSTEM_VOICE_PROFILE);
      }
    } catch (err) {
      setErrorMessage(err?.response?.data?.detail || "Failed to save profile.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSavePreferences() {
    await persistPreferencesFromValues(readingLevel, voice, pace, tone);
  }

  function handleDocumentImageChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (documentImagePreviewUrl) {
      URL.revokeObjectURL(documentImagePreviewUrl);
    }
    setDocumentImageFile(file);
    setDocumentImagePreviewUrl(URL.createObjectURL(file));
    setDocumentIdentifyResult(null);
    setSimplifiedText("");
    setSimplifySource("");
    setPipelineStep(null);
  }

  /**
   * Sequential pipeline: document image → classify (identification) → simplify reading text.
   * Simplification runs only after identification completes.
   */
  async function handleIdentifyDocumentThenSimplify() {
    clearMessages();
    if (!activeCardId) {
      setErrorMessage("Please identify a user first.");
      return;
    }
    if (!readingText.trim()) {
      setErrorMessage("Please enter reading text.");
      return;
    }
    if (!documentImageFile) {
      setErrorMessage("Please choose a document page image for identification before simplifying.");
      return;
    }

    setSimplifiedText("");
    setSimplifySource("");
    setDocumentIdentifyResult(null);

    try {
      setPipelineStep("identifying");
      const doc = await predictDocumentTypeFromFile(documentImageFile);
      setDocumentIdentifyResult(doc);

      setPipelineStep("simplifying");
      const composed = buildSimplifyInputFromDocument(doc, readingText);
      const result = await simplifyText(activeCardId, composed);
      setSimplifiedText(result.simplified_text);
      setSimplifySource(result.source);

      const voiceProfile = getVoiceProfileForTts();
      await speakAnnouncement(READING_START_BEFORE_PLAY_TTS_TEXT, SYSTEM_VOICE_PROFILE);
      await speakAnnouncement(result.simplified_text, voiceProfile);
      await speakAnnouncement(PAGE_COMPLETE_AUTO_TTS_TEXT, SYSTEM_VOICE_PROFILE);
      await speakAnnouncement(SESSION_COMPLETE_TTS_TEXT, SYSTEM_VOICE_PROFILE);
    } catch (err) {
      setErrorMessage(
        err?.response?.data?.detail ||
          err?.message ||
          "Pipeline failed (document API or simplification)."
      );
    } finally {
      setPipelineStep(null);
    }
  }

  async function handlePlayTTS() {
    clearMessages();
    const textToSpeak = simplifiedText || readingText;
    if (!textToSpeak.trim()) {
      setErrorMessage("Please provide text first.");
      return;
    }

    const voiceProfile = getVoiceProfileForTts();

    try {
      setLoading(true);
      await playTtsSegment(READING_START_BEFORE_PLAY_TTS_TEXT, SYSTEM_VOICE_PROFILE);
      await playTtsSegment(textToSpeak, voiceProfile);
      setSuccessMessage("TTS started.");
    } catch (err) {
      setErrorMessage(err?.response?.data?.detail || "Failed to play TTS.");
    } finally {
      setLoading(false);
    }
  }

  async function handlePageComplete() {
    clearMessages();
    if (!activeCardId) {
      setErrorMessage("Please identify a card first.");
      return;
    }

    try {
      setLoading(true);
      const result = await completePage(activeCardId);
      playFromBase64(result.audio_base64);
      setSuccessMessage(result.message);
    } catch (err) {
      setErrorMessage(err?.response?.data?.detail || "Failed page completion.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-wrap">
      <header className="top-header">
        <p className="top-header__eyebrow">Smart Voice Assistant</p>
        <h1>Reading System</h1>
      </header>

      {loading && <StatusMessage type="info" message="Loading... please wait." />}
      {pipelineStep === "identifying" && (
        <StatusMessage type="info" message="Identifying document from image… please wait." />
      )}
      {pipelineStep === "simplifying" && (
        <StatusMessage type="info" message="Simplifying text… please wait." />
      )}
      <StatusMessage type="error" message={errorMessage} />
      <StatusMessage type="success" message={successMessage} />

      <main className="cards-grid">
        <SectionCard title="User Identification" className="section-card--accent">
          <label>Enter RFID / Card ID</label>
          <input
            type="text"
            value={cardIdInput}
            onChange={(e) => setCardIdInput(e.target.value)}
            placeholder="T001"
          />
          <button type="button" onClick={handleIdentify} disabled={loading || pipelineStep}>
            Identify User
          </button>
        </SectionCard>

        <SectionCard title="Previous Preferences">
          <ProfileDetails profile={profile} />
          {profile && (
            <div className="inline-options prev-prefs-block">
              <p className="prev-prefs-block__question">Use these previous preferences?</p>
              <p className="hint">
                After the prompts, you will hear &quot;Please say yes or no.&quot; Then say yes, no,
                apply, use, change, or new — your answer is picked up automatically from the microphone.
              </p>
              {lastPreviousPrefsVoiceTranscript ? (
                <p className="hint">
                  <strong>Last heard:</strong> {lastPreviousPrefsVoiceTranscript}
                </p>
              ) : null}
              <p className="hint">
                <strong>Current choice:</strong>{" "}
                {usePreviousPreferences
                  ? "Yes — using saved preferences"
                  : "No — set preferences by voice below"}
              </p>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Preference Update">
          {prefsWizardStep ? (
            <p className="hint prefs-wizard-step" aria-live="polite">
              <strong>Current step:</strong>{" "}
              {prefsWizardStep === "reading_level" && "1 of 4 — Reading level "}
              {prefsWizardStep === "voice" && "2 of 4 — Voice"}
              {prefsWizardStep === "pace" && "3 of 4 — Reading Pace"}
              {prefsWizardStep === "tone" && "4 of 4 — Reading Tone "}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => void startVoicePreferences()}
            disabled={
              loading ||
              pipelineStep ||
              prefsVoiceListening ||
              prefsWizardActive ||
              preferencesReadOnly
            }
          >
            {prefsWizardActive || prefsVoiceListening
              ? prefsWizardStep === "reading_level"
                ? "Listening… reading level"
                : prefsWizardStep === "voice"
                  ? "Listening… voice"
                  : prefsWizardStep === "pace"
                    ? "Listening… pace"
                    : prefsWizardStep === "tone"
                      ? "Listening… tone"
                      : "Starting…"
              : "Set preferences by voice"}
          </button>
          {lastPrefVoiceTranscript ? (
            <p className="hint">
              <strong>Last voice input:</strong> {lastPrefVoiceTranscript}
            </p>
          ) : null}
          <div className="form-grid">
            <div>
              <label>Reading Level</label>
              <select value={readingLevel} disabled>
                {!readingLevel && <option value="">—</option>}
                <option value="Very Simple">Very Simple</option>
                <option value="Moderate">Moderate</option>
                <option value="Light">Light</option>
              </select>
            </div>
            <div>
              <label>Voice</label>
              <select value={voice} disabled>
                {!voice && <option value="">—</option>}
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </div>
            <div>
              <label>Pace</label>
              <select value={pace} disabled>
                {!pace && <option value="">—</option>}
                <option value="slow">Slow</option>
                <option value="normal">Normal</option>
                <option value="fast">Fast</option>
              </select>
            </div>
            <div>
              <label>Tone</label>
              <select value={tone} disabled>
                {!tone && <option value="">—</option>}
                <option value="calm">Calm</option>
                <option value="friendly">Friendly</option>
                <option value="playful">Playful</option>
                <option value="supportive">Supportive</option>
                <option value="neutral">Neutral</option>
                <option value="expressive">Expressive</option>
                <option value="emotional">Emotional</option>
                <option value="narrative">Narrative</option>
                <option value="formal">Formal</option>
                <option value="informative">Informative</option>
                <option value="engaging">Engaging</option>
                <option value="light expressive">Light expressive</option>
                <option value="clear">Clear</option>
                <option value="instructional">Instructional</option>
                <option value="energetic">Energetic</option>
              </select>
            </div>
          </div>
          <button
            type="button"
            onClick={handleSavePreferences}
            disabled={preferencesReadOnly || loading || pipelineStep}
          >
            Save / Update Preferences
          </button>
          <p className="hint">Reading level rule: Very Simple, Moderate, or Light.</p>
        </SectionCard>

        <SectionCard title="Reading Input" className="section-card--wide">
          <label>Document page image (for identification)</label>
          <p className="hint">
            The page photo is classified first; simplification starts only after that step
            finishes.
          </p>
          <input type="file" accept="image/*" onChange={handleDocumentImageChange} />
          {documentImagePreviewUrl ? (
            <div className="preview-thumb" style={{ marginTop: "0.75rem" }}>
              <img
                src={documentImagePreviewUrl}
                alt="Document preview"
                style={{ maxWidth: "100%", maxHeight: "180px", objectFit: "contain" }}
              />
            </div>
          ) : null}

          <label style={{ display: "block", marginTop: "1rem" }}>Original text</label>
          <textarea
            rows="6"
            value={readingText}
            onChange={(e) => setReadingText(e.target.value)}
            placeholder="Paste text to simplify after identification…"
          />

          <button
            type="button"
            onClick={() => void handleIdentifyDocumentThenSimplify()}
            disabled={Boolean(loading || pipelineStep)}
          >
            {pipelineStep === "identifying"
              ? "Identifying document…"
              : pipelineStep === "simplifying"
                ? "Simplifying text…"
                : "Identify document & simplify text"}
          </button>

          {documentIdentifyResult ? (
            <div className="hint" style={{ marginTop: "0.75rem" }} aria-live="polite">
              <strong>Last identification:</strong>{" "}
              {documentIdentifyResult.document_type ?? "—"}
              {documentIdentifyResult.confidence != null
                ? ` (${documentIdentifyResult.confidence}% confidence)`
                : ""}
              {documentIdentifyResult.title ? ` — title: ${documentIdentifyResult.title}` : ""}
            </div>
          ) : null}
        </SectionCard>

        <SectionCard title="Simplified Output" className="section-card--wide">
          <label>Simplified text</label>
          <textarea rows="6" readOnly value={simplifiedText} placeholder="Runs after identification + simplification." />
          {simplifySource ? (
            <p className="hint">
              <strong>Source used:</strong> {simplifySource}
            </p>
          ) : null}
        </SectionCard>

        <SectionCard title="TTS Controls">
          <p>
            Active settings:{" "}
            <strong>
              {usePreviousPreferences && profile ? "Previous profile" : "Current form values"}
            </strong>
          </p>
          <button onClick={handlePlayTTS} disabled={loading || pipelineStep}>
            Play TTS
          </button>
        </SectionCard>

        <SectionCard title="Page Completion">
          <p>Press after finishing one page.</p>
          <button onClick={handlePageComplete} disabled={loading || pipelineStep}>
            Page Completed
          </button>
        </SectionCard>
      </main>
    </div>
  );
}

export default DashboardPage;
