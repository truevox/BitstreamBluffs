#!/usr/bin/env python3
"""Generate a bounded, single-commit code snapshot without changing a checkout."""
import argparse
import os
from pathlib import PurePosixPath
import subprocess
import tempfile

AUDIO = {".ogg", ".mp3", ".wav", ".flac", ".m4a", ".opus", ".aac",
         ".aiff", ".aif", ".wma", ".mid", ".midi"}
MAX_BYTES = 8_000_000
MAX_ENTRIES = 850
TARGET = "refs/heads/gemini"
URL = "https://github.com/truevox/BitstreamBluffs"
MARKER = "Code-only Gemini snapshot of "

def git(*args, env=None, data=None):
    return subprocess.check_output(["git", *args], input=data, env=env)

def remote_tip(ref):
    lines = git("ls-remote", "origin", ref).decode().splitlines()
    return lines[0].split()[0] if lines else ""

def keep_path(raw):
    """Prefer live game source, design docs, core tests and music/ruleset tools."""
    p = PurePosixPath(os.fsdecode(raw))
    name = str(p)
    if p.suffix.lower() in AUDIO:
        return False
    if name.startswith("src/"):
        return True
    if name.startswith(("tests/src/", "tools/music/", "tools/ruleset/", "tools/gemini/")):
        return p.suffix.lower() in {".js", ".mjs", ".cjs", ".py", ".json", ".md", ".ts", ".html", ".css", ".sh"}
    if name.startswith("docs/"):
        return p.suffix.lower() == ".md"
    if name.startswith("public/"):
        return p.suffix.lower() in {".json", ".webmanifest", ".html", ".js", ".css"} and not (name.startswith("public/music/packs/") and p.name.startswith("performance"))
    return name in {"README.md", "AGENTS.md", "CHANGELOG.md", "package.json", "index.html", "vite.config.js", "vitest.config.js", "jest.setup.js", "server.js", "netlify.toml", "common-issues.md", "llm-notes.md", ".gitignore", ".gitattributes", "bsod-qa.html"} or name.startswith(".github/workflows/")

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", default="HEAD")
    parser.add_argument("--publish", action="store_true")
    args = parser.parse_args()
    source = git("rev-parse", args.source + "^{commit}").decode().strip()
    if args.publish and source != remote_tip("refs/heads/main"):
        raise SystemExit("Refusing publication: source is not current main")
    previous = remote_tip(TARGET) if args.publish else ""
    if previous:
        git("fetch", "--no-tags", "--depth=1", "origin", TARGET)
        msg = git("show", "-s", "--format=%s", previous).decode()
        if MARKER not in msg or git("cat-file", "-p", previous).split(b"\n\n", 1)[0].find(b"\nparent ") >= 0:
            raise SystemExit("Refusing to replace a non-generated or non-orphan target")

    with tempfile.TemporaryDirectory(prefix="bsb-gemini-") as temp:
        env = dict(os.environ, GIT_INDEX_FILE=temp + "/index")
        def idx(*a, data=None):
            return git(*a, env=env, data=data)
        idx("read-tree", source)
        paths = idx("ls-files", "-z").split(b"\0")[:-1]
        omitted = sorted(p for p in paths if PurePosixPath(os.fsdecode(p)).suffix.lower() in AUDIO)
        excluded = sorted(p for p in paths if not keep_path(p))
        other = sorted(set(excluded) - set(omitted))
        if excluded:
            idx("update-index", "--force-remove", "-z", "--stdin", data=b"\0".join(excluded)+b"\0")

        def put(path, content):
            sha = idx("hash-object", "-w", "--stdin", data=content.encode("utf-8")).decode().strip()
            idx("update-index", "--add", "--cacheinfo", f"100644,{sha},{path}")

        doc = f"""# Gemini / code-only snapshot

Generated analysis snapshot only; do not merge it into main or deploy it.
Make changes against main or a normal feature branch.

Source revision: [`{source}`]({URL}/commit/{source}).

## Music assets

{len(omitted):,} audio binaries are intentionally omitted. All original assets remain in the canonical repository. The catalog and pack manifests remain here, but large generated performance timelines are omitted. [STRIPPED_AUDIO_INDEX.txt](STRIPPED_AUDIO_INDEX.txt) lists every omitted audio path.

## Scope

This smaller projection is intended to test Gemini's actual file-content access, not just repository import acceptance. It retains the complete live `src/` tree (except audio), Markdown design/engineering docs, `tests/src/`, music/ruleset tooling, pack manifests and essential root configuration. Legacy code, other tests/tools, lockfile, binary art and generated reports are available from the pinned canonical source. [OMITTED_FILES.txt](OMITTED_FILES.txt) indexes the {len(other):,} non-audio exclusions. Never infer that omitted files are absent in main.

- [Music directory at the source revision]({URL}/tree/{source}/public/music)
- [Music packs and recordings at the source revision]({URL}/tree/{source}/public/music/packs)
- [Review audio at the source revision]({URL}/tree/{source}/public/music-review)
- [Current canonical music directory]({URL}/tree/main/public/music)
- [Live deployed music catalog](https://simulate.sledhead.ing/music/catalog.json) (may lag main).

Start with `public/music/catalog.json` and follow each manifest path relative to `public/music/`. Resolve media references according to the manifest and game code.

To retrieve any exact-revision file, append its repository-relative path (including `public/`) to:

```
https://raw.githubusercontent.com/truevox/BitstreamBluffs/{source}/
```

For deployed media, omit the leading `public/` and use https://simulate.sledhead.ing/ instead. If you cannot fetch or listen to audio, say so rather than inventing observations. Asset-dependent tests require a full source checkout. Missing audio and projection-induced build-identity differences are not production defects.

Gemini imports a point-in-time snapshot; re-import this branch to see later main changes.
"""
        pointer = "\n> **Code-only snapshot:** Audio, large performance data and ancillary files are intentionally excluded. See [GEMINI.md](GEMINI.md), [STRIPPED_AUDIO_INDEX.txt](STRIPPED_AUDIO_INDEX.txt) and [OMITTED_FILES.txt](OMITTED_FILES.txt) for source revision, original assets and retrieval instructions. Not a deployment or development target.\n"
        for path in ("README.md", "AGENTS.md"):
            first, sep, rest = git("show", source + ":" + path).decode().partition("\n")
            put(path, first + sep + pointer + rest)
        put("GEMINI.md", doc)
        put("STRIPPED_AUDIO_INDEX.txt", "".join(os.fsdecode(p)+"\n" for p in omitted))
        put("OMITTED_FILES.txt", "".join(os.fsdecode(p)+"\n" for p in other))
        tree = idx("write-tree").decode().strip()
        entries = idx("ls-tree", "-r", "-l", "-z", tree).split(b"\0")[:-1]
        actual = {e.split(b"\t", 1)[1] for e in entries}
        expected = set(paths) - set(excluded) | {b"GEMINI.md", b"STRIPPED_AUDIO_INDEX.txt", b"OMITTED_FILES.txt"}
        if actual != expected:
            raise SystemExit("Snapshot path mismatch")
        total = sum(int(e.split(b"\t", 1)[0].split()[-1]) for e in entries)
        count = len(idx("ls-tree", "-r", "-t", "-z", tree).split(b"\0")) - 1
        if count > MAX_ENTRIES or total > MAX_BYTES:
            raise SystemExit(f"Snapshot exceeds budget: {count} tree entries, {total} bytes")
        if any(PurePosixPath(os.fsdecode(p)).suffix.lower() in AUDIO for p in actual):
            raise SystemExit("Audio leaked into snapshot")
        print(f"Source {source}; tree {tree}; {len(entries)} files, {count} tree entries, {total} bytes; {len(omitted)} audio and {len(other)} other files omitted", flush=True)
        if not args.publish:
            return
        if previous and git("rev-parse", previous+"^{tree}").decode().strip() == tree:
            print("Already current")
            return
        commit = idx("commit-tree", tree, data=f"[skip ci] [skip netlify] {MARKER}{source[:12]}\n".encode()).decode().strip()
        if source != remote_tip("refs/heads/main"):
            raise SystemExit("Main advanced during generation; refusing stale publication")
        idx("push", f"--force-with-lease={TARGET}:{previous}", "origin", commit+":"+TARGET)
        if remote_tip(TARGET) != commit:
            raise SystemExit("Remote verification failed")
        print("Verified published snapshot " + commit)

if __name__ == "__main__":
    main()
