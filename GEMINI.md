# Gemini / code-only snapshot

Generated analysis snapshot only; do not merge it into main or deploy it.
Make changes against main or a normal feature branch.

Source revision: [`9e0258076eab0e8edd8aa1d551090efb3d5a32e3`](https://github.com/truevox/BitstreamBluffs/commit/9e0258076eab0e8edd8aa1d551090efb3d5a32e3).

## Music assets

4,763 audio binaries are intentionally omitted. All original assets remain in the canonical repository. The catalog and pack manifests remain here, but large generated performance timelines are omitted. [STRIPPED_AUDIO_INDEX.txt](STRIPPED_AUDIO_INDEX.txt) lists every omitted audio path.

## Scope

This smaller projection is intended to test Gemini's actual file-content access, not just repository import acceptance. It retains the complete live `src/` tree (except audio), Markdown design/engineering docs, `tests/src/`, music/ruleset tooling, pack manifests and essential root configuration. Legacy code, other tests/tools, lockfile, binary art and generated reports are available from the pinned canonical source. [OMITTED_FILES.txt](OMITTED_FILES.txt) indexes the 518 non-audio exclusions. Never infer that omitted files are absent in main.

- [Music directory at the source revision](https://github.com/truevox/BitstreamBluffs/tree/9e0258076eab0e8edd8aa1d551090efb3d5a32e3/public/music)
- [Music packs and recordings at the source revision](https://github.com/truevox/BitstreamBluffs/tree/9e0258076eab0e8edd8aa1d551090efb3d5a32e3/public/music/packs)
- [Review audio at the source revision](https://github.com/truevox/BitstreamBluffs/tree/9e0258076eab0e8edd8aa1d551090efb3d5a32e3/public/music-review)
- [Current canonical music directory](https://github.com/truevox/BitstreamBluffs/tree/main/public/music)
- [Live deployed music catalog](https://simulate.sledhead.ing/music/catalog.json) (may lag main).

Start with `public/music/catalog.json` and follow each manifest path relative to `public/music/`. Resolve media references according to the manifest and game code.

To retrieve any exact-revision file, append its repository-relative path (including `public/`) to:

```
https://raw.githubusercontent.com/truevox/BitstreamBluffs/9e0258076eab0e8edd8aa1d551090efb3d5a32e3/
```

For deployed media, omit the leading `public/` and use https://simulate.sledhead.ing/ instead. If you cannot fetch or listen to audio, say so rather than inventing observations. Asset-dependent tests require a full source checkout. Missing audio and projection-induced build-identity differences are not production defects.

Gemini imports a point-in-time snapshot; re-import this branch to see later main changes.
