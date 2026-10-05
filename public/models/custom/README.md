# Custom models

Drop a model in this folder and the site uses it in place of the procedural one. No code change. If the file is missing, the procedural model stays.

- `aura-unit.glb` replaces the polycarbonate room. Length is scaled to 6 m.
- `hot-tub.glb` replaces the cedar tub. Width is scaled to 1.8 m.
- `gazebo.glb` replaces the clear shelter over the tub. The larger footprint side is scaled to 3 m.
- `a-frame.glb` is reserved for the later builder. Length is scaled to 6 m, the same ground the room stands on. No page shows it yet.

After `npm run assets`, the same names may also exist as `name.lod1.glb` and `name.lod2.glb`. A strong machine prefers the full file, then lod1, then lod2. A lighter machine prefers the smaller file and falls back toward the full one.

## How to build the file

- Y-up, in metres.
- Origin at the ground centre.
- Facing +Z. Length runs along +Z. Width runs along +X.
- Name glass meshes or their materials with `polycarbonate` or `glass`. Those panes use the site polycarbonate.
- Name water meshes or their materials with `water`. That surface uses the tub water.
- A cedar, wood, oak, timber, steel, metal, or iron material with no texture receives the site cedar or steel maps. A material that already has a texture is left as you authored it.
- Keep the result under about 8 MB. Colour and data maps should stay at or under 2048 px. `npm run assets` resizes maps to that edge while it writes the lods.

Then run:

```
npm run assets
```

That command optimizes a `.glb` dropped here and writes `name.glb`, `name.lod1.glb`, and `name.lod2.glb` beside it. It skips files that are already lods. KTX-Software 4.4 or newer has to be on PATH, or unpacked under `tools/ktx-software`. See `docs/3D-ASSETS.md`.

Reload the page after the files are in place. The studio view is `/dev/model-check`.

## License

Before you publish a model from an AI tool, read that tool's terms and keep the licence with the file.

Tripo3D free-tier models are public and non-commercial. Commercial use needs a paid plan. https://www.tripo3d.ai

Triple 3D says commercial use depends on its terms. https://triple3d.ai

A model you make in Blender is yours to licence.

Add a sidecar next to the model so `/credits` stays complete. The page lists it only when a `.glb` for that slot is actually present.

`aura-unit.json`

```json
{
  "name": "Aura unit",
  "author": "Your name",
  "tool": "Blender",
  "license": "All rights reserved",
  "link": "https://example.com"
}
```

Use the same file stem for the other slots: `hot-tub.json`, `gazebo.json`, `a-frame.json`. `tool` is Blender, Tripo3D, Triple 3D, or whatever you used. `name`, `author`, `license`, and `link` are required.
