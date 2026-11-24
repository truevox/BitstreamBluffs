/** #79: offline inspection of stored GhostTape v1 poses, not a replay or event log. */
import { decodeTrace, GHOST_TAPE_FORMAT } from './ghost/GhostTape.js';
import { renderRunTraceArt } from './run-trace-art.js';

export const MAX_STRIP_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_STRIP_POSES = 32_768;
export const MAX_STRIP_POINTS = 1_024;
export const MAX_STRIP_SVG_BYTES = 48 * 1024;

const COMPONENT_LIMIT = 1e9;
const CHARS_PER_POSE = 16; // v1: three Float32 components, twelve bytes, no base64 padding
const POSE_WIDTH = 3;
const TICKS_PER_SAMPLE = 4;
const TICKS_PER_SECOND = 120;
const PLOT = { x: 64, y: 127, w: 1072, h: 218 };

function readPoses(tape) {
  if (!tape || tape.format !== GHOST_TAPE_FORMAT || tape.version !== 1 ||
      (tape.simTickHz !== undefined && tape.simTickHz !== TICKS_PER_SECOND)) {
    throw new TypeError('Expected a supported GhostTape v1 file');
  }
  const encoded = tape.trace;
  if (typeof encoded !== 'string' || encoded.length < 2 * CHARS_PER_POSE ||
      encoded.length > MAX_STRIP_POSES * CHARS_PER_POSE ||
      encoded.length % CHARS_PER_POSE !== 0 || /[^A-Za-z0-9+/]/.test(encoded)) {
    throw new TypeError('Expected 2 to 32,768 complete GhostTape v1 poses');
  }
  const poses = decodeTrace({ trace: encoded });
  if (poses.length !== POSE_WIDTH * (encoded.length / CHARS_PER_POSE) ||
      !poses.every((v) => Number.isFinite(v) && Math.abs(v) <= COMPONENT_LIMIT)) {
    throw new RangeError('GhostTape poses must be complete, finite and within coordinate limits');
  }
  return poses;
}

function boundsAndIndices(poses, start, end) {
  const size = end - start + 1;
  const exact = size <= MAX_STRIP_POINTS;
  const bucketCount = exact ? size : Math.floor((MAX_STRIP_POINTS - 2) / 4);
  const indices = exact ? [] : [start];
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (let bucket = 0; bucket < bucketCount; bucket++) {
    const a = exact ? start + bucket : start + 1 + Math.floor(bucket * (size - 2) / bucketCount);
    const b = exact ? a + 1 : start + 1 + Math.floor((bucket + 1) * (size - 2) / bucketCount);
    const extremes = [a, a, a, a];
    for (let i = a + 1; i < b; i++) {
      const x = poses[POSE_WIDTH * i], y = poses[POSE_WIDTH * i + 1];
      if (x < poses[POSE_WIDTH * extremes[0]]) extremes[0] = i;
      if (y < poses[POSE_WIDTH * extremes[1] + 1]) extremes[1] = i;
      if (x > poses[POSE_WIDTH * extremes[2]]) extremes[2] = i;
      if (y > poses[POSE_WIDTH * extremes[3] + 1]) extremes[3] = i;
    }
    // Keep extrema in trace order, not X order: a sled can backtrack.
    for (const i of new Set(extremes.sort((left, right) => left - right))) indices.push(i);
  }
  if (!exact) indices.push(end);
  // All X/Y extrema of the exact window occur on retained vertices.
  for (const i of indices) {
    const x = poses[POSE_WIDTH * i], y = poses[POSE_WIDTH * i + 1];
    bounds[0] = Math.min(bounds[0], x);
    bounds[1] = Math.min(bounds[1], y);
    bounds[2] = Math.max(bounds[2], x);
    bounds[3] = Math.max(bounds[3], y);
  }
  return { bounds, indices };
}

function createProjection(poses, [minX, minY, maxX, maxY]) {
  const spanX = maxX - minX, spanY = maxY - minY;
  // Equal units per SVG pixel on both axes, even for a flat or vertical trace.
  const scale = spanX || spanY ? Math.min(PLOT.w / spanX, PLOT.h / spanY) : 1;
  const left = PLOT.x + (PLOT.w - spanX * scale) / 2;
  const top = PLOT.y + (PLOT.h - spanY * scale) / 2;
  const quantize = (v) => Math.round(v * 100) / 100;
  return (index) => [
    quantize(left + (poses[POSE_WIDTH * index] - minX) * scale),
    quantize(top + (poses[POSE_WIDTH * index + 1] - minY) * scale),
  ];
}

function svgFor(poses, count, start, end, selected) {
  const { bounds, indices } = boundsAndIndices(poses, start, end);
  const point = createProjection(poses, bounds);
  const path = indices.map((i, near) => `${near ? 'L' : 'M'}${point(i).join(' ')}`).join(' ');
  const [startX, startY] = point(start), [endX, endY] = point(end);
  const from = start + 1, to = end + 1, size = to - from + 1;
  const [selectedX, selectedY] = selected === null ? [0, 0] : point(selected);
  const cursor = selected === null ? '' :
    `<circle cx="${selectedX}" cy="${selectedY}" r="13" fill="none" stroke="#ffc977" stroke-width="2.4"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="440" viewBox="0 0 1200 440" role="img" aria-labelledby="strip-title strip-desc">
<title id="strip-title">Bitstream Bluffs Downhill Run Strip</title>
<desc id="strip-desc">Recorded sled samples ${from} through ${to} of ${count}. Local, unverified pose trace only; no terrain or event data.</desc>
<defs>
  <linearGradient id="panel" x2="1" y2="1"><stop stop-color="#121e37"/><stop offset="1" stop-color="#1d1531"/></linearGradient>
  <linearGradient id="trace" gradientUnits="userSpaceOnUse" x1="64" x2="1136" y1="0" y2="0"><stop stop-color="#6af4ff"/><stop offset=".5" stop-color="#9ab2ff"/><stop offset="1" stop-color="#fda4f0"/></linearGradient>
  <pattern id="grid" width="46" height="36" patternUnits="userSpaceOnUse"><path d="M46 0H0V36" fill="none" stroke="#344763" stroke-width="1"/></pattern>
</defs>
<rect width="1200" height="440" rx="18" fill="#090f1d"/>
<rect x="13" y="13" width="1174" height="414" rx="15" fill="url(#panel)" stroke="#394864"/>
<rect x="47" y="107" width="1106" height="258" rx="11" fill="#0b1426" stroke="#374968"/>
<rect x="48" y="108" width="1104" height="256" rx="10" fill="url(#grid)"/>
<g font-family="system-ui,sans-serif">
  <text x="49" y="43" fill="#78eafa" font-size="13" font-weight="700" letter-spacing="2.4">BITSTREAM BLUFFS / TRACE V1</text>
  <text x="47" y="79" fill="#f0f5ff" font-weight="750" font-size="34">Downhill Run Strip</text>
  <rect x="910" y="38" width="243" height="37" rx="18.5" fill="#382149" stroke="#e696dc"/>
  <text x="1031.5" y="62" text-anchor="middle" fill="#ffd1f3" font-size="15" font-weight="700" letter-spacing="1.25">LOCAL / UNVERIFIED</text>
  <path d="${path}" fill="none" stroke="url(#trace)" stroke-opacity=".24" stroke-width="10" stroke-linejoin="round" stroke-linecap="round"/>
  <path d="${path}" fill="none" stroke="url(#trace)" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round"/>
  <circle cx="${startX}" cy="${startY}" r="8" fill="none" stroke="#6af4ff" stroke-width="2.6"/>
  <path d="M${endX} ${endY - 5}l5 5-5 5-5-5z" fill="#ffb8ea" stroke="#352044" stroke-width="1"/>
  ${cursor}
  <circle cx="58" cy="388" r="6" fill="none" stroke="#6af4ff" stroke-width="2"/>
  <text x="72" y="393" fill="#daecfc" font-size="14">${start === 0 ? 'Trace start' : 'Section start'} - sample ${from}</text>
  <path d="M299 382l6 6-6 6-6-6z" fill="#ffb8ea"/>
  <text x="315" y="393" fill="#daecfc" font-size="14">${end === count - 1 ? 'Trace end' : 'Section end'} - sample ${to}</text>
  <text x="1152" y="393" text-anchor="end" fill="#dfebfb" font-size="14">${indices.length} of ${size} window poses shown (${count} in trace)</text>
  <text x="49" y="415" fill="#a9b9d8" font-size="12">Recorded path only. Equal X/Y scale; +X right, +Y down. No terrain, events or replay claims.</text>
</g>
</svg>
`;
  if (svg.length > MAX_STRIP_SVG_BYTES) throw new RangeError('Strip SVG exceeded its byte limit');
  return svg;
}

/** Open bounded local JSON. Only validated pose geometry survives this call. */
export function openDownhillRunTrace(json) {
  if (typeof json !== 'string' || json.length > MAX_STRIP_FILE_BYTES ||
      new TextEncoder().encode(json).length > MAX_STRIP_FILE_BYTES) {
    throw new RangeError('Use one GhostTape JSON file no larger than 2 MiB');
  }
  let tape;
  try { tape = JSON.parse(json); }
  catch { throw new TypeError('Could not read GhostTape JSON'); }
  const poses = readPoses(tape), count = poses.length / POSE_WIDTH;
  // Expose neither the tape header nor mutable internal pose storage.
  const valid = (index) => Number.isInteger(index) && index >= 0 && index < count;
  return Object.freeze({
    count,
    // The artwork uses the full validated path, never the current strip window or the tape header.
    renderArt() {
      return renderRunTraceArt(poses);
    },
    sample(index) {
      if (!valid(index)) throw new RangeError('Choose a recorded sample');
      const tick = (index + 1) * TICKS_PER_SAMPLE;
      return { x: poses[POSE_WIDTH * index], y: poses[POSE_WIDTH * index + 1], tick,
        nominalSeconds: tick / TICKS_PER_SECOND };
    },
    render({ start = 0, end = count - 1, selected = null } = {}) {
      if (!valid(start) || !valid(end) || start >= end ||
          (selected !== null && (!valid(selected) || selected < start || selected > end))) {
        throw new RangeError('Choose a section of two or more recorded samples');
      }
      return svgFor(poses, count, start, end, selected);
    },
  });
}
