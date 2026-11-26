/** A stable 0..1 hash of a string (FNV-1a, 32-bit). Layouts use it so a graph looks the same on every load. */
export function hash01(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 4294967296;
}

/** A seeded 0..1 generator (mulberry32). Layouts never call Math.random. */
export function seeded(seed: number): () => number {
  let a = Math.floor((seed % 1) * 4294967296 + Math.floor(seed) * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
