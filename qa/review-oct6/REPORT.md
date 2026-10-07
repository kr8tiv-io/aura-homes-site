# Closing review, 7 October 2026

Local build on `http://127.0.0.1:4391`, after `npm run build` (exit 0). Live BEFORE numbers are the 6 October table in `AUDIT.md` (https://aurahomes.fun, same Lighthouse settings). Screenshots and Lighthouse JSON stay in `C:\Users\lucid\Desktop\Aura-Audit-Oct6\qa-out\review\`. Nothing was pushed.

This review did not edit `src/pages/index.astro`, `ensureScenes`, `src/scripts/film-scrub.ts`, or the `#cabin-film` element. Earlier prompts since `d309750` did change `index.astro` (story videos use `data-poster`, and `ensureScenes` waits before a phone imports meadow chunks). The cabin film source, poster, and scrub binding are the same. Desktop scrub still moves the film, and the meadow still paints. See the film note below.

## Pass / fail

| Check | Result |
| --- | --- |
| `npm run build` | Pass. Exit 0, twice (after the stage fix, and again after the builder fix). |
| Preview on 4391 | Pass. Helper served `dist/client`. |
| Harness, 31 routes × m390, m360, d1440 | Pass on links and overflow. 93 pages, `brokenLinks` empty, `hOverflow` 0, `todo` empty, nav text `AURA` on every page. |
| Console errors on 200 pages | Pass. The only `error:` lines are the two deliberate 404 documents. |
| Failed requests on 200 pages | Explained. Every one is `net::ERR_ABORTED` on a hero or scroll video that the harness cancelled mid-scroll. The files are on disk. |
| Wordmark AURA, source and paint | Pass. Nav, splash, and footer. No "AURA HOMES" in `dist` HTML. |
| Phone builder from Journeys and Menu | Pass. `/build-your-own` is a real configurator, with the desktop note and "Open the 3D view". |
| Hero and figure images on m390 and m360 | Pass after `5d4e143`. Story videos hold 342×246 at scroll 0. |
| Forms | Pass. Empty config stays on the page with the held line. No request to `/api/join`. |
| TODO / lorem in dist and harness text | Pass. None. |
| Phone 3D | Pass. Loader, then a live meadow. One context. Offscreen pauses. `?quality=off` and reduced motion stay on posters. |
| Desktop 3D with `?quality=high` | Pass. Meadow paints. Builder stage center pixel is opaque and shows the room (`cdd04ab`). |
| Cabin film scrub, Lenis, passage pin | Pass. Film `currentTime` moved from 0 to 5.48 s. Lenis was on. Headless d1440 (tier off) matches the audit poster frame. |
| V6 mark, bronze halo | Pass. Thin ridge, bracketed tips, floating ring, no dot. |
| Lighthouse vs BEFORE | Mixed, and honest. Home score rose. Builder rose after the footer fix. Text pages are slower here than on the live CDN. Detail below. |
| Brand on the new strings | Pass. No new disclaimer, no em dash, no exclamation point. Bronze stays on labels and the button rule. |
| Splash film files | Cabin mp4s untouched. `git diff d309750 -- public/film` is only `water-roof.webp` (62 KB, from `86e963e`). |

## Findings A-01 to A-18

| ID | Status |
| --- | --- |
| A-01 | Fixed in `741afda`. Thanks heading clears the sticky bar. |
| A-02 | Fixed in `741afda`. Empty endpoint holds the note. Probe: no `/api/join`. |
| A-03 | Fixed in `d971690`. Harness `todo` arrays are empty. |
| A-04 | Open for Matt. Cabin film weight. This review did not edit it. Local home transferred 41,650 KiB of `cabin-dusk-hi.mp4`. |
| A-05 | Fixed in `a97e3da`. Harness `hOverflow` is 0 on all 93 pages. |
| A-06 | Fixed in `afa2327`. Phone page is the configurator. Rechecked in screenshots. |
| A-07 | Fixed in `1b50021`, `6d4b521`, `8604723`. Rechecked: low tier on a phone with no query, one live world, posters when off or reduced motion. |
| A-08 | Fixed in `2fe1dbf`. Desktop home best practices is 100 (BEFORE was 96). No custom-model 404s in this harness. |
| A-09 | Shot hidden in `86e963e`. Roof still is in. "Portrait to come" stays open for Matt. |
| A-10 | Open for Matt. Water pages still disagree. |
| A-11 | Fixed in `3f888ae`, plus `5d4e143` so the width and height attributes hold the frame before the poster decodes. |
| A-12 | Open for Matt. Links resolve. Glass, Resorts, and Thirst Contact are still off the menu. |
| A-13 | Fixed in `a3022d3`. Unknown paths use the branded 404 ("This path is quiet.", wordmark AURA). |
| A-14 | Fixed in `58f7a12`, `bd3176c`, `86e963e`. |
| A-15 | Open for Matt. Skylight sentence under the tub item. |
| A-16 | Fixed in `ed1a6db`. Paint confirmed on m390, m360, and d1440. |
| A-17 | Partial. Named lines removed in `1b6d03b` and `86e963e`. The rest stays for Matt. |
| A-18 | Fixed in `5f64448` and `a3022d3`. `/dev/model-check` is the branded 404 in this production build. |

## Lighthouse BEFORE vs AFTER

BEFORE is live, 6 October, simulated throttling. AFTER is the local preview, 7 October, same flags. Mobile rows for `/rooms`, `/build-your-own`, `/story`, `/contact`, and `/pre-order` use the trailing-slash URL, which does not redirect. A bare path on this preview costs about 600 ms. Home is `/`.

| URL | Form | Perf | A11y | BP | SEO | LCP | TBT | CLS | Weight |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/` | mobile | 47 → 66 | 100 → 100 | 100 → 100 | 92 → 100 | 6.9 s → 5.7 s | 2,150 ms → 410 ms | 0 → 0 | 19,316 → 42,559 KiB |
| `/rooms` | mobile | 83 → 73 | 100 → 100 | 100 → 100 | 100 → 100 | 3.1 s → 4.9 s | 280 ms → 100 ms | 0.001 → 0 | 626 → 682 KiB |
| `/build-your-own` | mobile | 91 → 97 | 100 → 100 | 100 → 100 | 92 → 100 | 2.9 s → 2.0 s | 10 ms → 20 ms | 0 → 0.01 | 443 → 1,084 KiB |
| `/story` | mobile | 91 → 79 | 100 → 100 | 100 → 100 | 100 → 100 | 2.4 s → 4.1 s | 270 ms → 260 ms | 0.071 → 0.005 | 403 → 508 KiB |
| `/contact` | mobile | 81 → 70 | 100 → 100 | 100 → 100 | 100 → 100 | 2.5 s → 3.8 s | 610 ms → 640 ms | 0.066 → 0 | 213 → 422 KiB |
| `/pre-order` | mobile | 96 → 86 | 100 → 100 | 100 → 100 | 100 → 100 | 2.1 s → 3.7 s | 20 ms → 70 ms | 0 → 0 | 214 → 429 KiB |
| `/` | desktop | 90 → 83 | 100 → 100 | 96 → 100 | 100 → 100 | 1.2 s → 2.4 s | 230 ms → 170 ms | 0 → 0 | 15,490 → 44,000 KiB |

Local versus live:

- The preview does not compress text. Lighthouse estimates 200 to 700 KiB of savings on these pages (about 1,193 KiB on desktop home, mostly scripts). GitHub Pages does compress. The builder's 1,084 KiB includes about 698 KiB that compression would remove, which puts the compressed weight under the live 443 KiB.
- Home weight is the film. 41,650 KiB of the 42,559 KiB mobile transfer is `cabin-dusk-hi.mp4`. The live run recorded a partial 206 of about 17,800 KiB. The file on disk is still about 40.7 MB. Open item for Matt (A-04). This review left the film alone.
- `/rooms`, `/story`, `/contact`, and `/pre-order` do not pull Three.js. Their lower performance scores are a slower LCP on the local document (heading text), not a new bundle. Story and contact CLS improved. Rooms TBT improved. I did not chase those LCP gaps with more code.
- The first builder run, before `2a29b9d`, was performance 57, accessibility 96, CLS 0.54. The footer jumped when the empty root filled in, and the new bronze captions were 3.54:1 at about 12 px. After the hold and the ink change, the remeasure is the row above.

## Mobile 3D

Headless Chrome uses SwiftShader. `detect-gpu` treats that as a blocked GPU. Desktop with no query stays `off` and shows posters. A phone-class window with no query resolves to `low`. `?quality=` wins.

| Surface | No query | `?quality=low` | `?quality=high` | `?quality=off` or reduced motion |
| --- | --- | --- | --- | --- |
| Phone meadow | low, one live world | low, paints | not the phone path | poster, no canvas |
| Desktop meadow | off, poster (headless) | paints | paints, bloom on because the passage asks | poster |
| Phone builder | still, button, desktop note | opt-in live view | desktop stage | still |
| Desktop builder | off in headless | paints | paints an opaque room after `cdd04ab` | still |

Phone diet for one walk: 24 unique files, 7.90 MB. Lod2 groves, 1k HDRIs (`evening_meadow_1k.hdr` 1.6 MB, kloofendal 1k 1.4 MB), basis transcoder, ground and atlas textures. A single grass passage is about 5.6 MB. Low and medium keep one world. The next passage disposes the previous one. Rendering pauses offscreen. The loader tracks real bytes, then a frame. DPR is 1 on low and 1.25 on medium, capped at 30 fps. No bloom, godrays, AO, or shadows on the phone profiles.

SwiftShader logs `KHR_parallel_shader_compile` once per context, and repeats `glDrawArraysInstanced` vertex-type warnings on grass, glass, and resorts. The frames still show trees and grass. Left as a headless warning, not a blank canvas.

## Images

Story figures on a phone use `object-fit: contain` and a 78dvh cap. An author `aspect-ratio: auto` had been wiping the HTML width and height hint, so each video sat at the 150 px default until a poster decoded. Removing that declaration restores `auto 1280 / 922` (and the other attribute ratios) immediately. Measured at scroll 0 on m390: 342×246.

Room cards that look like slits in mid-scroll harness frames are the 1.9 s window reveal (`top 86%`), not a crop. Later frames, such as Hot Take, are open photographs. Living heroes on d1440 are a few pixels wider than the viewport. The document does not scroll sideways (`hOverflow` 0). Tall composed frames on `/back-to-nature` match the audit and were left.

## Screenshots

- `qa-out/review/m390/home-top.png` wordmark AURA over the cabin film
- `qa-out/review/m360/home-top.png` same at 360
- `qa-out/review/m390/home-s2.png` phone meadow, live
- `qa-out/review/m390/build-your-own-top.png` configurator, The Soak, desktop note
- `qa-out/review/d1440/home-top.png` splash, V6 mark, bronze halo
- `qa-out/review/d1440/home-s2.png` poster passage, matches the audit d1440 frame
- `qa-out/review/probe/home-d1440-film-after.png` scrubbed nest frame
- `qa-out/review/probe/home-d1440-grass-high-after.png` live meadow at `?quality=high`
- `qa-out/review/probe/byo-d1440-high-after.png` desktop builder stage, room in frame
- `qa-out/review/probe/story-figure-m390-after.png` meadow still fully in the phone frame

## Regressions found and fixed

1. `5d4e143` Keep story figure ratio before the poster loads. `src/styles/global.css`.
2. `cdd04ab` Apply bloom only when a stage view asks for it. `src/three/stage.ts`. Passages that pass a bloom setting still get it. The builder does not, so the high-tier stage stays opaque on SwiftShader. Verified: center pixel rgba(78, 79, 73, 255), and the grass passage still draws.
3. `2a29b9d` Hold the builder footer and raise caption contrast. `#byo-root` keeps `min-height: 100svh` until the configurator fills it. The picked line and the desktop note use the existing ink at 78% opacity instead of bronze at 12 px. Bronze remains on the button rule and the kicker. Remeasured CLS 0.01, accessibility 100, performance 97.

## Film and index.astro

`git diff d309750 -- public/film` adds `water-roof.webp` only. `src/scripts/film-scrub.ts` has no diff. `#cabin-film` is still `cabin-dusk-hi.mp4` with `cabin-poster-hi.webp`. This review's commits do not touch `index.astro`.

Since `d309750`, `index.astro` has 59 insertions from earlier prompts: story videos switched from `poster` to `data-poster`, and `ensureScenes` waits so the first phone view stays on the film. Splash pin math and `bindFilmScrub` were not retuned. Desktop check at `?quality=high`: Lenis on, film readyState 4, `currentTime` 5.48 s after a short scroll, meadow stage painted.

## Copy notes for Matt

Left as written. Suggestions only:

- Story lede still uses the retired outside line.
- `/story` still says "Portrait to come".
- Water pages still disagree, including "The machine is not ready to place".
- FAQ still has deposit, refund, and permit lines. The pre-order refund sentence is in that set.
- "Second Breath" is still the name on that line. Customs already says "second life" trailers.
- Menu still omits Glass, Resorts, and Thirst Contact (A-12).
- The skylight sentence still sits under the tub item (A-15).
- The word-by-word reveal drops the space character and uses margin. The line reads correctly on screen. The splitter is in `index.astro` and was left alone.

## Open items for Matt

- A-04. Cabin film weight and the full-file transfer on a static host.
- A-09 portrait, A-10 water pages, A-12 menu map, A-15 skylight sentence, A-17 remaining lines, and "Second Breath".
- SwiftShader `glDrawArraysInstanced` warnings while the meadow still paints. A real phone GPU may not log them. Not rewritten in this pass.
- Local Lighthouse is not a CDN. Text pages look slower here than the live BEFORE table even when the new work does not add weight.
