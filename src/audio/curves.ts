/** Equal-power crossfade curve: t in [0,1] → [outGain, inGain]. */
export function fadeCurve(t: number): [number, number] {
  const x = Math.min(1, Math.max(0, t));
  return [Math.cos((x * Math.PI) / 2), Math.sin((x * Math.PI) / 2)];
}

/** YouTube's loudness figure → a gain that brings loud tracks down to the reference. */
export function normalizationGain(loudnessDb: number | undefined): number {
  if (loudnessDb == null || !Number.isFinite(loudnessDb) || loudnessDb <= 0) return 1;
  return Math.max(0.25, Math.pow(10, -loudnessDb / 20));
}
