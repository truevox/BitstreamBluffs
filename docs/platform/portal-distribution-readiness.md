# #445 — H5 Games Ads and CrazyGames submission preflight

**Research and implementation-readiness record — 2026-11-27; NOT a submission, SDK integration, ad approval, age-privacy compliance certification, or launch.** Sources below are publishers' official documentation as viewed on this date. Re-check policy and terms before any external application or release. See [#439](https://github.com/truevox/BitstreamBluffs/issues/439) for the distribution epic and `adapter-contract.md` for the existing ABI-1 web/fake adapter; CrazyGames and Steam are currently *unavailable stubs*.

## Owner-approved boundaries, not promises of shipped features

From canonical GBrain `projects/truevox-bitstreambluffs/monetization` (2026-11-26; T1–T6 amendments 2026-11-27): **one codebase**; own-site **Ride remains free and ad-free**; opt-in ads only in the future web Lab/Idle (one Sim-Slot), never during the ride, never stacked, and failure to load an ad does not withhold the owner's intended free time. Steam is paid Early Access with no microtransactions or ads and must **not** wait for approval from Google/CrazyGames. Steam offers greater offline/training functionality. Public Brain Bazaar/uploads and school accounts are post-Early Access / pending dedicated privacy review. The owner requests **non-personalized/contextual ads only**, not personalized targeting. House promotions (The Frequency/Maxi and later SledHEAD) are only a potential fallback on the independent *own-site* Lab; they are not allowed as external ad inventory on CrazyGames. This issue cannot relax those requirements.

**Important distinction:** Platform policies allowing a type of ad are not proof that the network actually restricts its ads to non-personalized only. A written answer from each provider and an observed test request are separate gates. Do not introduce a live ad script on the general Ride entry page while the no-ads invariant applies.

## A. Own site: Google H5 Games Ads

**What is confirmed:** H5 Games Ads is a separate, by-application AdSense program for interstitial/rewarded HTML5 placements. Publisher needs an approved AdSense account, then approval for H5; approval is not guaranteed. The current API is **Ad Placement API**, not old IMA guidance. The H5 ad script belongs in the *same document* as the playable game canvas. `adBreak`/`adConfig` initialize on that page. Do not add them to the current own-site Ride page merely to apply.

**Owner action not yet performed / never infer from GitHub:** [official H5 Games Ads application](https://adsense.google.com/start/h5-game-ads-apply/?src=help-center). Form asks whether an AdSense account exists, first/last name, email, company, phone and country, website, role, publisher ID (if applicable), business plan and permission regarding product emails. Only the account holder should enter personal/contact details, accept terms and submit. Use `https://simulate.sledhead.ing/` as the existing game URL **if that is the domain the account holder intends to monetize**; do not claim the unpublished Lab exists. Application/submission status: **NOT SUBMITTED OR VERIFIED**. If no approved AdSense account exists, that is the first external blocker.

**Suggested non-personal application description** (revise to match live features at time of submission; not a claim that Lab is built):

> Bitstream Bluffs is an original, browser-based downhill sledding and tricks game. Our current web Ride is free and ad-free. We are developing a separate optional AI-training/Idle experience in which players could choose rewarded ad placements for time-based training perks; no mid-ride interruptions. We want non-personalized/contextual ads only, with transparent notice and consent where required. H5 ads would be limited to the optional Lab experience after approval, technical testing and privacy review.

**Engineering gate before `#444` enables own-site reward:** Validate H5 support for non-personalized-only operation and explicit consent management. Google documents the AdSense asynchronous-tag `adsbygoogle.requestNonPersonalizedAds = 1` / `npa=1` verification mechanism; **this is general AdSense documentation, not a tested guarantee for the H5 placement flow**. Confirm with Google that it works for the actual H5 integration, capture a real permitted test request showing `npa=1` (or updated documented equivalent), and reject/unload the ad path if that guarantee cannot be made. Note that Google says non-personalized ads can *still* use cookies for frequency capping and aggregated reporting, so NPA alone is not a privacy-law consent exemption. Test the entire early-close / no-fill / denied / blocked / hidden-tab / double-tap state machine under `#444`; never let ad callbacks affect authoritative simulation or permit repeat rewards.

**First-party house fallback:** On *own site only*, optionally provide a first-party link/card for The Frequency/Maxi or SledHEAD when ad serving cannot occur. No outside ad or SDK is needed to display a local promotion. A fallback **is not a completed third-party ad**; keep it outside `requestReward` success accounting. If the owner-approved reward is unconditional for no-fill, implement that policy explicitly in Lab logic, not by lying about a `completed` callback. Never couple own-site Ride to an ad-loader.

Sources: [H5 application and account requirements](https://support.google.com/adsense/answer/1705831), [H5 placement setup](https://support.google.com/adsense/answer/9955214), [Ad Placement API](https://developers.google.com/ad-placement), [Google non-personalized publisher tags](https://support.google.com/adsense/answer/7670312).

## B. CrazyGames: Basic Launch first; SDK only for Full Launch

| Gate | Current factual requirement | BsB status / next step |
| --- | --- | --- |
| Basic Launch | May begin without SDK; SDK is optional; **all ads disabled and no revenue**. | No submission made. This is *not* a way to collect ad revenue immediately. |
| Full Launch | Requires SDK, gameplay start/stop events, and SDK advertisements. `Data`/`User` modules if applicable. | `crazygames` is intentionally an unavailable adapter stub (`#442`). Do not turn it on until an isolated reviewed implementation passes ABI and gameplay tests. |
| Ads and promotions | **Only CrazyGames SDK ads**; no third-party or house ads, including our Google H5 or The Frequency/SledHEAD fallback. | Enforce at packaging level, not by relying on player settings. During Basic Launch rewarded buttons must not be dead/offer nonexistent ad rewards. |
| Steam links | CrazyGames generally prohibits cross-promotion, but its gameplay rules **permit a game-store (Steam/Epic) link to the same desktop game only in the main menu or at the end of a demo**, and **not as the main CTA**. | Include only after a genuine Steam URL exists; never invent an App ID. Validate with platform review; no external link in gameplay/reward prompt. |
| Preload and archive | Total package <= **250,000,000 bytes**; <= **1,500 files**. Initial download <= **50,000,000 bytes**; <= **20,000,000 bytes** for mobile homepage. Without an SDK they count the *whole* package as initial download, so a no-SDK Basic Launch package must be <= 50 MB. | Current checked-in static asset tree alone is too large (below). Make a separate playable portal bundle and measure its **real upload directory**, then browser network bytes to actual playable state. |
| Device support | Chrome/Edge; Chromebook smooth on **4 GB RAM**. Mobile touch and responsive layout must work if marked mobile. | Physical/low-end Chromebook gate, plus landscape mobile/desktop browser test; not proven by existing desktop Vite smoke. |
| Files and paths | Relative file references for a portal-distributed bundle; upload metadata, cover artwork, controls, and gameplay description. | Current Vite Pages base and PWA paths are not proof a portal ZIP works. Test exact packaged route, font/audio manifests and SDK callbacks. |
| Privacy | Additional personal data beyond SDK events calls for user-facing Privacy Policy/terms notice. CrazyGames may reach a young audience, with PEGI-12 suitability; **13+ platform audience is not an exemption from COPPA or all privacy obligations**. | Review existing opt-out playtest telemetry, third-party cookies, ad tracking, under-13 handling, and data transfer before submitting. No public brain uploads or school accounts. |
| Cross-platform distribution | CrazyGames FAQ explicitly says Steam publication does **not** remove revenue-share eligibility. | No web exclusivity implied by the basic portal docs. Review actual developer agreement before accepting; avoid Poki exclusivity. |

### Actual asset preflight — current main as of 2026-11-27

A Git-tree object-size audit of `public/` on `af875c4d` (source only; **not the final Vite build or upload ZIP**) returned **4,849 files totaling 474,191,116 bytes (474.19 MB = 452.22 MiB)**. The `public/music/packs/` subtree contains **4,761 files and 467,591,931 bytes (~467.59 MB)**. Both the 1,500-file and 250-MB caps are breached even before generated JS/CSS are added. These counts are based on tracked Git blobs, not missing sparse-checkout files. A portal-specific release must exclude/re-package optional music packs, private audition/review material, debugging/docs, and nonessential assets **without breaking fallback music, the game loader, rights, or the 4-song fallback**. This is a hard pre-submission gate; it is not a reason to remove music from the normal web or Steam distribution.

Use the offline, read-only auditor:

```sh
node tools/platform/audit-crazygames-package.mjs --git-ref HEAD --sdk
node tools/platform/audit-crazygames-package.mjs --directory /absolute/path/to/actual-portal-bundle --sdk --json
# For Basic Launch without SDK, omit --sdk. Script returns nonzero when over either static limit.
```

`--git-ref` measures `public/` tracked Git blobs even under sparse checkout; it intentionally excludes built JS and cannot certify an upload. `--directory` includes *all* files of the chosen packaging directory, rejecting symlinks; it is the relevant preflight for the actual submission. The auditor enforces total size and file count, **not initial download, CPU/memory, SDK readiness, origin policies, user consent or artwork**. Browser network measurement to a playable state is a separate requirement, not a fabricated pass in the tool.

### Portal-specific integration rules to preserve

- Explicit `crazygames` platform selection; **no hostname sniffing, no SDK on `web` or Steam**, no global ad script in core game. Keep ABI-1 adapter contract and `requestReward` fail-closed defaults.
- Read the CrazyGames SDK's `adsDisabled` capabilities and handle Basic Launch no-ads without freezing the game or promising unavailable rewards; honour the product's no-fill reward policy *independently* of SDK claiming success.
- GameplayStart only when actually playable (not when a splash/menu loads); GameplayStop on leaving active play. Avoid inferring eligible rank/score/rewards from an SDK signal.
- Site releases do not wait for a portal decision. Future portal-specific banner/ads and age/privacy consent should not affect existing web/Steam mechanics.
- Check **whether CrazyGames can satisfy the owner's contextual-only/no-targeting constraint**. Official SDK docs state only the provider can serve portal ads; they do *not* prove that all requests can be forced non-personalized. Until confirmed with the portal, keep monetized Full Launch blocked rather than violating owner direction.

Sources: [CrazyGames requirements overview](https://docs.crazygames.com/requirements/intro/), [technical/size/Chromebook requirements](https://docs.crazygames.com/requirements/technical/), [ads and Basic Launch](https://docs.crazygames.com/requirements/ads/), [Steam-link and gameplay placement exceptions](https://docs.crazygames.com/requirements/gameplay/), [Steam co-publication and SDK monetization FAQ](https://docs.crazygames.com/faq/), [developer portal](https://developer.crazygames.com/).

## C. Steam storefront links (independent workstream)

Steam's **store-page written description must not contain offsite URLs**. The store editor has specific *website and social-link* fields for those, distinct from the description. Link to Steam from independent own-site web where suitable; on a CrazyGames build, obey the menu/demo exception above. Steam Early Access packaging/listing, Steam Cloud, ownership and pricing are separate tasks under #439; no ad approval or portal submission is required to advance them. Source: [Steamworks store-page rules](https://partner.steamgames.com/doc/store/page).

## Submission / publication handoff (explicit owner/provider steps)

1. **Google** — account holder checks whether AdSense is approved, chooses publisher account/website/contact fields, personally completes and approves the [H5 application](https://adsense.google.com/start/h5-game-ads-apply/?src=help-center). Do not mark applied until confirmation exists. No ad tags or live reward code before approval and privacy proof.
2. **CrazyGames** — build a standalone lean portal artifact; rerun the package auditor against its actual output and measure first-play transfer in Chromium plus 4GB Chromebook; prepare metadata/covers. Owner reviews developer agreement and submits through the [portal](https://developer.crazygames.com/). Basic Launch earns nothing; SDK/ads for Full Launch only after provider/privacy acceptance and the separate adapter implementation.
3. **Steam** — independent Coming Soon work proceeds regardless of H5/CrazyGames status. Configure Steam website/social links through the dedicated fields; CrazyGames build gets a restricted store link only when real Steam URL exists.
4. **Do not close #445 as 'applied' or 'published'** based on this research PR. Separate status for readiness vs legal application/approval. No live ads, telemetry expansion, user targeting or platform submissions are authorized by this file.
