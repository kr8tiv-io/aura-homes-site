# 3D assets

The site serves only the compressed files. Raw downloads stay in `assets-src/` and never go to the browser as-is.

## Folders

- `assets-src/models/`: one folder per model. Raw glTF, the `.bin`, and the original maps.
- `assets-src/textures/`: raw png and jpeg maps, one folder per material.
- `assets-src/hdri/`: raw `.hdr` files. 1k is for environment lighting. 2k is for a visible backdrop.
- `assets-src/SOURCES.md`: every download URL. If a file is over 25 MB, this note is the record and the file stays out of git.
- `assets-src/catalog.json`: names, authors, and sizes from the Poly Haven API.
- `public/models/`: `<name>.glb`, `<name>.lod1.glb` (half the vertices), and `<name>.lod2.glb` (15 percent of the vertices). Meshopt geometry. Normal maps are UASTC. Colour maps are ETC1S. Nothing is larger than 2048 px.
- `public/textures/`: the same maps as `.ktx2`.
- `public/hdri/`: the `.hdr` files, copied across.
- `public/decoders/draco/` and `public/decoders/basis/`: the Draco decoder and the Basis transcoder, copied from the installed `three` package.
- `src/three/loaders.ts`: one `GLTFLoader`, one `LoadingManager`, and a cache. Call `configureRenderer(renderer)` before the first KTX2 model.

## Commands

`npm run assets` runs `scripts/optimize-3d.mjs`.

`node scripts/fetch-cc0.mjs` downloads the CC0 set again. Files that are already the right size are left in place.

KTX2 encoding needs KTX-Software 4.4 or newer. Put `ktx` on `PATH`, or unpack it under `tools/ktx-software/` (that folder is not committed).

https://github.com/KhronosGroup/KTX-Software/releases

## Rule

Nothing enters public/models, public/hdri or public/textures without a credits entry.

Add the entry in `src/data/credits.ts` in the same commit, including a `files` array that names each new file. `npm run build` warns when a file in those folders is missing from that list. The warning does not fail the build. A file over 25 MB is not committed. Its URL belongs in `assets-src/SOURCES.md`.

The pine sapling's raw `.bin` is 251 MB, so it is not in git. The optimized full mesh and LOD1 are also over 25 MB and stay local. LOD2 is committed. Re-download the raw file from the URL in `SOURCES.md`, then run `npm run assets`, to rebuild the larger LODs.
