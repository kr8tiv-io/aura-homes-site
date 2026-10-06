# Builder

Phase 1 is an order form on the ported home document. The twelve rooms start from the glass plans. Size, glass, and add-ons write back into that same document. Undo, the local autosave, and the share link stay with it.

The live picture, on a desktop with motion and a medium quality tier or above, is the ported geometry inside the shared meadow. `ui/orderScene.ts` and `ui/placeHome.ts` place it. `ui/Viewport.tsx` is the old canvas and is not mounted, so the page keeps one WebGL context.

`BuilderDocument`, the fixture placement types, and the split between the plan and the 3D view stay intact for a later drag-around builder.

## Phase 2

Drag placement comes back from the old repo, `kr8tiv-ai/aura-homes`:

- `Plan2D.tsx` draws the plan and receives a drop.
- `OpeningHandles.tsx` moves doors and windows along a wall.
- `GraphPlanEditor.tsx` edits a building graph in plan.
- `FixturePalette` drag, already in `ui/FixturePalette.tsx`, places a fixture from the palette. It is not mounted in Phase 1.

## Left out

Exporters (DXF, IFC, PDF, semantic, pro), drawing sheets, copilot, the comfort solver, guidance, scenarios, variations, land and site as a feature, contributed models, and every price table. Wallet and chain code were not brought across. The document hash is SHA-256.
