import axios from "axios";

// Change this in .env as needed:
// VITE_API_BASE_URL=http://127.0.0.1:8000
const BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

const client = axios.create({
  baseURL: BASE_URL,
  timeout: 30000
});

export async function identifyUser(cardId) {
  const res = await client.post("/identify", { card_id: cardId });
  return res.data;
}

export async function saveOrUpdateProfile(payload) {
  const res = await client.post("/profile/upsert", payload);
  return res.data;
}

export async function simplifyText(cardId, text) {
  const res = await client.post("/simplify", { card_id: cardId, text });
  return res.data;
}

export async function playTTS(payload) {
  const res = await client.post("/tts", payload);
  return res.data;
}

export async function completePage(cardId) {
  const res = await client.post("/page-complete", { card_id: cardId });
  return res.data;
}
