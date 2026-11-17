# Bitstream Bluffs — Pope Other note-by-note audit and missed re-attacks (V7)

**Status: private, UNAPPROVED audio research only.** Source-only implementation, original sound recordings, all previous revisions, and main branch untouched.

Audition site: http://100.115.120.66:8186/

## User instruction and latest owner feedback

Marvin reported that the fast sampled Air drums sound significantly better than before. The prior global accompaniment timing candidate was only **maybe** better. He authorized a **note-by-note audit of the re-performed accompaniment, starting with Pope's Other** and a separate audition. No musical approval was given for either accompaniment timing revision.

## Source and evidence

Selected original separated FLAC: Pope Other, **150–182 seconds** of the source track. The source-based per-note audition has 151 original Basic Pitch candidate notes and 141 actually rendered in V3 after existing confidence/pitch/duration constraints.

Three **threshold variations of the SAME Basic Pitch model**, not independent recognizers:
- Existing (onset .48 / frame .28) = **151** candidates.
- Sensitive (onset .35 / frame .22) = **271** candidates.
- Strict (onset .57 / frame .34) = **94** candidates.
- 91 of the original notes have a near-timing same-pitch strict match, versus 146 with sensitive. Treat this solely as evidence of detection stability.

Audited every original candidate against:
- Matching pitch/onset in two alternate thresholds.
- Note confidence and octave-overlap with lower nearby notes.
- Pitch-class-local CQT prominence in the original separated FLAC, **11.61 ms frames**.
- Original source positive-log-STFT attack transients **5.805 ms hop**.

A total of **54 overlapping octave-pair combinations** were found, but source pitch spectra also show strong octave energy; **NO octave notes were automatically deleted**, because genuine octave doubling cannot be distinguished confidently from harmonic ghosts using this evidence alone. No original notes were deleted or relabeled as a different pitch. A conservative octave-shadow pruning experiment proposed zero justified edits, which is the appropriate outcome rather than fabricating certainty.

## Stronger lead: merged re-attacks of the same pitch

Forty sensitive-only candidates had strong source CQT pitch evidence while lying inside notes the original transcription already considered sustained. This is not proof they are all real; however, it indicates that repeated staccato note strikes **may have been merged into one long note**, plausibly causing the rhythm complaint.

Additive private score experiment: `rearticulate_featured_v1.py`
- Restrict to **same MIDI pitch already present inside an original longer note**. No newly invented pitches.
- Sensitive event confidence at least .53, and event start at least 90ms after source onset and 95ms before original note end.
- Positive spectral attack in the original source stem within **25 ms** and above the 35th percentile of detected strong source peaks.
- Source CQT pitch-prominence support at least .65 of the sampled onset window, median prominence at least 2.5dB.
- No new attack within 75ms of a different base-note onset of the same MIDI pitch. Multiple added attacks separated at least 110ms.
- Split source note only if each segment remains at least 115ms long. Preserve original note pitch, expression proxy, and overall original note time span except a 12ms explicit note-off gap before each inserted reattack.
- **18 plausible additional same-pitch attack events**, concentrated from **11.21 to 16.93 seconds** into the excerpt (whole-song ~161.21–166.93s).
- **151 source candidate notes → 169 candidate segments**, of which the renderer passes 159 under its existing source-note confidence and range gates.
- Prior 40 sensitive-only potential reattacks were **not all inserted**. Uncertain candidates remain flagged for human adjudication in a **private per-note JSON audit report** on CT211.
- No global note shift or beat-grid quantization. No automatic missing-note pitch inventions or octave suppression.

## A/B implementation

Added **Recovered attacks (Pope)** as a fourth option beneath the High-speed drums revision's Guitar/Piano/Other A/B:
- Stock trio (original Guitar+Piano+Other).
- Current orchestra (base 141 rendered featured notes).
- Timing candidate (global-ish conservative transient note onset shifts, owner considered inconclusive).
- **Recovered attacks (Pope)** (additional 18 tentative note reattacks on existing pitches).

Same user-chosen Ground or V3 Air drums, same lead and bass, same source unfeatured Guitar and Piano, and same biome sample/instrument family. Only *Pope Other* is re-performed with the extra note attacks. Original Maxi vocals toggle still works. New option is disabled for One More Run (not yet audited), and song-switching from Pope resets to Current orchestra to avoid implying that One More Run was corrected.

48 new Ogg files in private gallery: 22 Pope custom variations for Ground and Air, plus 22 One More Run byte-identical copies of previous High-speed Drums variant, and 4 original instrumental/vocal reference files byte-for-byte identical to V3. **336 total Oggs** in current CT211 private site. Older 231-clip gallery remains untouched. Ref and rendered source fragments stay off Git.

## QA

- All 48 new audio variants passed decoded Opus/48kHz-stereo/32s/peak integrity checks, 48 independent file checksums and no flags.
- All One More Run assets and all four original instrumental/vocal reference files verified **bit-identical to previous High-speed Drums**. All 22 Pope Ground and Air mix variants are distinct from previous V3.
- Rearticulation unit regressions explicitly prohibit splitting without original source attack/pitch evidence and preserve intentional octave combinations, unchanged other source events, and correct note-off gaps.
- 13 focused Python audio tests pass (including 3 retrigger, 3 accompaniment timing, 3 fast drums, 4 envelopes).
- Real Chromium WebAudio switch test passes for **340 HTTP assets** and all switching paths; new Pope note audit option is disabled and safely resets for One More Run.
- Production game build, release safety, music tests also checked separately.
- All mutable work is isolated to CT211 private audition site and source-only branch **feature/music-four-family-prototype**.

## Limitations and next steps

- **Automatic note segmentation is not manual note verification.** Basic Pitch variants are correlated; spectral attacks could belong to other sounding sources or leakage, and same-pitch CQT evidence cannot distinguish every repeat from resonance.
- The 18 new attacks could improve the per-note rhythm or cause excess staccato hits. The **owner must audition** before further promotion.
- The rest of Guitar/Piano/Other still needs audit, especially One More Run Piano, and precise missing-note pitch inference should not be auto-committed merely because a lowered-threshold model generated a candidate.
- Perceived-loudness level-matching and original performances remain important A/B controls.
