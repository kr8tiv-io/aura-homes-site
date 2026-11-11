# Collection page

`/collection` is the Aura Collection catalog. It lists all 22 products from `src/data/products.json` (15 Available soon, 7 Coming after), the 10 add-on categories, the limited editions, the Someday ideas, and the A-Wing / Cloud Nine comparison. Copy comes from that file. No prices, and the only action is the waitlist.

## What the page does

- Ceremonial open: "The Collection", "Return to Aura.", "One beautiful room at a time."
- Sticky stage bar. Tabs jump to Available soon and Coming after. Chips filter by group (All, Rooms, Soaks and plunges, Sleep, Off-grid and systems, Resort). The choice lives in the URL hash. All is the default. The Stargazer is in Rooms.
- Lie Down, Skywalker is the full-width feature. The other Available soon rooms are the card grid. Coming after follows, then the comparison, Limited editions, and Someday.
- Full Solar split: "Full Solar, on every build."
- Add-on menu: 10 disclosures, 3 columns from 1000px, 1 column on a phone. Mission: Higher Ground is only the roof add-on (plain name "Roof deck, any room").
- Twenty Thousand Leagues Under The Deck is text only.
- Cards link to `/rooms/<slug>` when that page already exists (Hot Tub Time Machine, Cool Runnings). Every other card links to `/pre-order?model=<slug>`.
- The waitlist form maps a few catalog slugs onto existing room options and adds a "The collection" group for the rest.

## Files added

- `src/pages/collection.astro`
- `src/styles/collection.css`
- `src/components/CatalogCard.astro`
- `src/components/AddonMenu.astro`
- `src/data/products.ts`
- `src/data/products.json`
- `src/data/collection-images.json`
- `public/film/collection/*.webp` (1280-wide, plus one 1920 for the hot tub; narrower sources stay at their real width)

## Files changed

- `src/layouts/BaseLayout.astro`: Collection link after Rooms in the top bar and in the footer menu.
- `src/pages/pre-order.astro`: model query maps onto the existing select, with new options only where no room option exists.

## Checks

`npm run build` passes. In Chrome, `/collection` at 1440, 390, and 375 has no horizontal page scroll. Filters, stage tabs, the add-on disclosures, and image loads were exercised. Hero photos are unique. Hover cross-fades where a second photo exists.

## Open questions

- Per-product pages were left alone. The page plan's detail layout (body, features, next room, Waste of Space pull line) is not on this index.
- A few catalog lines that say "quoted" are not shown. Full Solar uses "Full Solar, on every build."
- Some `-1280.webp` files are narrower than 1280 because the source was. `srcset` uses the real pixel width from `collection-images.json`.
- On phones the site clips the document sideways, which stops `position: sticky`. This page turns that clip off so the stage bar stays put. The page itself does not overflow.
- `Join.astro` is unchanged. On this page its form is restyled for the Alabaster ground. Other pages still use the dark band.
- Filterable cards do not use `data-rise`. A rise tween was hiding cards again after a filter change.
