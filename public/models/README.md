# Facade scale character

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
