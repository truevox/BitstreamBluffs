#!/usr/bin/env python3
"""Verify a built public OGG inventory against the tracked Git objects.

Fail closed on sparse checkout omissions, private extras, and substituted
audio. Read-only; no checkout modification or private catalog discovery.
"""
import argparse
import hashlib
import pathlib
import subprocess

p = argparse.ArgumentParser(description=__doc__)
p.add_argument("build", type=pathlib.Path, nargs="?", default=pathlib.Path("dist"))
p.add_argument("--ref", default="HEAD", help="exact source commit or local ref")
a = p.parse_args()
root = pathlib.Path(subprocess.check_output(
    ["git", "rev-parse", "--show-toplevel"], text=True).strip())
revision = subprocess.check_output(
    ["git", "rev-parse", "--verify", a.ref + "^{commit}"], cwd=root, text=True).strip()
algo = subprocess.check_output(
    ["git", "rev-parse", "--show-object-format"], cwd=root, text=True).strip()
raw = subprocess.check_output(
    ["git", "ls-tree", "-rz", "-l", revision, "--", "public/music/packs"], cwd=root)
expected = {}
for item in raw.split(b"\0"):
    if not item:
        continue
    meta, name = item.split(b"\t", 1)
    mode, kind, oid, size = meta.split()
    if name.endswith(b".ogg"):
        assert kind == b"blob" and mode == b"100644", name
        expected[name.decode()[len("public/"):]] = (oid.decode(), int(size))
if not expected:
    raise SystemExit("No tracked public OGG files in selected commit")
build = a.build.resolve()
actual = {str(f.relative_to(build)): f for f in (build / "music/packs").rglob("*.ogg")}
missing, extra = sorted(expected.keys() - actual.keys()), sorted(actual.keys() - expected.keys())
if missing or extra:
    raise SystemExit(f"Public media inventory mismatch: {len(missing)} missing, "
                     f"{len(extra)} extra; examples: {missing[:3]} / {extra[:3]}. "
                     "Check sparse checkout; never substitute a private catalog.")
for name, (oid, size) in expected.items():
    f = actual[name]
    if f.is_symlink() or f.stat().st_size != size:
        raise SystemExit(f"Wrong public media size or symlink: {name}")
    h = hashlib.new(algo)
    h.update(f"blob {size}\0".encode())
    with f.open("rb") as stream:
        header = stream.read(4)
        if header != b"OggS":
            raise SystemExit(f"Not an OGG recording: {name}")
        h.update(header)
        for data in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(data)
    if h.hexdigest() != oid:
        raise SystemExit(f"Public Git object mismatch: {name}")
print(f"PUBLIC_BUILD_MEDIA_EXACT_PASS {revision} {len(expected)} OGG files")
