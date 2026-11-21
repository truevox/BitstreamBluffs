/** #87: standalone, deliberately unverified artwork from decoded ghost poses. */
export const RUN_TRACE_ART_VERSION = 1;
export const MAX_ART_POSES = 32_768;
export const MAX_ART_SVG_BYTES = 8_192;

const POSE_WIDTH = 3;
const ART_POINTS = 64;
const GRID = 4;
const MAX_COMPONENT_MAGNITUDE = 1e9;

function boundsOf(poses) {
  if (!(poses instanceof Float32Array) || poses.length % POSE_WIDTH !== 0) {
    throw new TypeError('Expected complete Float32 ghost poses');
  }
  const count = poses.length / POSE_WIDTH;
  if (count < 2 || count > MAX_ART_POSES) {
    throw new RangeError(`Trace art needs 2 to ${MAX_ART_POSES} poses`);
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  // Check the entire trace, not just rendered samples: invalid values must not
  // be hidden by the resampler or reach an SVG attribute.
  for (let i = 0; i < poses.length; i += POSE_WIDTH) {
    const x = poses[i], y = poses[i + 1], angle = poses[i + 2];
    if (![x, y, angle].every((v) => Number.isFinite(v) && Math.abs(v) <= MAX_COMPONENT_MAGNITUDE)) {
      throw new RangeError('Ghost pose components must be finite and within art limits');
    }
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { count, minX, maxX, minY, maxY };
}

function project(value, low, high, from, to) {
  const unit = low === high ? 0.5 : Math.max(0, Math.min(1, (value - low) / (high - low)));
  return GRID * Math.round((from + (to - from) * unit) / GRID);
}

function composePath(poses) {
  const { count, minX, maxX, minY, maxY } = boundsOf(poses);
  const points = [];
  // Fixed size and endpoint-anchored interpolation avoid leaking the exact
  // source sample count. Each axis loses both world origin and absolute scale.
  for (let i = 0; i < ART_POINTS; i++) {
    const sample = i * (count - 1) / (ART_POINTS - 1);
    const lower = Math.floor(sample);
    const mix = sample - lower;
    const a = lower * POSE_WIDTH, b = Math.min(lower + 1, count - 1) * POSE_WIDTH;
    const x = poses[a] + (poses[b] - poses[a]) * mix;
    const y = poses[a + 1] + (poses[b + 1] - poses[a + 1]) * mix;
    points.push([project(x, minX, maxX, 120, 840), project(y, minY, maxY, 268, 456)]);
  }
  const path = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ');
  return { path, first: points[0], last: points.at(-1) };
}

/**
 * @param {Float32Array} poses Decoded GhostTape v1 x/y/angle triples.
 * @returns {string} Standalone ASCII SVG. No tape header or user strings accepted.
 */
export function renderRunTraceArt(poses) {
  const { path, first, last } = composePath(poses);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="620" viewBox="0 0 960 620" role="img" aria-labelledby="art-title art-desc">
<title id="art-title">Bitstream Bluffs Run DNA: Local / Unverified</title>
<desc id="art-desc">An abstract neon motif from a recorded sled path. It is local artwork, not a verified result.</desc>
<defs>
  <linearGradient id="sky" x1="0" y1="0" x2="1" y2="1">
    <stop stop-color="#141a37"/><stop offset="0.55" stop-color="#100d29"/><stop offset="1" stop-color="#290d2b"/>
  </linearGradient>
  <linearGradient id="ion" gradientUnits="userSpaceOnUse" x1="120" x2="840" y1="268" y2="268">
    <stop stop-color="#64faff"/><stop offset="0.5" stop-color="#a2a4ff"/><stop offset="1" stop-color="#ff7bc7"/>
  </linearGradient>
  <radialGradient id="halo">
    <stop stop-color="#763c9f" stop-opacity=".34"/><stop offset="1" stop-color="#763c9f" stop-opacity="0"/>
  </radialGradient>
</defs>
<rect width="960" height="620" fill="#080914"/>
<rect x="18" y="18" width="924" height="584" rx="32" fill="url(#sky)" stroke="#464463" stroke-width="2"/>
<ellipse cx="700" cy="310" rx="308" ry="270" fill="url(#halo)"/>
<path d="M64 188H896 M64 540H896" stroke="#434564" fill="none"/>
<g font-family="system-ui,sans-serif">
  <circle cx="73" cy="64" r="5" fill="#64faff"/>
  <text x="89" y="69" fill="#bdcdf5" font-size="15" font-weight="700" letter-spacing="3">BITSTREAM BLUFFS</text>
  <text x="66" y="143" fill="#f3f2ff" font-size="71" font-weight="800" letter-spacing="-2">RUN DNA</text>
  <text x="72" y="170" fill="#96a5d1" font-size="13" font-weight="600" letter-spacing="3">SLED PATH STUDY / ART V${RUN_TRACE_ART_VERSION}</text>
  <rect x="668" y="49" width="228" height="38" rx="19" fill="#261637" stroke="#f290cd"/>
  <circle cx="688" cy="68" r="4" fill="#ff7bc7"/>
  <text x="703" y="74" fill="#ffd1ee" font-size="15" font-weight="750" letter-spacing="1.3">LOCAL / UNVERIFIED</text>
  <rect x="64" y="209" width="832" height="309" rx="20" fill="#0c1026" fill-opacity=".9" stroke="#464463"/>
  <path d="M104 270H856 M104 316H856 M104 362H856 M104 408H856 M104 454H856 M120 255V470 M240 255V470 M360 255V470 M480 255V470 M600 255V470 M720 255V470 M840 255V470" stroke="#363854" stroke-opacity=".67" fill="none"/>
  <path d="M104 247H113V238 M847 238V247H856 M104 477H113V486 M847 486V477H856" stroke="#626483" fill="none"/>
  <text x="122" y="240" fill="#929cbd" font-size="12" font-weight="600" letter-spacing="2">NORMALIZED TRACE</text>
  <path d="${path}" fill="none" stroke="url(#ion)" stroke-width="24" stroke-opacity=".09" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="${path}" fill="none" stroke="url(#ion)" stroke-width="11" stroke-opacity=".22" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="${path}" fill="none" stroke="url(#ion)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="${first[0]}" cy="${first[1]}" r="6" fill="#141932" stroke="#64faff" stroke-width="2"/>
  <circle cx="${last[0]}" cy="${last[1]}" r="5" fill="#ff7bc7" stroke="#ffd1ee" stroke-width="2"/>
  <path d="M104 499H856" stroke="url(#ion)" stroke-opacity=".38"/>
  <text x="65" y="571" fill="#bdc7e7" font-size="13" font-weight="700" letter-spacing="2">RECORDED PATH / ARTWORK ONLY</text>
  <text x="894" y="571" text-anchor="end" fill="#a4adcc" font-size="13" font-weight="600" letter-spacing="2">V${RUN_TRACE_ART_VERSION} / NO ATTESTATION</text>
</g>
</svg>
`;
  if (svg.length > MAX_ART_SVG_BYTES) throw new RangeError('Trace artwork exceeded its byte limit');
  return svg;
}
