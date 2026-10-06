# Facade scale character

The character uses the ready-made **Superhero Male** mesh by **Quaternius**, Universal Base Characters (Standard), released under **CC0 1.0**. Original pack and license: https://quaternius.com/packs/universalbasecharacters.html

The source mesh is `Base Characters/Godot - UE/Superhero_Male_FullBody.gltf`. Its image-free GLB packaging was obtained from https://github.com/programasweights/avatar/blob/main/public/assets/character.glb ; source SHA-256: `d6f3b64cab629f6ddca9ba063811aeffd3663a8a4e49ade47cd9505dc2bbd70f`.

`QUATERNIUS-LICENSE.txt` preserves the author's license. This is a generic superhero, not an official Superman model.

The bundled `gorod-svet-hero.glb` retains the authored body, face and hands, poses its arms at rest, applies two Loop subdivisions, adds suit vertex colours and scales the actual crown-to-ground height to 1750 mm. The cape and the site's own Gorod Svet print are attached by the renderer. No advertising tagline is included.

Reproduce the static model without Blender:

```
node scripts/prepare-scale-person.mjs path/to/character.glb
```

The GLB is loaded lazily for facade previews, cached once, and each scene receives independently disposable geometries and materials. No asset-library connection or rig animation is needed at runtime.
