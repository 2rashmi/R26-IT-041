export function identifyUser(cardId: string): Promise<Record<string, unknown>>;

export function saveOrUpdateProfile(payload: Record<string, unknown>): Promise<{
  action?: string;
  profile?: Record<string, unknown>;
}>;

export function simplifyText(
  cardId: string,
  text: string
): Promise<{ simplified_text: string; source?: string; level?: string; user_code?: string }>;

export function playTTS(payload: Record<string, unknown>): Promise<{
  audio_base64?: string;
}>;

export function completePage(cardId: string): Promise<{
  message?: string;
  audio_base64?: string;
}>;
