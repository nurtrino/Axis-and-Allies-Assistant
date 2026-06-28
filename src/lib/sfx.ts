/** Play a one-shot sound from /sounds/<name>.mp3 (overlapping plays allowed). */
export function playSound(name: string, volume = 0.45) {
  if (typeof Audio === "undefined") return;
  try {
    const a = new Audio(`/sounds/${name}.mp3`);
    a.volume = volume;
    void a.play().catch(() => {});
  } catch {
    /* autoplay/codec issues are non-fatal */
  }
}
