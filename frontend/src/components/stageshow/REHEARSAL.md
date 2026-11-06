# Rehearsal: Horubak ProductionStory

## Reference refresh — 2026-11-06

The FleetFlow reference supplied by the user calls for warm white/gray, violet and lime.
This update changes the Stage grays from cool to warm and its accent from blue to
#7050df (light) / #bca4ff (dark). Static-card geometry, title/range content, kit parts,
400×300 size and deliberate window bleed remain unchanged. No cursor or motion was added.
Violet here follows the user's explicit product palette rather than marking generic AI.
The previous captures and gate results below document the earlier blue version.

### Current palette verification

The root integration run filmed all four current-palette stills with --still --gate:
- docs/screenshots/reference/stageshow-light1440.png
- docs/screenshots/reference/stageshow-light1280.png
- docs/screenshots/reference/stageshow-dark1440.png
- docs/screenshots/reference/stageshow-reduced1440.png

Each adjacent JSON report records mode:still, status:no-issues-detected, exitCode:0,
no errors and complete coverage of one settled frame. The root reported that every
run ended with rehearsal passed. These are fresh captures of the warm/violet palette,
separate from the earlier blue captures.

An independent Evidence Collector compared three PNGs of the updated composition
and found no required visual correction, as reported to this author by the root.
This author verified the four saved gate reports; the independent visual judgment
belongs to that reviewer, not the illustration author.

Static verification does not certify animation, cursor motion, loop seams or an
OS-level reduced-motion setting. Mobile/390px/compact/Phone remain intentionally
excluded by the user's desktop-only requirement. Actual AI, server processing and
output are not supplied or certified by this illustration.

## Plan
Medium: static supporting illustration on the new-video desktop form.
Design size: 400×300. Desktop host widths: 1280 and 1440; workspace also checked at1920.
Focal object: saved clip in front of the candidate window.
Story: one selected source scene becomes an independently saved clip. The selected scene and clip share a title.
Payoff: title, source range and saved state are readable in one frame.
No cursor, scripted clicks, autoplay, loop or changing project state. Mobile/390/compact/Phone are explicitly excluded by the user.

## Gold
Stageshow1.1.1 examples/static-card (source repository commit299140fafd08df55a9c234e610c3f64af3f45531).
Copied the example and20 transitive desktop kit modules, plus a minimal local barrel.
Kept the window/satellite proportions, left104/top24 window bleed, left24/bottom24 foreground card, list pitch and deliberate right/bottom crop.
Changed finance rows to source scenes and saved clip, brand-blue light/dark, Korean text and existing Lucide film icons.
LICENSE andNOTICE.md are preserved. No third-party brand marks, photos, fonts or Phone implementation were copied.

## Earlier blue palette — Captured
- Gold: .cache/stageshow-gold.png (original desktop composition).
- Final: docs/screenshots/v3/stageshow-light1440.png
- Final: docs/screenshots/v3/stageshow-light1280.png
- Final: docs/screenshots/v3/stageshow-dark1440.png
- Final: docs/screenshots/v3/stageshow-reduced1440.png
- Corresponding JSON reports are adjacent. Report stage coverage:1 settled still, complete.

## Earlier blue palette — Gate
All four final captures use film.mjs --still --gate.
Final line:
```text
rehearsal passed (necessary, not sufficient: references/verify.md and the fresh eye in review.md still stand)
```
Each final capture reports no-issues-detected. Static captures do not judge motion.

## Earlier blue palette — Findings and fixes
- Initial row lacked a trailing filler, producing a lopsided row diagnostic. Matched the gold's trailing filler and normal/selected text hierarchy.
- Initial list pitch left a short bottom clearance; restored gold's36px pitch.
- Dark accent was too dim beside the app; raised it to#83b3ff for the illustration only.
- Independent fresh-eye reviewer compared gold/light/dark: matching the selected scene title on the saved clip makes the source→result relation clearer. Applied “빛이 머무는 순간” to both and recaptured all four final stills.
- The original gold had one nonblocking row-inset observation. The adapted final frames have no recorded findings.

## Earlier blue palette — Review
Reviewer: separate frontend agent, read-only visual comparison (not the story author).
Observed: no important Korean/time/status cropping, awkward wraps or dark contrast issue in the compared stills. Framing and relative window/card scale match the reference.
Reviewer did not inspect live functional pages, mobile, motion or gate logs in that visual pass.
Root reviewed actual registered-app composition and final light/dark stills. Functional app QA is recorded separately.

## Reproduction
The installed skill's film scripts are copied to the ignored .cache/stageshow-tools folder for authoring. Only browser.mjs's Playwright resolution points to the bundled runtime; measurement/gate code is unchanged.
Production UI needs no new package. The static reference entry is available only from the development server:
- /stageshow-reference.html?production=1
- /stageshow-reference.html?production=1&dark=1
Capture with --still --gate --width1280 or1440 and selector "#example .ss-fit".

## Not checked
Animated cursor/motion/seam checks are not applicable to this static design.
Mobile/390/compact layouts intentionally not implemented/tested.
OS-level reduced-motion switch and assistive-technology reading are not certified by the emulated reduced-motion still.
Actual AI, uploads, server auth/storage/render/publication are not supplied by this illustration.

