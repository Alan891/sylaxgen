// Deterministic spiral-galaxy layout.
//
// Each top-level folder becomes one spiral arm; bigger folders make longer,
// wider arms. Files run along their arm in path order, so subfolders form
// contiguous segments, and each second-level folder gets its own lane across
// the arm. Files in the repository root form the glowing central bulge.

export const GALAXY_RADIUS = 100;
const CORE_RADIUS = 12;
const TWIST = 3.4; // radians of twist from core to rim

/** Small, fast, seedable PRNG (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a string hash. */
export function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function gaussian(rand) {
  const u = Math.max(rand(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

function vanDerCorput(k) {
  let v = 0;
  let denom = 1;
  for (let x = k; x > 0; x >>= 1) {
    denom *= 2;
    v += (x & 1) / denom;
  }
  return v;
}

function armCurve(arm, u) {
  const r = CORE_RADIUS + u * (arm.length - CORE_RADIUS);
  const theta = arm.angle + TWIST * (r / GALAXY_RADIUS);
  return { r, theta };
}

/**
 * Computes positions (x, y, z per file) and point sizes for the given files
 * (as produced by buildGalaxy, i.e. sorted by path). Returns typed arrays,
 * arm anchors for labels and decorative "dust" that gives the disc its shape.
 */
export function computeLayout(files) {
  const n = files.length;
  const positions = new Float32Array(n * 3);
  const sizes = new Float32Array(n);

  // Group files into arms by top-level directory (files are path-sorted, so
  // each arm's files are already in depth-first order).
  const armMap = new Map();
  const bulge = [];
  for (const f of files) {
    if (f.depth === 0) {
      bulge.push(f);
      continue;
    }
    const top = f.path.slice(0, f.path.indexOf('/'));
    let arm = armMap.get(top);
    if (!arm) armMap.set(top, (arm = { name: top, files: [] }));
    arm.files.push(f);
  }
  const arms = [...armMap.values()].sort((a, b) => b.files.length - a.files.length);
  const maxCount = arms[0]?.files.length || 1;

  // Van der Corput angles: the biggest arms end up opposite each other and
  // every following arm fills the widest remaining gap.
  arms.forEach((arm, k) => {
    arm.angle = vanDerCorput(k) * Math.PI * 2 + 0.3;
    arm.length = GALAXY_RADIUS * (0.3 + 0.7 * Math.sqrt(arm.files.length / maxCount));
  });

  const setSize = (f) => {
    sizes[f.index] = 1 + Math.log2(1 + f.size / 512) * 0.55;
  };

  for (const f of bulge) {
    const rand = rng(hash(f.path));
    const r = Math.abs(gaussian(rand)) * CORE_RADIUS * 0.4;
    const th = rand() * Math.PI * 2;
    const ph = Math.acos(2 * rand() - 1);
    positions.set([r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * 0.55, r * Math.sin(ph) * Math.sin(th)], f.index * 3);
    setSize(f);
  }

  for (const arm of arms) {
    const m = arm.files.length;
    const width = 2.5 + 7 * Math.sqrt(m / maxCount);
    arm.files.forEach((f, i) => {
      const rand = rng(hash(f.path));
      const u = (i + 0.5) / m;
      const { r, theta } = armCurve(arm, u);
      // Each second-level folder gets its own lane inside the arm.
      const rest = f.path.slice(arm.name.length + 1);
      const lane = rest.includes('/') ? (hash(rest.slice(0, rest.indexOf('/'))) % 1000) / 1000 - 0.5 : 0;
      const across = lane * width + gaussian(rand) * width * 0.22 * (0.6 + u);
      const along = gaussian(rand) * 1.2;
      // Offset perpendicular (across) and tangential (along) to the arm.
      const cx = Math.cos(theta);
      const cz = Math.sin(theta);
      const x = cx * (r + across) - cz * along;
      const z = cz * (r + across) + cx * along;
      const y = gaussian(rand) * 3.2 * (1 - 0.7 * (r / GALAXY_RADIUS));
      positions.set([x, y, z], f.index * 3);
      setSize(f);
    });
  }

  const armAnchors = arms.map((arm) => {
    const { r, theta } = armCurve(arm, 0.62);
    return { name: arm.name, count: arm.files.length, position: [Math.cos(theta) * r, 0, Math.sin(theta) * r] };
  });

  return { positions, sizes, arms: armAnchors, dust: makeDust(arms, maxCount, n), radius: GALAXY_RADIUS };
}

/** Faint non-interactive particles tracing the arms and the core. */
function makeDust(arms, maxCount, total) {
  const rand = rng(0x5eed);
  const budget = Math.min(24000, 4000 + total * 2);
  const pts = [];
  const tints = [];
  const coreCount = Math.round(budget * 0.18);
  for (let i = 0; i < coreCount; i++) {
    const r = Math.abs(gaussian(rand)) * CORE_RADIUS * 0.8;
    const th = rand() * Math.PI * 2;
    const ph = Math.acos(2 * rand() - 1);
    pts.push(r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * 0.45, r * Math.sin(ph) * Math.sin(th));
    tints.push(1);
  }
  const armTotal = arms.reduce((s, a) => s + Math.sqrt(a.files.length), 0) || 1;
  for (const arm of arms) {
    const k = Math.round(((budget - coreCount) * Math.sqrt(arm.files.length)) / armTotal);
    const width = 5 + 12 * Math.sqrt(arm.files.length / maxCount);
    for (let i = 0; i < k; i++) {
      const u = Math.pow(rand(), 0.8);
      const { r, theta } = armCurve(arm, u);
      const across = gaussian(rand) * width * (0.5 + u);
      pts.push(
        Math.cos(theta) * (r + across) + gaussian(rand) * 2,
        gaussian(rand) * 2.5 * (1 - 0.6 * (r / GALAXY_RADIUS)),
        Math.sin(theta) * (r + across) + gaussian(rand) * 2,
      );
      tints.push(u < 0.25 ? 1 : 0);
    }
  }
  return { positions: new Float32Array(pts), tints: new Float32Array(tints) };
}
