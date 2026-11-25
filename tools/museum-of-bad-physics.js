/** Issue #85: browser-local, bounded viewing of validated GhostTape v1 recorded poses. */
import {
  MAX_GALLERY_FILES, MAX_GALLERY_BYTES, MAX_GALLERY_FILE_BYTES, openMuseumEntry,
} from '../src/systems/museum-of-bad-physics.js';

const fileInput = document.getElementById('file-input');
const dropZone = document.getElementById('drop-zone');
const gallery = document.getElementById('gallery');
const status = document.getElementById('status');
const clearAll = document.getElementById('clear-all');

if (!fileInput || !dropZone || !gallery || !status || !clearAll) {
  throw new Error('Museum HTML is missing a required gallery control');
}

const decoder = new TextDecoder('utf-8', { fatal: true });
const items = [];
let generation = 0;
let busy = false;

function announce(message, error = false) {
  status.textContent = message;
  status.classList.toggle('error', error);
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

function metaLine(label, value) {
  const row = element('p', 'metric');
  row.append(element('strong', '', `${label}: `), document.createTextNode(String(value ?? 'Not declared')));
  return row;
}

function destroyItem(item) {
  const index = items.indexOf(item);
  if (index === -1) return;
  items.splice(index, 1);
  URL.revokeObjectURL(item.url);
  item.card.remove();
  if (!busy) announce(`${items.length} local exhibit${items.length === 1 ? '' : 's'} loaded.`);
}

function clearGallery() {
  ++generation;
  busy = false;
  for (const item of items.splice(0)) {
    URL.revokeObjectURL(item.url);
    item.card.remove();
  }
  fileInput.value = '';
  announce('Gallery cleared. Nothing was uploaded or saved.');
}

function addCard(entry) {
  const card = element('article', 'gallery-card');
  const heading = element('h2', '', entry.title);
  const claim = entry.classification === 'unknown'
    ? 'Unknown revision claim'
    : `${entry.classification.replace('-claim', '')} revision claim`;
  const badge = element('p', 'badge', `LOCAL / UNVERIFIED · ${claim}`);
  const image = element('img');
  image.alt = `Static recorded pose path for ${entry.title}; no terrain or replay`;
  image.loading = 'lazy';
  const url = URL.createObjectURL(new Blob([entry.svg], { type: 'image/svg+xml' }));
  image.src = url;
  const figure = element('figure', 'frame');
  figure.append(image, element('figcaption', '', 'Recorded pose path only · not a playable replay'));

  const editArea = element('div', 'museum-edit');
  const titleLabel = element('label', '', 'Exhibit title');
  const titleInput = element('input');
  titleInput.type = 'text';
  titleInput.maxLength = 80;
  titleInput.value = entry.title;
  titleLabel.append(titleInput);
  const commentLabel = element('label', '', 'Curator note (local, unsaved)');
  const note = element('textarea');
  note.maxLength = 500;
  note.rows = 2;
  note.value = entry.commentary;
  commentLabel.append(note);
  titleInput.addEventListener('input', () => {
    heading.textContent = titleInput.value || 'Untitled';
    image.alt = `Static recorded pose path for ${heading.textContent}; no terrain or replay`;
  });
  editArea.append(titleLabel, commentLabel);

  const metrics = element('div', 'museum-metrics');
  metrics.append(
    metaLine('Recorded poses', entry.poseCount),
    metaLine('File bytes', entry.byteLength),
    metaLine('Self-declared sim revision', entry.simRevision),
    metaLine('Self-declared physics version', entry.physicsVersion),
    metaLine('Self-declared ruleset', entry.rulesetId),
  );
  const remove = element('button', 'btn btn-clear', 'Remove exhibit');
  remove.type = 'button';
  remove.setAttribute('aria-label', `Remove ${entry.title}`);
  const item = { card, url, byteLength: entry.byteLength };
  remove.addEventListener('click', () => destroyItem(item));
  card.append(heading, badge, figure, metrics, editArea, remove);
  gallery.append(card);
  items.push(item);
}

async function handleFiles(files) {
  const selection = Array.from(files || []);
  if (!selection.length) return;
  const token = ++generation; // A newer selection supersedes unfinished reads.
  busy = true;
  const errors = [];
  let accepted = 0;
  let count = items.length;
  let total = items.reduce((sum, item) => sum + item.byteLength, 0);
  const allowed = [];
  for (const file of selection) {
    const label = typeof file.name === 'string' ? file.name.slice(0, 80) : 'Unnamed file';
    if (count >= MAX_GALLERY_FILES) { errors.push(`${label}: eight-file gallery limit reached`); continue; }
    if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_GALLERY_FILE_BYTES) {
      errors.push(`${label}: exceeds the 2 MiB per-file limit or is empty`); continue;
    }
    if (total + file.size > MAX_GALLERY_BYTES) { errors.push(`${label}: 8 MiB gallery total exceeded`); continue; }
    allowed.push({ file, label });
    count += 1;
    total += file.size;
  }
  for (const { file, label } of allowed) {
    if (token !== generation) return;
    try {
      const bytes = await file.arrayBuffer();
      if (token !== generation) return;
      if (bytes.byteLength !== file.size || bytes.byteLength > MAX_GALLERY_FILE_BYTES) {
        throw new RangeError('File changed size or exceeded 2 MiB during reading');
      }
      const json = decoder.decode(bytes);
      const entry = openMuseumEntry(json, { name: label });
      if (token !== generation) return;
      if (items.length >= MAX_GALLERY_FILES || items.reduce((sum, it) => sum + it.byteLength, 0) + entry.byteLength > MAX_GALLERY_BYTES) {
        throw new RangeError('Gallery limits reached during reading');
      }
      addCard(entry);
      accepted += 1;
    } catch (error) {
      if (token !== generation) return;
      errors.push(`${label}: ${error?.message || 'Cannot read recording'}`);
    }
  }
  if (token !== generation) return;
  busy = false;
  const summary = `${accepted} file${accepted === 1 ? '' : 's'} added. ${items.length} total. ${errors.length ? errors.join('; ') : 'All local and unverified.'}`;
  announce(summary, errors.length > 0);
}

fileInput.addEventListener('change', () => {
  const files = Array.from(fileInput.files || []);
  fileInput.value = ''; // Permits choosing the same file again.
  void handleFiles(files);
});
dropZone.addEventListener('dragover', event => { event.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', event => {
  event.preventDefault();
  dropZone.classList.remove('drag-over');
  void handleFiles(event.dataTransfer?.files);
});
clearAll.addEventListener('click', clearGallery);
window.addEventListener('pagehide', () => {
  ++generation;
  for (const item of items.splice(0)) URL.revokeObjectURL(item.url);
});
announce('Choose or drop GhostTape v1 JSON files. Nothing leaves this browser.');
