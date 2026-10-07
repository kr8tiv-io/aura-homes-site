# Aura Homes site audit

Date: 6 October 2026 (America/Costa_Rica).
Commit audited: `d309750b07f034df223b6cf0b048b7afeafd9732` (`d309750`, "Drop builder HDRI credit lines", 2026-10-05). Branch `main`.
Live site: https://aurahomes.fun (GitHub Pages from that commit, built with `SITE=https://aurahomes.fun`). This pass did not push or publish.
Local preview: `npm run build` without `SITE`, then `preview.ps1` on http://127.0.0.1:4391/ serving `dist/client`. Visual pages match live. Canonical, sitemap, robots, and JSON-LD on the local build say `https://aurahomes.local` because `astro.config.mjs` defaults `site` when `SITE` is unset. Live tags say `https://aurahomes.fun`.

Tools: Astro build, Playwright via `C:\Users\lucid\Desktop\Aura-Audit-Oct6\tools\shoot.mjs` (Chrome, headless, swiftshader), Lighthouse CLI against the live site (simulated throttling), and small probes in `C:\Users\lucid\Desktop\Aura-Audit-Oct6\qa-out\scripts\`. Screenshots and Lighthouse JSON stay outside the repo under `C:\Users\lucid\Desktop\Aura-Audit-Oct6\qa-out\audit\`.

Viewports: m390 (390×844, DPR 3, iPhone UA, touch, coarse pointer), m360 (360×800, Android UA), d1440 (1440×900). Form, menu, and overflow probes used the same phone profile and a 1440 desktop window.

`aura-refine` (`f52adfe`, worktree `Vanguard-Eco-Homes-refine`) has no commits that are not already in `main`. `main` is 9 commits ahead. Nothing from that branch is waiting to merge.

This is an audit only. No site source, style, asset, or config was changed.

## Executive summary

Ranked by what a first-time visitor hits.

- On a phone, the home page's first job is downloading the cabin film. Lighthouse mobile performance is 47. Largest paint is 6.9 s, total blocking time is 2.15 s, and the run transferred about 19 MB, almost all of it `cabin-dusk-hi.mp4` (40.67 MB on disk, HTTP 206). The film and its scrub binding are protected. This is an open item for Matt, not a change for the next prompts.
- The quote form on `/pre-order` tells the visitor "We have your note. We will reach out personally. Nothing was charged." The action is the literal string `TODO`. Nothing is sent. Confirmed by submitting the form in Chrome.
- "Hold my place" and "Count me in" post to `/api/join`. That route is not in the static build, so GitHub Pages cannot answer it. The visitor sees "The line did not answer."
- Every page except home ends with `Email: TODO` and `Phone: TODO`. Contact and Story also show `Link: TODO` under the YouTube line. Contact submit is honest ("The inbox is not open yet, so this note stayed here."). The quote form is not.
- On a phone, Build Your Own is one cover photo and a text list of the room names. The live meadow view requires a viewport of at least 1024 px and a fine pointer, and the quality gate also turns WebGL off under 1024 px. `/builder` only redirects to `/build-your-own`. Long names wrap so the radio dot sits beside the second line ("ROOM", "HEAVEN").
- Phone passages are still photographs, class `passage is-still`, not the meadow scenes. `quality.ts` forces the tier off below 1024 px and on a coarse pointer. The 59 MB `pine_sapling_medium.glb` is shipped and credited, and no page fetches it.
- At 1440 px the document is 1494 px wide on 14 routes, locally and on the live home page. The extra 54 px is the invisible heading glow (`.heading-heat::before`, width 128%, centered). The desktop screenshots still look composed. A visitor can drag sideways by that 54 px. On a 390 px layout the same glow pushes scroll width to 414. The harness compared scroll width to `window.innerWidth`, which the phone emulation reports as 414, so it recorded no mobile overflow.
- Water is three stories. The nav goes to Aura H2O (premium cans and glass, coming later). `/water` is Thirst Contact (plain plastic jugs, not ready) and opens with a black "Shot to come" card. Farms says Aura can build and place the wall. The master plan says later chapters are a direction, and one line says the host network "is not a promise."
- A desktop load of home probes nine missing custom models and logs nine 404s. Lighthouse best practices on desktop home is 96 for that reason. Phones do not request them, because 3D is off.
- The painted wordmark is AURA. The DOM text in `.nav-name` is still `Aura`. CSS uppercases it. Prompt 66 is a source-string change. Layout should stay as it is.
- The menu on a phone opens, focuses Story, and lists the real sections. Glass, Resorts, and `/water` are not in that menu. There is no branded 404. `/rooms/the-soak` and the other ten concept slugs are bare "404" if typed. The twelve rooms link to `/pre-order?model=`, not to `/rooms/<slug>`.

## Findings

| ID | Sev | Page | Target |
| --- | --- | --- | --- |
| A-01 | P0 | `/pre-order` | 70, Matt |
| A-02 | P0 | Join forms, home and later pages | 67 |
| A-03 | P0 | Footer, `/contact`, `/story` | 68, Matt |
| A-04 | P1 | `/` mobile | Matt |
| A-05 | P1 | `/`, `/rooms`, desktop and mobile | 70 |
| A-06 | P1 | `/build-your-own`, `/builder` | 62 |
| A-07 | P1 | Home passages, `/glass`, `/resorts` | 64, 65 |
| A-08 | P1 | `/` desktop | 70 |
| A-09 | P1 | `/water` | Matt |
| A-10 | P1 | `/h2o`, `/water`, master plan, farms | Matt |
| A-11 | P2 | Heroes, story figures, room cards | 63 |
| A-12 | P2 | Nav and menu | Matt, 70 |
| A-13 | P2 | SEO, sitemap, 404 | 70 |
| A-14 | P2 | Materials footnote, quote thanks, split headings | 70 |
| A-15 | P2 | Home "What we finish" | Matt |
| A-16 | P3 | Header wordmark | 66 |
| A-17 | P2 | Copy that breaks the brand rules | Matt |
| A-18 | P2 | Unknown URLs, `/dev/model-check` | 70 |

### A-01. P0. Quote form says the note was received. Nothing was sent.

Area: `/pre-order`. All viewports.
What is wrong: `formAction` is the string `TODO`. After a valid submit the script still calls `showThanks()`, hides the form, and shows "We have your note." plus "We will reach out personally. Nothing was charged." A honeypot fill does the same. The visitor believes a person will write back.
Evidence: `src/pages/pre-order.astro` lines 8, 148–150, and 366–408 (the `showThanks()` call sits after the `https` / `mailto` branches, so the `TODO` action falls through). Browser submit at m390: thanks text was exactly those two sentences, the form's `hidden` attribute was set, and `#quote-thanks` was visible. Screenshot: `C:\Users\lucid\Desktop\Aura-Audit-Oct6\qa-out\audit\probe\preorder-after-submit.png`. The thanks heading also sits under the sticky header (only "NOTE." was left in frame) and the scroll landed on the footer.
Suggested fix: Until Matt names an endpoint, do what contact already does. Do not show the success copy. Show a calm line that the note stayed on the page. When he names a Formspree URL or a `mailto:`, wire `formAction` and only then show the thanks state. Do not invent an inbox.
Target: 70 for the false success. Matt for the provider (see Open items).

### A-02. P0. The join forms post to an API the static site does not have.

Area: `Join.astro` on `/` (two forms), and the enquire blocks on the later pages. All viewports.
What is wrong: Both forms use `action="/api/join"` and `fetch('/api/join')`. `src/pages/api/join.ts` is `prerender = false`, so `dist/client` has no `/api`. GitHub Pages returns 404. The catch sets "The line did not answer. Try again in a moment." A name left here is discarded.
Evidence: `src/components/Join.astro` lines 18, 58, and 154–167. Home screenshot of both forms: `C:\Users\lucid\Desktop\Aura-Audit-Oct6\qa-out\audit\m390\home-s8.png`.
Suggested fix: Prompt 67. Point both forms at the same provider Matt chooses for the quote form, or a static-safe stand-in he approves. Keep the honest failure until that exists. Do not claim the place is held.
Target: 67. Matt chooses the provider.

### A-03. P0. Email, phone, and the YouTube link are the word TODO.

Area: Footer on every page except home. Contact reach block. Story founder block. All viewports.
What is wrong: Visitors who leave home see bronze lines `EMAIL: TODO` and `PHONE: TODO`. Contact and Story add `LINK: TODO` under "Follow the build on YouTube". Contact submit does not pretend: "The inbox is not open yet, so this note stayed here." That part is honest. The visible TODO is leftover.
Evidence: `src/layouts/BaseLayout.astro` lines 184–185. `src/pages/contact.astro` lines 6, 71–75, and 200–207 (the `else` branch at 256 calls `showThanks(false)`). `src/pages/story.astro` lines 135–136. Screenshot of the footer: `qa-out\audit\probe\preorder-after-submit.png`. Contact form before submit: `qa-out\audit\probe\contact-top.png`. Browser confirm of the honest contact line after submit.
Suggested fix: Prompt 68 replaces the placeholders once Matt gives the real email, phone, and YouTube URL. Until then, remove the TODO lines rather than printing the word TODO. Keep contact's honest failure. Do not invent the addresses.
Target: 68, Matt.

### A-04. P1. The home page on a phone is the cabin film.

Area: `/`. Mobile. Desktop is a separate, better score.
What is wrong: `preload="auto"` on `#cabin-film` makes a phone download the dusk film before it has seen the page. Lighthouse mobile on the live home: performance 47, accessibility 100, best practices 100, SEO 92. LCP 6.9 s, TBT 2,150 ms, CLS 0, about 19,316 KiB across 31 requests. The top transfer is `cabin-dusk-hi.mp4` at 17,800 KiB, status 206. The file on disk is 40.67 MB. Main-thread work is about 10 s. Desktop home is performance 90, LCP 1.2 s, TBT 230 ms, CLS 0, about 15,490 KiB, and still pulls a large 206 of the same film plus 3D textures.
Evidence: `src/pages/index.astro` lines 13–23. JSON: `qa-out\audit\lighthouse\before-home.json` and `before-home-desktop.json`. Screenshot of the film frame: `qa-out\audit\m390\home-top.png` (the crop itself looks composed: cabin, tub, daybed, wordmark AURA).
Suggested fix: Do not change the film file, `bindFilmScrub`, or the splash structure. Recommendation for Matt only: keep the film for the scrub, and stop using `preload="auto"` on small or slow connections, or commission a shorter mobile edit as a new asset he approves. A change here touches `index.astro`. Desktop scrub must stay identical.
Target: Matt. Not prompt 70, and not 63.

### A-05. P1. The page is wider than the window. The heading glow is the element.

Area: fourteen desktop routes, and a 390-wide layout. Live home matches local home.
What is wrong: At 1440×900, `documentElement.scrollWidth` is 1494 (client width 1440) on `/`, `/rooms`, `/customs`, `/master-plan`, `/farms`, `/h2o`, `/water`, `/glass`, `/resorts`, `/pre-order`, `/faq`, `/contact`, `/credits`, and `/dev/model-check`. It is not set on `/story`, `/journal` and its posts, `/build-your-own`, the two room detail pages, or `/back-to-nature`. The same 1494 is on https://aurahomes.fun/ and on the local build for home. Desktop frames of home, rooms, and contact look composed. The extra width is a sideways scroll, not a broken crop. `d1440\home-top.png`, `d1440\rooms-top.png`, `d1440\contact-top.png`. The widest real box is `h2.heading-heat`. Its own scroll width is about 169 px wider than its border box because `::before` is `width: 128%`, `left: 50%`, `transform: translate3d(-50%, -50%, 0)`. Opacity is 0 until hover, and it still expands the document. The widest headings sit near the right padding, so the glow ends at x = 1494. That is the +54 px.
On a 390 CSS-pixel layout, client width is 390 and scroll width is 414 (+24 px), same glow (14% of a 342 px heading is about 48 px, and the heading's right edge is 366). `window.innerWidth` in the iPhone emulation came back 414, so `shoot.mjs` (which compares scroll width to `innerWidth`) recorded `hOverflow=0`. The overflow is real against the layout client width.
These do not widen the document and should be left alone: `.hero-mist` (internal scroll width ~2083, border box stays at 1440, parent clips), `.page-grain`, `.daylight`, `.site-cursor`, and the honeypot `.join-hp` at `left: -9999px`.
Evidence: `src/styles/global.css` lines 697–711. Probe: `qa-out\scripts\find-overflow.mjs`, local and live. Harness `summary.json`: every flagged desktop route is exactly 1494. The phone harness recorded `hOverflow` 0 because `innerWidth` was 414 while client width was 390.
Suggested fix: Keep the hover glow. Stop it from participating in scroll width. `overflow-x: clip` on the heading, or on `html`, is enough. Do not shrink the mist sheet or the grain to "fix" 1494.
Target: 70.

### A-06. P1. A phone does not get the builder. It gets a photo and a list.

Area: `/build-your-own` and `/builder`. m390 and m360.
What is wrong: `liveNow()` is true only when the quality tier is medium or better, the viewport is at least 1024 px, the pointer is fine, and reduced motion is off. Phones fail the width check and the quality gate, so the stage is `<img class="order-still">` (or a pair), `object-fit: cover`, height `52vh`. Under that is Undo / Redo, the steps Model, Size, Glass, Add-ons, Review, and a radio list of the twelve locked names plus Hot Tub Time Machine, Cool Runnings, and Fire and Ice. It reads as a catalog, not a model you turn. `/builder` is a meta refresh plus `location.replace('/build-your-own')`, robots noindex, and a relative canonical `href="/build-your-own"`.
The choice is `display: grid` with the dot in column 1 spanning two rows. Long titles wrap, and the dot lines up with the second line. Visible on "A Hitchhiker's Guide to the Guest Room" and "Pandora's Glass Stairway to Heaven" at 390, and again at 360 (`m360\build-your-own-s3.png`, the dot sits on "GUEST ROOM").
Evidence: `src/builder/OrderForm.tsx` lines 78–85 and 355–366. `src/styles/builder-order.css` lines 15–22 and 149–186. `src/pages/builder.astro` lines 6–15. Screenshots: `qa-out\audit\m390\build-your-own-top.png` (cover photo, subject intact), `build-your-own-s2.png` (grass at the bottom of that photo, then the steps), `build-your-own-s3.png` and `build-your-own-s5.png` (the wrapped names). `builder-top.png` is the same page after the redirect. Harness: `/builder` status 200 on every viewport, final URL `/build-your-own/`, one failed request: `net::ERR_ABORTED` on `RevealHeading.astro_astro_type_script_index_0_lang.*.js`, cancelled by `location.replace`. Not a missing file.
Suggested fix: Prompt 62. Send `/builder` at `/build-your-own` with an absolute canonical. On a phone, either a lighter live view (depends on 64) or a still that changes with the selected model and does not pretend to be the rooms page. Fix the grid so the dot stays on the first line of the name. The row's tap height is already `min-height: 44px`. The dot itself is 0.55 rem and does not need to be the hit target.
Target: 62. Live 3D on a phone also needs 64.

### A-07. P1. Meadow scenes are off on a phone, and the 59 MB pine is not the scene.

Area: Home passages `grass`, `glass`, `steam`, `far`. Also `slope` on `/glass` and `snow` on `/resorts`.
What is wrong: `forcedOff()` is true when `innerWidth < 1024`, or the pointer is coarse and no fine pointer exists, or save-data / reduced-data is set, or WebGL2 is missing. The tier stays `off`. `showStill()` adds `is-still` and paints `data-poster` as a cover background with a 0.46 black veil. `ensureScenes()` in `index.astro` returns immediately when the tier is off, so meadow, wash, and field are never imported. On desktop it mounts every `[data-meadow]` canvas at once.
A phone at rest on home had four passages, all `passage is-still`. Posters repeat: grass and far both use `/film/story-meadow-side.webp`. Glass uses `story-room.webp`. Steam uses `layout-gazebo.webp`. The 8-step scroll mostly stepped between story figures. One frame catches the glass passage with the copy on the photo (`home-s4.png`, readable). Another catches the far passage ghost word "Field" (`home-s6.png`). They are not blank canvases. They are the same photographs used elsewhere.
`pine_sapling_medium.glb` (59.07 MB), `.lod1` (36.18 MB), and `.lod2` (16.66 MB) are in `dist/client/models` and in `src/data/credits.ts`. References in code are `scripts/fetch-cc0.mjs` and `assets-src/catalog.json` only. Runtime trees are the EZ-tree meadow pines, spruces, and aspens.
Evidence: `src/three/quality.ts` lines 144–154 and 266–273. `src/pages/index.astro` lines 87–88, 164–165, 219–220, 241–242, and 306–316. `src/scripts/meadow.ts` lines 21–28 (HDRI per scene). `src/three/meadow-v1/grove.ts` lines 13 and 178–187 (six variants, three LODs each, plus props). `src/three/meadow-v1/golden-sky.ts` line 117 (`alps_field_2k.hdr`). `src/three/meadow-v1/world.ts` mounts that grove. Overflow probe passage classes on m390 home.
Suggested fix: Prompts 64 and 65. See the enablement notes below. Any real mobile scene has to touch `ensureScenes`. Desktop behavior, the film scrub, and the meadow passages on a wide screen must stay as they are. Do not "optimize" by deleting the sapling files in this pass. Matt can move the unused GLBs to `/_archive` later.
Target: 64, 65.

### A-08. P1. Desktop home requests nine models that are not there.

Area: `/` once 3D is allowed. Not on phones today.
What is wrong: `resolveCustom()` HEAD-fetches `models/custom/{aura-unit,hot-tub,gazebo}` at full, lod1, and lod2 for the current tier. None of those files exist. Each miss is a 404, and Lighthouse counts them as console errors. Desktop home best practices is 96 for this. The procedural model still draws. The moment 64 turns 3D on for phones, those nine requests move to phones too.
Evidence: `src/three/custom-models.ts` lines 34–40 and 104–113. Local overflow probe on `/` at 1440 listed the nine 404s. Desktop Lighthouse network and `errors-in-console`.
Suggested fix: Stop guessing with HEAD. A small manifest of files that actually exist, or skip the probe until a custom GLB is shipped. Do not add empty GLBs to silence the console.
Target: 70.

### A-09. P1. Thirst Contact opens on a card that says the photograph is missing.

Area: `/water`. Seen at m390. The card is in the first screen after the lede.
What is wrong: `ShotHold` renders a black panel, kicker "Shot to come", and a caption describing a roof collector that is not pictured. The next still (the oak bottling line) does load. "Shot to come" is leftover placeholder copy.
Evidence: `src/components/ShotHold.astro` lines 9–11. `src/pages/water.astro` line 31. Screenshots: `qa-out\audit\m390\water-top.png` (black block) and `water-s1.png` (the kicker and caption). The twelve room cards all have `image` set in `src/lib/rooms.ts`, so the rooms fallback is unused today.
Suggested fix: Matt supplies the roof still, or points this slot at an existing still. Do not leave the words "Shot to come" in the UI. Do not invent a photograph in the implementation pass.
Target: Matt.

### A-10. P1. The water story, and what is "ready", disagree with each other.

Area: `/h2o`, `/water`, `/farms`, `/master-plan`, Journeys. All viewports.
What is wrong: The top nav label "Aura H2O" goes to `/h2o`, which says premium cans and glass, ethical sponsors, chapter 3, coming later (`src/pages/h2o.astro` lines 8–18). `/water` says plain plastic jugs, "Not yet. Still in research.", and "Thirst Contact is not ready to build or to place." (`src/pages/water.astro` lines 43–69). Farms says "Aura can build it and place it. You can buy it and grow for yourself." The master plan says the room is what you can ask for now, and chapter 4 says the host network "is not operating, and it is not a promise" (`src/pages/master-plan.astro` around line 134). A first visit cannot tell which water page is the product.
Evidence: screenshots `m390\h2o-top.png`, `m390\water-top.png`, `m390\farms-top.png`, `m390\master-plan-top.png`. Menu lists Aura H2O and does not list `/water`, `/glass`, or `/resorts` (`qa-out\audit\probe\menu-open-m390.png`).
Suggested fix: Matt picks one water page and one level of readiness. The implementation prompts should not rewrite this into new slogans. If 70 touches links, it should not delete a page. It can add the missing menu entries only after Matt says which URL is the water page.
Target: Matt.

### A-11. P2. Some images are cinematic crops. A few lose the subject.

Area: Living heroes, `.passage` stills, `.story-figure`, `.story-bleed`, room cards. Mobile more than desktop.
What is wrong, from the frames actually looked at:
- Home splash, rooms hero, story hero, back-to-nature heroes, journal card, farms wall, and the glass A-frame are full-bleed or in-margin and the subject is intact. Text on the heroes is readable and not covered by the nav. These are not broken.
- `.story-bleed` pictures are `height: 115%` (`src/components/Still.astro` lines 73–76, 100% under reduced motion). The next scroll step on `/story` is a frame of grass with the room already gone (`m390\story-s2.png`).
- `.story-figure` video/img is `min(70vh, 740px)` and `58vh` under 800 px (`global.css` lines 1869–1874 and 2207–2210), `object-fit: cover`. Home `s5` crops the tub at the bottom of a side photo. That is a cover crop, not overflow.
- `/build-your-own` still is `52vh` cover. The top frame is a good dusk composition. The next step is only the grass foreground of the same photo.
- The Stargazer card looks like a short band with no sky in `m390\rooms-s4.png`. That frame caught the window reveal before it opened. Closed windows use `clip-path: inset(49.5% 16%)` until `data-window-done` (`src/components/WindowFrame.astro` lines 18–22). The same card, after the reveal, includes the glass roof and the stars (`deep\m390\rooms-s8.png`). Image is `/film/layout-sky.webp`, focus `center 28%` (`src/lib/rooms.ts` lines 43–49). Do not recrop it.
- Back to nature flags many elements taller than 1.05× the viewport because four `LivingHero` blocks stack at about `100svh`. The frames looked composed (`m390\back-to-nature-top.png`, `back-to-nature-s2.png`). Do not shorten those heroes just to clear the harness count. Desktop hero videos a few pixels wider than 1440, with a small negative left, did not set `hOverflow`.
- Home passages, when 3D is off, are `100vh` posters with a dark veil. That is A-07, not a crop bug. The 16-step pass shows the same stills: glass is the room photo with "Two sides, clear" (`deep\m390\home-s8.png`), and the far passage opens on the poster with the ghost word Field (`deep\m390\home-s12.png`).
Evidence: paths above. `src/pages/back-to-nature.astro` lines 14–83.
Suggested fix: Prompt 63 should fix bleed and figure frames that cut the subject off once the motion has settled (the story grass-only bleed). Leave the Stargazer card, the splash film, and LivingHero full-viewport heroes that already read clearly. Check m360 as well as m390. Do not change desktop framing. Do not treat a mid-reveal window slit as a broken crop.
Target: 63.

### A-12. P2. The menu is usable. Several public pages are easy to miss.

Area: Header, menu, footer. m390 menu was opened. Desktop bar was looked at on home, rooms, and contact at 1440.
What is wrong: The desktop bar fits on one line: Rooms, Customs, Master Plan, Aura Farms, Aura H2O, Story, Get a quote, Menu. It does not wrap at 1440. Mobile menu button measured 69×44 px, `aria-expanded` became true, and focus moved to Story. Groups: The room (Story, Rooms, Customs, Build Your Own), The land (Master Plan, Aura Farms, Aura H2O, Back to nature, Journal), A note (Pre-order, FAQ, Contact). Slogan in the drawer is the approved pair. Close control is visible. `/glass`, `/resorts`, and `/water` are not in the menu or the top bar. Build Your Own is menu-only. Top nav says Aura H2O, not the Thirst Contact page. The harness followed every internal href it found on the pages and recorded zero broken links. `/rooms/the-soak` and `/api/join` 404 only when requested directly. Home has no footer, so the TODO lines appear only after the visitor leaves home.
Evidence: `qa-out\audit\probe\menu-open-m390.png`, `d1440\home-top.png`, `d1440\rooms-top.png`, `d1440\contact-top.png`. Menu script in `src/layouts/BaseLayout.astro` (Escape, Tab trap, inert). Escape and a full Tab cycle were read in source and not re-tested key by key. `summary.json` `brokenLinks` length 0.
Suggested fix: Matt decides whether Glass, Resorts, and Thirst Contact belong in the menu. 70 should not invent new labels. If a link in the finished harness is a real 404, 70 fixes that link.
Target: Matt for the map. 70 for any broken href the harness lists.

### A-13. P2. SEO strings depend on a build flag, and there is no real 404.

Area: whole site.
What is wrong:
- `astro.config.mjs` line 10 defaults `site` to `https://aurahomes.local`. This audit build's sitemap, robots, and JSON-LD use that origin. Live was built with `SITE` set, and live robots.txt is `Allow: /` plus `Sitemap: https://aurahomes.fun/sitemap-index.xml`. A future build that forgets `SITE` will publish the wrong canonicals. There is no workflow in this repo that sets `SITE`.
- Lighthouse mobile SEO is 92 on `/` and `/build-your-own` because robots.txt scored 0 with explanation "Lighthouse was unable to download a robots.txt file". Desktop home robots scored 1, and the live file is valid. Treat the mobile 92 as a throttled fetch miss, not a broken file. Do not rewrite robots.txt to chase it.
- `/builder` canonical is relative (`src/pages/builder.astro` line 8). Local JSON-LD on that stub uses `aurahomes.local`.
- Sitemap filter excludes `/builder`, `/api`, and `/dev` (`astro.config.mjs` lines 19–21). `/dev/model-check` still ships and is only `noindex`. `public/_archive` copies through and is empty. Repo-root `/_archive` does not ship.
- No `404.html` in `dist/client`. `/rooms/the-soak` is a plain "404" (`m390\rooms_the-soak-top.png`). The twelve concept rooms are not routes. Only `/rooms/hot-tub-time-machine` and `/rooms/cool-runnings` exist. Nothing in the room cards links to `/rooms/the-soak`.
- `lang` is `en`. Favicons exist (`favicon.svg`, `favicon-32.png`, `apple-touch-icon.png`). There is no web app manifest. Organization and FAQ JSON-LD are present. Many pages share a short description. Home title is "Aura Homes", which is correct for the title tag. Visible UI does not say "AURA HOMES" or "Vanguard".
Suggested fix: 70 should fail or warn a production build when `SITE` is unset, emit absolute canonicals, add a branded 404 that offers Rooms, Story, and Pre-order, and keep `/dev/model-check` out of the public upload if the deploy copies all of `dist/client`. Do not noindex real pages.
Target: 70.

### A-14. P2. Small hit targets, a covered thanks heading, and four headings whose accessible name drops a space.

Area: `/rooms` materials. `/pre-order` after submit. `/farms`, `/water`, `/glass`, `/resorts` h1.
What is wrong: The materials footnote link "1" measured 4×14 px. The SABIC LEXAN guide link measured about 555×34 px (under 44 tall) and is colored `#866243` (`src/components/Materials.astro` lines 44, 143, and 171–176). After quote submit, the sticky header covers the thanks heading. Join inputs, the menu button, ambient control, and order-choice rows meet 44 px. Lighthouse accessibility is 100 on every measured URL. That score does not cover the footnote, the covered heading, or the names below.

Four h1s are split with a `<br />` and no space between the words:

- `src/pages/farms.astro` lines 19–21: `A wall<br />that grows.`
- `src/pages/water.astro` lines 20–22: `Water<br />from the air.`
- `src/pages/glass.astro` lines 16–18: `The glass<br />comes next.`
- `src/pages/resorts.astro` lines 16–18: `A few rooms.<br />A whole stay.`

`textContent` has no character where the break was, so the strings are "A wallthat grows.", "Waterfrom the air.", "The glasscomes next.", and "A few rooms.A whole stay." SplitText is created with `aria: 'auto'` (`src/scripts/reveal-heading.ts` line 189). It copies that string into `aria-label` and marks the visible runs `aria-hidden`. A probe on the local preview at 390 px read those four labels exactly, with 8 to 10 hidden children. The painted headings still break on two lines and look correct.
Evidence: `qa-out\audit\overflow.json` small targets on d1440 `/rooms`. `qa-out\audit\probe\preorder-after-submit.png`. Probe `qa-out\scripts\probe-accname.mjs` against http://127.0.0.1:4391 on 2026-10-06.
Suggested fix: Make the footnote and the guide link at least 44 px tall, or give the superscript a larger hit box. Scroll the thanks heading clear of the fixed nav. Put a space at the end of the first line (before the `<br />`) on those four headings so the generated label has a word boundary. Keep the two-line paint. Keep the existing focus rings.
Target: 70.

### A-15. P2. The home list and the sentence under it do not belong together.

Area: `/`, section `#ways`. Seen at m390 in `home-s7.png`.
What is wrong: Item 04 is "A wood-fired tub, on the steel frame." The paragraph immediately under the list is "A bedroom under a skylight, when the night is the point." It reads as the caption of item 04. The skylight sentence belongs to the bedroom layout above.
Evidence: `src/pages/index.astro` lines 252–260. Screenshot `qa-out\audit\m390\home-s7.png`.
Suggested fix: Matt moves or rewrites the sentence. 70 should not invent a new line. Separating the lede from the list with space is a layout fix only if Matt keeps both strings.
Target: Matt.

### A-16. P3. The wordmark source says Aura. The page paints AURA.

Area: header on every page. Footer wordmark uses the same word.
What is wrong: `<span class="nav-name">Aura</span>` in `src/components/SiteHeader.astro` line 37. Footer is `<span class="foot-name">Aura</span>` in `src/layouts/BaseLayout.astro` line 174. Both classes set `text-transform: uppercase` in `global.css` lines 218–221. `textContent` is `Aura`. The harness recorded nav `"Aura"` on every real page. Every screenshot shows AURA, Cinzel, next to the ridge mark with the bronze ring. Home `h1.splash-word` is already the letters AURA. No UI string "AURA HOMES" or "Vanguard" was found in the pages looked at. Titles and JSON-LD correctly say "Aura Homes".
Suggested fix: Prompt 66 changes both source strings to `AURA` and leaves the CSS, the mark, and the layout alone.
Target: 66.

### A-17. P2. Brand-rule copy for Matt, not a rewrite in these prompts.

Must-fix leftovers are A-01, A-03, A-09, and A-15. The rest is his pass. Do not implement these in 70 unless he asks.

- Story lede brushes the retired line: "more time outside, closer to nature." `src/pages/story.astro` lines 27–31. Approved pair is "Return to Aura." with "One beautiful room at a time."
- Master plan: "it is not a promise." Disclaimer tone. `src/pages/master-plan.astro` around line 134.
- Rooms note: "Concepts shown; details evolve as we build." `src/pages/rooms.astro` line 44.
- FAQ and customs state a 40% deposit and a refund, and FAQ says permitting is not handled (`src/pages/faq.astro` lines 8–24 and 48, `src/pages/customs.astro` line 10). No dollar prices were found. The deposit is still a money term, and the permit line is a disclaimer.
- Customs H1 is "Second Breath Customs." The join note pre-fills "Custom: Second Breath." (`src/pages/customs.astro` line 23, `src/components/Join.astro` line 111). That name is not in the locked room list.
- Rooms lede "A vibrant extension of your home, in synergy with nature." is softer than the rest of the voice. Optional.
- "Escape room" as a use label reads as the game. Optional.
- No em dashes, exclamation points, crypto, wallet, charity, or space-company framing turned up in the pages reviewed. Pop-culture room names (A-Wing, Hitchhiker, Pandora) match the locked list and should stay.

Target: Matt.

### A-18. P2. Dev studio and an empty archive ship. Unknown URLs are a blank 404.

Area: `/dev/model-check`, `dist/client/_archive`, any unknown path.
What is wrong: `/dev/model-check` is a public noindex page and is absent from the sitemap. Empty `public/_archive` is copied into the upload. There is no branded 404, so a typed room slug is an unstyled "404".
Suggested fix: Keep the studio for local work. Omit it, and the empty archive, from the Pages upload. Add one branded 404. Do not build twelve empty room routes unless Matt wants detail pages. The cards already go to pre-order.
Target: 70.

## Story and flow

A first visit on a phone is the dusk film, then photographs of the room in the grass, then layouts, then two forms. The next steps exist: Rooms, Pre-order, Story, and the menu. That spine is coherent: home, story, rooms, build your own, pre-order.

What breaks the spine:

- Rooms do not have their own pages. A card's next step is "Pre-order inquiry" with `?model=`. Standalone pieces (Hot Tub Time Machine, Cool Runnings) do have pages and a "See the piece" link. That split is fine if it is intentional. It feels like two catalogs.
- Build Your Own is the same list of names again, without the live model, and it is not in the top bar.
- Master plan is the chapter spine and is careful. Farms is confident. Water is split across `/h2o` and `/water` and disagrees about cans, glass, and jugs. Glass and Resorts are "later" and are easy to miss.
- Home ends on two similar forms (hold a place, and join the list) that both fail on the static host.
- Home has no footer, so the TODO contact lines are a surprise on the second page.
- Journal is calm and in order. The index frame looked intact (`m390\journal-top.png`).

Suggested order, as notes only. Do not restructure copy in the implementation prompts.

- Keep home as film, then the room, then one next step (Rooms or Pre-order), not two failing forms.
- One water URL in the nav.
- One sentence on farms and on the master plan about what can be asked for now.
- Room cards can keep going to pre-order. Do not add detail routes just to fill `/rooms/<slug>`.

## Lighthouse BEFORE

Live https://aurahomes.fun. 6 October 2026. Simulated throttling. Mobile except the last row. JSON under `qa-out\audit\lighthouse\`.

| URL | Form | Perf | A11y | BP | SEO | LCP | TBT | CLS | Weight |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/` | mobile | 47 | 100 | 100 | 92 | 6.9 s | 2,150 ms | 0 | 19,316 KiB, 31 req |
| `/rooms` | mobile | 83 | 100 | 100 | 100 | 3.1 s | 280 ms | 0.001 | 626 KiB, 25 req |
| `/build-your-own` | mobile | 91 | 100 | 100 | 92 | 2.9 s | 10 ms | 0 | 443 KiB, 20 req |
| `/story` | mobile | 91 | 100 | 100 | 100 | 2.4 s | 270 ms | 0.071 | 403 KiB, 20 req |
| `/contact` | mobile | 81 | 100 | 100 | 100 | 2.5 s | 610 ms | 0.066 | 213 KiB, 14 req |
| `/pre-order` | mobile | 96 | 100 | 100 | 100 | 2.1 s | 20 ms | 0 | 214 KiB, 14 req |
| `/` | desktop | 90 | 100 | 96 | 100 | 1.2 s | 230 ms | 0 | 15,490 KiB, 56 req |

Notes:

- Home mobile opportunities: offscreen images about 750 ms, unused JS about 150 ms. The film dominates. Top requests: film 17,800 KiB (206), poster 262 KiB, then layout webps.
- Home desktop also downloads the film (11,753 KiB, 206) and, because 3D is on, water normals and ground textures (about 260–430 KiB each) plus `stage.js` and `loaders.js`. Best practices 96 is the nine custom-model 404s (A-08).
- `/rooms` mobile: DOM about 1,212 elements. Responsive-image savings called at about 251 KiB.
- `/build-your-own` mobile does not download a GLB. It does download `mount.js` (~72 KiB), `three.core` (~68 KiB), and `client.js` (~67 KiB), plus `story-meadow-side.webp` (~58 KiB). Prioritize-LCP-image about 360 ms. SEO 92 is the same robots fetch miss as home.
- `/story` CLS 0.071 and `/contact` CLS 0.066 are the only layout-shift scores above zero worth a look. Contact main-thread work is about 4.4 s.
- Accessibility 100 is the automated score. A-14 is outside it.

Files: `before-home.json`, `before-rooms.json`, `before-build-your-own.json`, `before-story.json`, `before-contact.json`, `before-pre-order.json`, `before-home-desktop.json`.

## Heaviest shipped assets

`dist/client` after this build. Totals by type are approximate: GLB 139.5 MB (53 files), MP4 134.7 MB (26), KTX2 43.6 MB, HDR 37.3 MB, WebP 27.9 MB, WebM 20.9 MB, AVIF 19.8 MB, JPG 11.3 MB, MP3 6.5 MB, JS 3.4 MB.

| File | Size | Who fetches it |
| --- | --- | --- |
| `models/pine_sapling_medium.glb` | 59.07 MB | Nobody at runtime. Credits and the fetch catalog only. |
| `models/pine_sapling_medium.lod1.glb` | 36.18 MB | Same. |
| `models/pine_sapling_medium.lod2.glb` | 16.66 MB | Same. |
| `film/cabin-dusk-hi.mp4` | 40.67 MB | Home, all viewports, `preload=auto`. Mobile LH transferred ~17.8 MB as 206. |
| `film/forest-ambience.mp3` | 6.50 MB | Ambient button, `preload=none`. Not in the Lighthouse top requests. |
| `hdri/*_2k.hdr` | 4.4–6.5 MB each | Desktop meadow path. `alps_field_2k.hdr` is 6.23 MB via `golden-sky.ts`. |
| `hdri/*_1k.hdr` | 1.11–1.62 MB | One per passage scene if 3D mounts. |
| `film/scroll/*.mp4` | about 4–6 MB each | Story-figure videos, `preload=none`, attached as the scroll plays. |
| `textures/forrest_ground_01/nor_gl.ktx2` | 5.05 MB | Ground, if a meadow mounts. |
| Meadow tree GLBs, 18 files | 1.23 MB total | Grove, three LODs × six names. Small. |
| Props `tree_stump_01`, `dandelion_01`, `rock_moss_set_01`, `fern_02` | 0.69–1.81 MB each | Grove props, loaded with the meadow. |
| JS `draco_decoder`, `loaders`, `stage`, `three.core`, `mount`, `client` | 0.69, 0.48, 0.32, 0.25, 0.22, 0.21 MB | Desktop home and, in part, `/build-your-own` even when the view is a still. |

Phones today do not fetch HDRIs, KTX2, or GLBs on home, because the quality tier is off. `/build-your-own` on a phone still parses a slice of Three.js for a static image.

## Mobile 3D enablement (prompts 64 and 65)

What a phone sees today: still posters, class `is-still`, one shared photograph for grass and far. Not a blank canvas, and not a WebGL context.

What must be touched if 3D turns on for phones:

- `src/three/quality.ts` `forcedOff()` (width and coarse pointer). A separate mobile tier is safer than deleting the gate.
- `src/pages/index.astro` `ensureScenes()` (lines 306–316). It bails when the tier is off, and when it runs it mounts every passage at once. This file is protected. Desktop scrub and desktop passages must stay identical. Say so in the implementation diff.
- `src/scripts/meadow.ts` `mountMeadow()` and the LOOK table.
- `src/three/meadow-v1/world.ts`, `grove.ts` (all three LODs plus props), `golden-sky.ts` (the 2k HDRI).
- `src/three/loaders.ts` (DRACO, KTX2, Meshopt).
- `src/three/custom-models.ts` HEAD probes, or the console fills with A-08 the moment 3D starts.
- `src/builder/OrderForm.tsx` `liveNow()` still requires 1024 px and a fine pointer even if the quality tier allows a phone. 62 and 64 have to move together if the builder should be live on a phone.
- `scripts/optimize-3d.mjs` writes lod1 and lod2 and refuses a file over 25 MB (`LIMIT` at line 41). The sapling was not brought under that limit. It is also the wrong file to optimize for these scenes.

Realistic download if a phone mounted one grass passage the way desktop does:

- 1k HDRI ~1.6 MB, plus `alps_field_2k.hdr` 6.23 MB if the golden sky path stays.
- Ground KTX2 normal alone ~5 MB, plus grass JPGs.
- Trees ~1.2 MB for all 18 LOD files. Props several MB more (stump 1.81, rock 1.40, dandelion 1.42, fern 0.69).
- JS over 2 MB parsed (three, loaders, draco, stage, world, meadow).
- Glass, steam, and far add an Aura unit and/or the hot tub and a second HDRI. Home would boot four worlds.

A sane phone budget is one visible passage, lod2 only, one 1k HDRI, no 2k sky, no prop over a couple hundred KB, and a branded preloader before the first frame. Do not mount four contexts.

Risks: phone WebGL memory, ScrollTrigger pins fighting Lenis and the film scrub (do not retune the scrub), and Lighthouse TBT. Mobile home is already 2.15 s of blocking time before any 3D. Desktop home TBT is 230 ms with 3D on. Turning the current scenes on for phones will miss the performance budget. `prefers-reduced-motion` must keep the still.

The sapling files (~112 MB combined) are dead weight in the upload. Recommend Matt move them to `/_archive` in a later pass. Do not delete them. Do not plan the mobile scenes around them.

## Open items for Matt

- Real email, phone, and YouTube URL. Prompts must not invent them. (A-03)
- Form provider for quote, hold-your-place, and the list (Formspree, mailto, or something else). Until then, no success copy. (A-01, A-02)
- Cabin film weight. Recommendation above. Do not edit the file or the scrub in these prompts. (A-04)
- Whether unused `pine_sapling_medium*.glb` should leave `public/models` for `/_archive`. (A-07)
- One water page, and how sure the farms and host-network lines should sound. (A-10)
- The missing roof still for Thirst Contact. (A-09)
- Whether "Second Breath" stays as the customs name. (A-17)
- Whether Glass, Resorts, and `/water` belong in the menu. (A-12)
- Deposit, refund, and permit sentences in the FAQ. (A-17)

## Copy suggestions for Matt

Optional. Not for the implementation prompts.

- Story hero: bring it back to "Return to Aura." and "One beautiful room at a time." The current lede reaches for the retired "outside" line.
- Home `#ways`: the skylight sentence should not sit under the tub item.
- Master plan chapter 4: drop "it is not a promise." Say what the network is for, in the same calm voice as the rest of the plan.
- Rooms note "Concepts shown" and FAQ "Not yet" / "We don't handle permitting" fight the positive voice. He can keep the facts and lose the disclaimer shape.
- `/h2o` cans-and-glass versus `/water` plastic jugs. Pick one picture of the water.
- Farms "You can buy it" is more certain than the master plan. Align them.
- "Second Breath" either becomes a real customs name everywhere or leaves the join placeholder.
- Rooms lede "vibrant" / "synergy" is the softest sentence on that page.
- Journal title "What we are building, and what we hope." is a little unfinished. The page itself reads well.
- "Portrait to come" on the story founder is an intentional empty frame. It is the same family as "Shot to come." His call.

Locked room names in the builder and on `/rooms` already match the list, including Thirst Contact as the water unit. No dollar prices, crypto, charity, or "Vanguard" in the UI that was reviewed.

## What prompt 70 should fix

70 is the general repair pass. It should not restyle the site, rewrite Matt's copy, enable mobile 3D, or touch the cabin film.

1. Stop the quote-form false success (A-01). Share contact's honest path until a real action exists.
2. Clip the heading glow so scroll width matches the viewport at 1440 and at 390 (A-05). Leave mist, grain, and the honeypot alone.
3. Stop the nine custom-model HEAD 404s (A-08).
4. Branded 404. Do not add empty `/rooms/<concept>` pages.
5. Production build must set `SITE`, and `/builder` canonical must be absolute (A-13).
6. Footnote and SABIC link hit areas, the thanks heading clear of the sticky nav, and a space before the `<br />` on the four split h1s so the aria-label is not "A wallthat grows." (A-14).
7. Order-choice dot alignment if 62 has not already done it (A-06).
8. Omit `/dev/model-check` and the empty `_archive` from the public upload, or noindex plus a deploy exclude (A-18).
9. Internal 404s listed in `summary.json` `brokenLinks`. The finished main pass (96 pages) and the deep pass (12 pages) both have `brokenLinks` length 0. Nothing to change here. `/rooms/the-soak` and `/api/join` 404 only when requested directly.
10. Do not rewrite robots.txt because of the mobile Lighthouse robots miss.

Leave for the other prompts: 62 builder on a phone, 63 the crops that lose a subject, 64 and 65 mobile scenes and their budget, 66 the source string AURA, 67 `/api/join`, 68 the TODO contact lines once Matt supplies them.

## Screenshot index

Most telling frames. All under `C:\Users\lucid\Desktop\Aura-Audit-Oct6\qa-out\audit\`.

- `m390\home-top.png` Cabin film, wordmark AURA, nav fits.
- `m390\home-s4.png` Glass passage still, copy on the photo, readable.
- `m390\home-s6.png` Far passage starting, ghost word Field.
- `m390\home-s7.png` Item 04 and the skylight sentence.
- `m390\home-s8.png` Both join forms.
- `m390\story-top.png` Story hero, composed.
- `m390\story-s2.png` Bleed reduced to grass.
- `m390\rooms-top.png` Rooms hero, composed.
- `m390\rooms-s4.png` Stargazer mid-reveal slit. `deep\m390\rooms-s8.png` is the same card open, stars in frame.
- `m390\rooms_the-soak-top.png` Bare 404.
- `m390\build-your-own-top.png` and `build-your-own-s2.png`, `s3.png`, `s5.png` Phone builder: photo, then a wrapping text list.
- `m390\builder-top.png` Same page after the redirect.
- `m390\water-top.png` and `water-s1.png` Shot to come.
- `m390\h2o-top.png` The other water page.
- `m390\farms-top.png` Confident farms line, image intact.
- `m390\master-plan-top.png` Plan, told slowly.
- `m390\back-to-nature-top.png` Full-bleed hero, text clear.
- `m390\journal-top.png` Journal index.
- `probe\menu-open-m390.png` Open menu.
- `probe\preorder-after-submit.png` False success, footer TODO, heading under the nav.
- `probe\contact-top.png` Contact form before the TODO block.

## Harness rollup

Finished. Main pass `qa-out\audit\summary.json` at 2026-10-07T03:45:04Z. Base http://127.0.0.1:4391. 32 routes × 3 viewports = 96 pages. `brokenLinks` length 0. Deep pass `qa-out\audit\deep\summary.json` at 2026-10-07T04:36:03Z. Routes `/`, `/story`, `/rooms`, `/master-plan`, `/build-your-own`, `/back-to-nature` at m390 and d1440, 16 steps. 12 pages. `brokenLinks` length 0. The deep pass did not add a new P0 or P1.

`hOverflow` is exactly 1494 on d1440, and only on these 14 routes: `/`, `/rooms`, `/customs`, `/master-plan`, `/farms`, `/h2o`, `/water`, `/glass`, `/resorts`, `/pre-order`, `/faq`, `/contact`, `/credits`, `/dev/model-check`. It is not set on `/story`, the journal pages, `/build-your-own`, the two room detail pages, or `/back-to-nature`. Phone `hOverflow` is 0 on every route because the harness compares to `window.innerWidth` (414 in the iPhone emulation) while `clientWidth` is 390. That does not clear A-05.

Real failures, not cancelled media:

- `/rooms/the-soak` is a document 404 on every viewport. Bare "404". No page links to it.
- `/api/join` is a document 404 on every viewport.
- `/dev/model-check` requests `models/custom/aura-unit.glb` plus `.lod1` and `.lod2`. Each is a 404. Final URL keeps `?model=aura-unit`.

Cancelled requests (`net::ERR_ABORTED`), files present:

- LivingHero webms aborted while scrolling. `/glass` repeats `deck.webm` and `tower.webm`. `/resorts` does the same. `/story` aborts `hero-meadow.webm`. `/rooms` aborts `hero-room.webm`. The two room pages and `/back-to-nature` abort their hero webms. `/farms` aborts `farm-wall` and `farm-room`. `/water` aborts `water-line.webm`.
- m360 home aborts four scroll films: `/film/scroll/meadow-side.mp4`, `door.mp4`, `night.mp4`, `gazebo.mp4`. The deep m390 home pass aborted `door.mp4` and `gazebo.mp4`. These are the scrub films, not missing files.
- `/builder` on every viewport aborts `RevealHeading.astro_astro_type_script_index_0_lang.*.js` because `location.replace` leaves for `/build-your-own/`. Status stays 200.

`bigMedia` is tall composed heroes, not a sideways blowout. m390 and m360 `/back-to-nature` count 24 (pictures about 390×1192 and 390×1018). d1440 `/story` counts 9, including a hero video a few pixels wider than 1440. d1440 `/master-plan` counts 13 stills whose left edge is largely negative after they have scrolled off. d1440 `/back-to-nature` counts 28. Leave them (A-11).

`todo` is the footer on almost every page that is not home. `/story` has three hits (YouTube line plus footer). `/contact` has five (page email, phone, and link, plus footer). Home has no footer, so the phone home runs are the ones with no todo flag.

`nav` textContent is `Aura` on every real page. h1 text matches the visible title except the four split headings in A-14. `/rooms/the-soak` and `/api/join` have a null nav and an empty h1 because they are the bare 404 document.

The nine custom-model HEAD 404s on desktop home (A-08) did not appear in this harness log. Lighthouse desktop and the overflow probe did record them. Do not drop A-08.
