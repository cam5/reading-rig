// A commonly-cited average adult silent-reading speed. Not tuned to any
// individual — this is an estimate, and the header readout says "left",
// not "exactly".
const WORDS_PER_MINUTE = 200;

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

export function estimateMinutesRemaining(wordCount: number): number {
  return Math.ceil(wordCount / WORDS_PER_MINUTE);
}

export function formatTimeRemaining(minutes: number): string {
  if (minutes < 1) return "less than a minute left";
  if (minutes < 60) return `${minutes} min left`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes === 0
    ? `${hours}h left`
    : `${hours}h ${remainingMinutes}m left`;
}
