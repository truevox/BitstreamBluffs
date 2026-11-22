import { MAX_STRIP_FILE_BYTES, openDownhillRunTrace } from '../src/systems/downhill-run-strip.js';

const byId = (id) => document.getElementById(id);
const tapeFile = byId('tape'), loadStatus = byId('load-status');
const inspector = byId('inspector'), preview = byId('strip');
const artFrame = byId('run-art-frame'), art = byId('run-art'), artUnavailable = byId('art-unavailable');
const startField = byId('start'), endField = byId('end'), sampleField = byId('sample');
const zoomIn = byId('zoom-in'), zoomOut = byId('zoom-out');
let trace = null, loadGeneration = 0;
let start = 0, end = 1, selected = 0;
let previewUrl, downloadUrl, artUrl;

function releaseUrls() {
  URL.revokeObjectURL(previewUrl);
  URL.revokeObjectURL(downloadUrl);
  URL.revokeObjectURL(artUrl);
  previewUrl = downloadUrl = artUrl = undefined;
}

function svgUrl(svg) {
  return URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
}

function clearInspector() {
  trace = null;
  inspector.hidden = true;
  preview.removeAttribute('src');
  art.removeAttribute('src');
  artFrame.hidden = artUnavailable.hidden = true;
  releaseUrls();
}

function showArt() {
  try {
    // Use SVG only as an image, never as HTML/SVG markup in the inspector.
    artUrl = svgUrl(trace.renderArt());
    art.src = artUrl;
    artFrame.hidden = false;
  } catch {
    // The optional artwork must not disable inspection or the existing export.
    artUnavailable.hidden = false;
  }
}

function updateSample() {
  const { x, y, tick, nominalSeconds } = trace.sample(selected);
  const number = (n) => Object.is(n, -0) ? '-0' : String(n);
  const label = `Sample ${selected + 1} · tick ${tick} · ${nominalSeconds.toFixed(3)} s nominal`;
  sampleField.setAttribute('aria-valuetext', `${selected + 1} of ${trace.count}`);
  byId('pose').textContent = `${label} · X ${number(x)} · Y ${number(y)}`;
  const url = svgUrl(trace.render({ start, end, selected }));
  preview.alt = `Recorded path for samples ${start + 1} to ${end + 1} of ${trace.count}, sampled pose ${selected + 1} marked`;
  preview.src = url;
  URL.revokeObjectURL(previewUrl);
  previewUrl = url;
}

function openSection(first, last) {
  start = first;
  end = last;
  selected = Math.min(end, Math.max(start, selected));
  startField.value = String(start + 1);
  endField.value = String(end + 1);
  sampleField.min = String(start + 1);
  sampleField.max = String(end + 1);
  sampleField.value = String(selected + 1);
  zoomIn.disabled = end - start < 2;
  zoomOut.disabled = start === 0 && end === trace.count - 1;
  byId('section-error').textContent = '';
  byId('window-status').textContent = `Viewing samples ${start + 1}–${end + 1} of ${trace.count}. The highlighted ring marks the selected pose.`;
  updateSample();
}

function showSections() {
  const sections = byId('sections');
  sections.replaceChildren();
  const last = trace.count - 1, size = Math.min(6, last);
  for (let i = 0; i < size; i++) {
    // Neighboring sections share a boundary so no recorded segment is lost.
    const a = Math.floor(i * last / size), b = Math.floor((i + 1) * last / size);
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `Samples ${a + 1}–${b + 1}`;
    button.addEventListener('click', () => openSection(a, b));
    sections.append(button);
  }
}

async function readTape(file) {
  if (file.size > MAX_STRIP_FILE_BYTES) throw new RangeError('Use one GhostTape JSON file no larger than 2 MiB');
  // Decode strictly so corrupted text cannot be silently rewritten on read.
  const data = await file.arrayBuffer().catch(() => { throw new TypeError('Could not open the local file'); });
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(data); }
  catch { throw new TypeError('Expected a UTF-8 GhostTape JSON file'); }
  return openDownhillRunTrace(text);
}

tapeFile.addEventListener('change', async () => {
  const generation = ++loadGeneration;
  const file = tapeFile.files[0];
  clearInspector();
  loadStatus.classList.remove('error');
  loadStatus.textContent = file ? 'Reading local file…' : '';
  if (!file) return;
  try {
    const opened = await readTape(file);
    if (generation !== loadGeneration) return;
    trace = opened;
    selected = 0;
    startField.max = String(trace.count - 1);
    endField.max = String(trace.count);
    showSections();
    openSection(0, trace.count - 1);
    showArt();
    inspector.hidden = false;
    loadStatus.textContent = `Opened ${trace.count} recorded poses. No verification was performed.`;
  } catch (error) {
    if (generation !== loadGeneration) return;
    clearInspector();
    loadStatus.classList.add('error');
    loadStatus.textContent = error.message;
  }
});

byId('section-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!trace) return;
  const a = startField.valueAsNumber - 1, b = endField.valueAsNumber - 1;
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b >= trace.count || a >= b) {
    byId('section-error').textContent = 'Choose a first sample before the last sample.';
    return;
  }
  openSection(a, b);
});

byId('all').addEventListener('click', () => { if (trace) openSection(0, trace.count - 1); });
sampleField.addEventListener('input', () => {
  if (!trace) return;
  selected = sampleField.valueAsNumber - 1;
  updateSample();
});

function zoom(factor) {
  if (!trace) return;
  const count = Math.min(trace.count, Math.max(2, Math.ceil((end - start + 1) * factor)));
  const left = factor < 1 ? start : 0, right = (factor < 1 ? end : trace.count - 1) - count + 1;
  const first = Math.max(left, Math.min(right, selected - Math.floor((count - 1) / 2)));
  openSection(first, first + count - 1);
}
zoomIn.addEventListener('click', () => zoom(0.5));
zoomOut.addEventListener('click', () => zoom(2));

byId('download').addEventListener('click', () => {
  if (!trace) return;
  // Keep exports tied to the section, not the transient inspection cursor.
  URL.revokeObjectURL(downloadUrl);
  downloadUrl = svgUrl(trace.render({ start, end }));
  const link = document.createElement('a');
  link.href = downloadUrl;
  link.download = 'downhill-run-strip.svg';
  link.click();
});
window.addEventListener('pagehide', (event) => { if (!event.persisted) releaseUrls(); });
