import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Group } from 'three';

let cached: Promise<Group> | undefined;
/** The authored CC0 body and parted hair load once; standing motion is applied by the facade. */
export function loadScalePersonModel(baseUrl:string):Promise<Group> {
  cached ??= new GLTFLoader().loadAsync(baseUrl+'models/gorod-svet-hero.glb?v=hair-idle-20261007').then(gltf=>gltf.scene)
    .catch(error=>{cached=undefined;throw error;});
  return cached!;
}
