import {openMuseumEntry} from '../../src/systems/museum-of-bad-physics.js';
import {MAX_GALLERY_FILES, MAX_GALLERY_BYTES, MAX_GALLERY_FILE_BYTES} from '../../src/systems/museum-of-bad-physics.js';

// jsdom omits TextEncoder in some Node builds; the module itself needs it.
if (typeof globalThis.TextEncoder === "undefined") {
  globalThis.TextEncoder ??= (await import("node:util")).TextEncoder;
}

const CURRENT_REVISION = 9;

const tape = JSON.stringify({
  format: "bb-ghost-tape",
  version: 1,
  simTickHz: 120,
  trace: Buffer.from(new Float32Array([0, 1, 0, 2, 3, 0]).buffer).toString("base64"),
  simRevision: 9,
  physicsVersion: 1,
  rulesetId: "sha256:" + "a".repeat(64),
});

const entry = () => openMuseumEntry(tape);

test("exports the gallery size constants", () => {
  expect(typeof MAX_GALLERY_FILES).toBe("number");
  expect(MAX_GALLERY_FILES).toBe(8);
  expect(typeof MAX_GALLERY_BYTES).toBe("number");
  expect(MAX_GALLERY_BYTES).toBe(8 * 1024 * 1024);
  expect(typeof MAX_GALLERY_FILE_BYTES).toBe("number");
  expect(MAX_GALLERY_FILE_BYTES).toBe(2 * 1024 * 1024);
});

test("records the historical, current and future classifications", () => {
  expect(openMuseumEntry(JSON.stringify({...JSON.parse(tape), simRevision: 8}))).toHaveProperty("classification", "historical-claim");
  expect(entry()).toHaveProperty("classification", "current-claim");
  expect(openMuseumEntry(JSON.stringify({...JSON.parse(tape), simRevision: 10}))).toHaveProperty("classification", "future-claim");
});

test("classifies missing or invalid revisions as unknown", () => {
  const base = JSON.parse(tape);
  delete base.simRevision;
  expect(openMuseumEntry(JSON.stringify(base))).toHaveProperty("classification", "unknown");
  expect(openMuseumEntry(JSON.stringify({...base, simRevision: 0}))).toHaveProperty("classification", "unknown");
  expect(openMuseumEntry(JSON.stringify({...base, simRevision: -1}))).toHaveProperty("classification", "unknown");
  expect(openMuseumEntry(JSON.stringify({...base, simRevision: "9"}))).toHaveProperty("classification", "unknown");
  expect(openMuseumEntry(JSON.stringify({...base, simRevision: null}))).toHaveProperty("classification", "unknown");
});

test("rejects non-string, invalid JSON and oversized input", () => {
  expect(() => openMuseumEntry({format: "bb-ghost-tape"})).toThrow(TypeError);
  expect(() => openMuseumEntry(123)).toThrow(TypeError);
  expect(() => openMuseumEntry("")).toThrow(TypeError);
  expect(() => openMuseumEntry("{ not valid JSON")).toThrow(TypeError);
  expect(() => openMuseumEntry(JSON.stringify({format: "bb-ghost-tape"}))).toThrow();
  expect(() => openMuseumEntry(Buffer.alloc(MAX_GALLERY_FILE_BYTES + 1, "x").toString("latin1"))).toThrow(RangeError);
});

test("returns a two-pose trace whose SVG contains an svg element", () => {
  const result = entry();
  expect(result.poseCount).toBe(2);
  expect(typeof result.svg).toBe("string");
  expect(result.svg).toContain("<svg");
  expect(result.svg).toContain("</svg>");
  expect(result.poseCount).toBe(2);
});

test("bounds the title at 80 characters and sanitizes it for HTML", () => {
  const result = entry();
  expect(result.title).toBe("Untitled");
  expect(result.title.length).toBeLessThanOrEqual(80);

  const longName = "A".repeat(120);
  const longResult = openMuseumEntry(tape, {name: longName});
  expect(longResult.title).toBe("A".repeat(80));
  expect(longResult.title.length).toBeLessThanOrEqual(80);

  expect(openMuseumEntry(tape, {name: "<b>Bad</b>"})).toHaveProperty("title", "Untitled");
  expect(openMuseumEntry(tape, {name: '<script>alert("x")</script>'})).toHaveProperty("title", "Untitled");
  expect(openMuseumEntry(tape, {name: "  spaced   out  "})).toHaveProperty("title", "spaced out");
});

test("rejects a ruleset ID that is not a sha256 digest", () => {
  const base = JSON.parse(tape);
  expect(openMuseumEntry(JSON.stringify({...base, rulesetId: null}))).toHaveProperty("rulesetId", null);
  expect(openMuseumEntry(JSON.stringify({...base, rulesetId: "sha256:abc"}))).toHaveProperty("rulesetId", null);
  expect(openMuseumEntry(JSON.stringify({...base, rulesetId: "sha256:" + "a".repeat(63)}))).toHaveProperty("rulesetId", null);
  expect(openMuseumEntry(JSON.stringify({...base, rulesetId: "sha256:" + "a".repeat(65)}))).toHaveProperty("rulesetId", null);
  expect(openMuseumEntry(JSON.stringify({...base, rulesetId: "sha256:" + "g".repeat(64)}))).toHaveProperty("rulesetId", null);
  expect(openMuseumEntry(JSON.stringify({...base, rulesetId: undefined}))).toHaveProperty("rulesetId", null);
});

test("returns a frozen result object", () => {
  const result = entry();
  expect(Object.isFrozen(result)).toBe(true);
  expect(() => { result.title = "Nope"; }).toThrow();
  expect(() => { delete result.poseCount; }).toThrow();
});

test("does not claim an authenticated score for a local tape", () => {
  const result = entry();
  expect(result).not.toHaveProperty("score");
  expect(result).not.toHaveProperty("rank");
  expect(result.commentary).not.toMatch(/\d+|score|rank|leaderboard/);
});