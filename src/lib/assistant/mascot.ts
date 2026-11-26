/**
 * AIRMA's face in the chat, as the two numbers her Rive file (static/airma.riv,
 * view model "ViewModel1") reads: `mood` and `mouth`.
 */

/** `mood`: what AIRMA is doing. */
export const Mood = {
  neutral: 0,
  listening: 1,
  thinking: 2,
  processing: 3,
  success: 4,
  confused: 5,
} as const;
export type Mood = (typeof Mood)[keyof typeof Mood];

/** `mouth`: the shape her mouth makes for a sound. */
export const Mouth = { AA: 0, EE: 1, FF: 2, MM: 3, OO: 4 } as const;
export type Mouth = (typeof Mouth)[keyof typeof Mouth];

/** Lips together: her mouth when she isn't speaking. */
export const REST: Mouth = Mouth.MM;

/** The mouth shape for one written character, or null for one that makes no shape (space, punctuation). */
export function visemeOf(ch: string): Mouth | null {
  const c = ch.toLowerCase();
  if ("aáàâä".includes(c)) return Mouth.AA;
  if ("eéèêëiíìîïyjcgkqstxzdnlrh".includes(c)) return Mouth.EE;
  if ("fv".includes(c)) return Mouth.FF;
  if ("mbpw".includes(c)) return Mouth.MM;
  if ("oóòôöuúùûü".includes(c)) return Mouth.OO;
  if (/\d/.test(c)) return Mouth.EE;
  return null;
}

/**
 * The mouth shape for a chunk of newly said text: its most open sound, so a
 * chunk with a vowel opens the mouth, and one with only spaces closes it.
 */
export function visemeOfChunk(chunk: string): Mouth {
  let consonant: Mouth | null = null;
  for (const ch of chunk) {
    const v = visemeOf(ch);
    if (v === Mouth.AA || v === Mouth.OO) return v;
    if (v === Mouth.EE && /[eéèêëiíìîïy]/i.test(ch)) return v;
    if (v !== null && consonant === null) consonant = v;
  }
  return consonant ?? REST;
}

/** What the chat is doing, for `moodOf`. */
export type MoodState = {
  /** A reply is being written. */
  busy: boolean;
  /** The reply being written has text yet. */
  speaking: boolean;
  /** The reply is waiting on a lookup (a tool). */
  lookingUp: boolean;
  /** The latest reply failed, or the visitor said it didn't help. */
  failed: boolean;
  /** A reply finished well a moment ago. */
  justAnswered: boolean;
  /** The visitor is typing or talking a question. */
  hearing: boolean;
};

export function moodOf(s: MoodState): Mood {
  if (s.busy) {
    if (s.lookingUp) return Mood.processing;
    if (!s.speaking) return Mood.thinking;
    return Mood.neutral;
  }
  if (s.hearing) return Mood.listening;
  if (s.failed) return Mood.confused;
  if (s.justAnswered) return Mood.success;
  return Mood.neutral;
}
