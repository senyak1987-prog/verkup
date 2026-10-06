import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Group } from 'three';

let cached: Promise<Group> | undefined;
/** The static CC0 character loads once, only when a facade is requested. Instances own their resources. */
export function loadScalePersonModel(baseUrl:string):Promise<Group> {
  cached ??= new GLTFLoader().loadAsync(baseUrl+'models/gorod-svet-hero.glb').then(gltf=>gltf.scene)
    .catch(error=>{cached=undefined;throw error;});
  return cached!;
}
