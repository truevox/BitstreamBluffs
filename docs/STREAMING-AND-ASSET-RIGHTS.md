# Bitstream Bluffs — streamer support and asset release policy

## Owner decisions (Marvin, 2026-11-15)

- The game is intended to ship **free**, with optional donations.
- **Streaming must be supported**, not discouraged. In particular, do not
  force streaming players to mute the soundtrack or sacrifice the game's
  audiovisual experience. Normal monetized streams, clips, VODs, reviews
  and sponsored gameplay are welcome.
- Exactly 30 songs were made via Kie.ai under commercial-use licenses
  asserted by Marvin, and three were made through his Suno Pro account.
  This is owner-provided rights provenance, not an independent sublicense
  audit. Their actual contracts/creation receipts remain the source of truth.
- The SheetSage2/MERT **pretrained weight files** must NEVER enter GitHub
  or the distributed game. They are offline model-inference tools, not
  runtime game assets. Their note predictions informed independent
  synthesis; generated score and art rights are separate questions.
- A blanket CC BY-NC license for the game's media is **not adopted**;
  doing so would not automatically authorize earlier weight usage,
  and commercial-use rights to provider-generated songs do not
  necessarily mean unrestricted authority to sublicense them under CC.

## Public streamer permission statement

The shareable public policy is at:
[streamers.html](../public/streamers.html), and from the
in-game Settings menu via **STREAMING / VIDEO → MUSIC OK**.
This is a link, not a mute toggle; neither source vocals nor
the synthesized instrumental score is disabled by this action.

The developer explicitly welcomes gameplay recordings and monetized
streaming **with in-game music enabled**. The permission is for music
captured as part of gameplay, not a grant to redistribute the isolated
songs as reusable stock audio. If platforms issue Content ID claims,
help streamers dispute/resolve them with the exact song/license
provenance or whitelisting where allowed. Never promise a platform
can't flag something or automatically approve every third-party claim.

Streamer claim reports use the dedicated GitHub issue form at
.github/ISSUE_TEMPLATE/gameplay-music-claim.yml; it requests only
public-safe details (platform, video URL, claimant, song/time and
impact) rather than account credentials.

Do not enroll soundtrack recordings in automated Content ID or
rights-management claiming schemes without a proven whitelist/exemption
path for gameplay uploads. If any third party already manages claims,
document a reliable response/escalation process before launch.

## Enforced publication boundary

The release build uses a **strict public asset allowlist**:
- public/assets/ — static visual/interface assets
- public/docs/ — existing static documentation
- public/favicon.ico
- public/streamers.html — this policy, publicly accessible
- public/music/ — intentionally installed game playback packs only

All local experiment galleries under public/music-audition*,
public/music-full-* and similar names are **NEVER staged into dist**.
The production Vite build must use publicDir=false, with the
release-only stageApprovedPublic copier. Local development still
uses the existing public/ workflow.

Pretrained model weights/checkpoints/caches are ignored by Git, and
a Git-index guard catches even accidentally force-added files.
The production build scans its output for model checkpoint extensions,
unapproved model cache directories, symlinks and private experiment
folders; failures block the build and CI checks on PRs.

Do not remove the production music/catalog.json or overwrite the
private audition labs in the name of cleanup. Source FLAC/WAV masters
remain on CT211; no model checkpoint data belongs in public assets.

## Release checklist

- Confirm the 30 Kie.ai and 3 Suno Pro creation/license records.
- Confirm any provider-managed rights/Content ID settings permit
  gameplay uploads; arrange whitelisting/appeals if needed.
- Keep original 11 One More Run stems and any future comparison runs
  separated, preserving audio provenance.
- Run npm run guard:release and npm run test:release; ship only dist/.
- Verify streamers.html is accessible in the published game.
- Keep any license acknowledgments required by the actual SoundFonts,
  codecs, source music or artwork.
- Do NOT represent the research SheetSage2/MERT weight license as an
  automatic CC BY-NC license on our generated instrumental recordings.
- Don't imply that the game, code, 33 source songs and synthesized music
  are all under one uniform Creative Commons license unless the owner
  explicitly adopts it with verified sublicensing rights.

## GBrain canonical source

projects/truevox-bitstreambluffs/audio-stem-graph
