# Models used in the sign configurator

## RAM TRX

`ram-trx.glb` is adapted from [Dodge RAM 1500 TRX](https://sketchfab.com/3d-models/dodge-ram-1500-trx-d6d548c5fe9f4749813f0a386edfd42c) by [DR1KING100K](https://sketchfab.com/DR1KING100K), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The original has 498,000 triangles; this derivative has 99,812. The original license and full credit are in `ram-trx-license.txt` and `ram-trx-attribution.txt`.

Changes: baked transforms, uniform normalization to a two-metre RC vehicle, normal-aware decimation, material consolidation, removal of redundant UV channels, four independent wheel rotors. `src/rc-game/trxAsset.ts` adds PBR paint/rubber/glass/lighting materials and projected Gorod Svet logos at runtime. The bundled GLB retains named source materials for these finishes. Measured dimensions are in `ram-trx-info.json` and `trxAssetProfile.ts`.

The real model is used by both the standalone game and facade game. Keep the credit when embedding the game elsewhere; the default interfaces display author, source and license links.

## Facade scale character

The character uses the ready-made **Superhero Male** mesh by **Quaternius**, Universal Base Characters (Standard), released under **CC0 1.0**. Original pack and license: https://quaternius.com/packs/universalbasecharacters.html

The source mesh is `Base Characters/Godot - UE/Superhero_Male_FullBody.gltf`. Its image-free GLB packaging was obtained from https://github.com/programasweights/avatar/blob/main/public/assets/character.glb ; source SHA-256: `d6f3b64cab629f6ddca9ba063811aeffd3663a8a4e49ade47cd9505dc2bbd70f`.

`QUATERNIUS-LICENSE.txt` preserves the author's license. This is a generic superhero, not an official Superman model.

The bundled `gorod-svet-hero.glb` retains the authored body, face and hands and adds the author's `Hair_SimpleParted` hairstyle from the free Standard pack (`Hairstyles/Origin at 0/glTF (Godot)`). It poses the arms at rest, applies two Loop subdivisions, adds suit vertex colours and scales the actual hair-crown-to-ground height to 1750 mm. The renderer provides restrained standing breathing and a pinned, gently moving cape. The site's own Gorod Svet logo is baked into the opaque cloth texture, so there is no separate intersecting decal. Reduced-motion preferences stop the animation; hidden or off-screen previews stop rendering it.

Rebuild with `node scripts/prepare-scale-person.mjs <character.glb> <Hair_SimpleParted.gltf>`, keeping the original adjacent `Hair_SimpleParted.bin` alongside the hairstyle. Obtain the Standard pack from the author's official page linked above. No advertising tagline is included.

Reproduce the static model without Blender:

```
node scripts/prepare-scale-person.mjs path/to/character.glb
```

The GLB is loaded lazily for facade previews, cached once, and each scene receives independently disposable geometries and materials. No asset-library connection or rig animation is needed at runtime.
