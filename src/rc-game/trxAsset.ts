import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { brandLivery } from './trxTruck';
import type { RcVehicleRig } from './vehicleTypes';

const GOLD = '#e8bc45';
const GREEN = '#173e31';
const WHEEL_NAMES = ['WHEEL_RF', 'WHEEL_LF', 'WHEEL_RR', 'WHEEL_LR'] as const;
const templates = new Map<string, Promise<THREE.Group>>();

/** Decimation left a few skinny triangles facing against their authored normals.
 * Correct their winding, then rebuild smooth normals with preserved hard creases.
 * Geometry, UVs and triangle count stay intact; repair is cached before cloning.
 */
function repairSurface(geometry: THREE.BufferGeometry) {
  const p = geometry.attributes.position, n = geometry.attributes.normal, ix = geometry.index;
  if (!ix || !n) return geometry;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), normal = new THREE.Vector3();
  let repaired = 0;
  for (let i = 0; i < ix.count; i += 3) {
    const ia = ix.getX(i), ib = ix.getX(i + 1), ic = ix.getX(i + 2);
    a.fromBufferAttribute(p, ia); b.fromBufferAttribute(p, ib).sub(a); c.fromBufferAttribute(p, ic).sub(a);
    normal.set(n.getX(ia) + n.getX(ib) + n.getX(ic), n.getY(ia) + n.getY(ib) + n.getY(ic), n.getZ(ia) + n.getZ(ib) + n.getZ(ic));
    if (b.cross(c).dot(normal) < 0) { ix.setX(i + 1, ic); ix.setX(i + 2, ib); repaired++; }
  }
  const fixed = toCreasedNormals(geometry, Math.PI / 3);
  fixed.userData.repairedWinding = repaired;
  fixed.computeBoundingBox(); fixed.computeBoundingSphere();
  geometry.dispose();
  return fixed;
}

/** Failed loads are retryable; the cached original never enters a disposable world. */
function loadTemplate(url: string): Promise<THREE.Group> {
  const existing = templates.get(url);
  if (existing) return existing;
  const pending = new GLTFLoader().loadAsync(url).then(gltf => {
    if (!gltf.scene.getObjectByName('BODY') || WHEEL_NAMES.some(name => !gltf.scene.getObjectByName(name))) {
      throw new Error('RAM TRX asset has no prepared body or four independent wheel rotors.');
    }
    gltf.scene.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh) mesh.geometry = repairSurface(mesh.geometry);
    });
    return gltf.scene;
  }).catch(error => {
    if (templates.get(url) === pending) templates.delete(url);
    throw error;
  });
  templates.set(url, pending);
  return pending;
}

/** The downloaded source has untextured grey materials, named by physical finish. */
function finish(name: string): THREE.MeshStandardMaterial {
  const side = THREE.FrontSide;
  const standard = (color: string, roughness = .6, metalness = 0) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness, side });
  let result: THREE.MeshStandardMaterial;
  if (name === 'x3_null__PAINT_1') {
    result = new THREE.MeshPhysicalMaterial({ color: GOLD, roughness: .36, metalness: .22,
      clearcoat: .72, clearcoatRoughness: .24, envMapIntensity: .8, side });
  } else if (name === 'x3_null__PAINT_2') {
    result = new THREE.MeshPhysicalMaterial({ color: GREEN, roughness: .46, metalness: .05,
      clearcoat: .45, clearcoatRoughness: .28, side });
  } else if (name === 'x3_wheel') {
    result = standard('#171b1c', .94);
  } else if (name === 'x3_wheel__PAINT_4') {
    result = standard('#263332', .28, .8);
  } else if (name === 'rxx_trx_graymet') {
    result = standard('#5f6c6d', .31, .85);
  } else if (name === 'rxx_trx_silvercaps' || name === 'x3_wheeldisk') {
    result = standard(name === 'x3_wheeldisk' ? '#697779' : '#bcc6c1', .3, .88);
  } else if (['toner_ext', 'int_toner', 'int_lob', 'x3_gls30', 'x3_gls60'].includes(name)) {
    result = new THREE.MeshPhysicalMaterial({ color: '#18252c', roughness: .16, metalness: 0,
      clearcoat: 1, clearcoatRoughness: .10, envMapIntensity: 1.15, side: THREE.DoubleSide });
  } else if (name === 'preded_steklo_far') {
    // Physical transmission renders after opaque reflectors. This keeps LEDs
    // visible through the lens without sorting overlapping transparent shells.
    result = new THREE.MeshPhysicalMaterial({ color: '#e4ebef', roughness: .12, metalness: 0,
      transmission: .92, thickness: .006, ior: 1.46, clearcoat: 1, clearcoatRoughness: .1, side });
  } else if (name === 'zad_steklo_far') {
    result = standard('#a51f29', .19, .15);
    result.emissive.set('#8b1020'); result.emissiveIntensity = .65;
  } else if (name === 'fara_pered_white' || name === 'fara_pered_white_poloski') {
    result = standard('#e2f2ef', .2, .1);
    result.emissive.set('#e8f3ff'); result.emissiveIntensity = 1.1;
  } else if (name === 'fara_pered_orange' || name === 'fara_pered_pov') {
    result = standard('#e59931', .27, .1);
    result.emissive.set('#d97415'); result.emissiveIntensity = .15;
  } else if (name === 'red_kapot') {
    result = standard('#be3338', .45, .1);
  } else if (name === 'black_mat_kyzov' || name === 'grey_plastik_pered') {
    result = standard(GREEN, .55, .1);
  } else if (/xleather|alcantara|belt/.test(name)) {
    result = standard(name.includes('xleather02') ? '#71583f' : '#282a27', .86);
  } else if (name === 'x3_carbon') {
    result = standard('#182024', .4, .12);
  } else if (/bad0/.test(name)) {
    result = standard('#a5b1ae', .32, .78);
  } else if (name === 'x3_light01') {
    result = standard('#c5d2cd', .3, .15);
  } else if (name === 'material') {
    result = standard('#6c7875', .45, .6);
  } else {
    result = standard(name.includes('grill') ? '#152120' : '#202a27', .64, .08);
  }
  result.name = name;
  result.shadowSide=THREE.FrontSide;
  result.forceSinglePass=true;
  result.dithering=true;
  return result;
}

function resetPivot(object: THREE.Object3D) {
  object.position.set(0, 0, 0); object.quaternion.identity(); object.scale.set(1, 1, 1); object.updateMatrix();
}

function addLivery(body: THREE.Group, material: THREE.Material, meshes: THREE.Mesh[]) {
  body.updateWorldMatrix(true, true);
  const raycaster = new THREE.Raycaster();
  const decals: Array<{ name: string; origin: THREE.Vector3; direction: THREE.Vector3;
    rotation: THREE.Euler; size: THREE.Vector3 }> = [
    { name: 'door-negative-x', origin: new THREE.Vector3(-1, -.055, .20),
      direction: new THREE.Vector3(1, 0, 0), rotation: new THREE.Euler(0, -Math.PI / 2, 0),
      size: new THREE.Vector3(.38, .095, .04) },
    { name: 'door-positive-x', origin: new THREE.Vector3(1, -.055, .20),
      direction: new THREE.Vector3(-1, 0, 0), rotation: new THREE.Euler(0, Math.PI / 2, 0),
      size: new THREE.Vector3(.38, .095, .04) },
    { name: 'hood', origin: new THREE.Vector3(0, 2, .63),
      direction: new THREE.Vector3(0, -1, 0), rotation: new THREE.Euler(-Math.PI / 2, 0, 0),
      size: new THREE.Vector3(.34, .085, .045) },
  ];
  let count = 0;
  for (const decal of decals) {
    raycaster.set(decal.origin, decal.direction);
    const hit = raycaster.intersectObjects(meshes, false)[0];
    if (!hit) continue;
    // Projection wraps the label to the real door/hood surface, including its crown.
    const position = hit.point.clone();
    const label = new THREE.Group(); label.name = `rc-trx-gorod-svet-${decal.name}`;
    for (const target of meshes) {
      const geometry = new DecalGeometry(target, position, decal.rotation, decal.size);
      if (!geometry.attributes.position.count) { geometry.dispose(); continue; }
      // Do not project onto inward faces or nearby back panels. Lift each vertex
      // along its own normal so curved sheet metal cannot cut through the print.
      const positions=geometry.attributes.position, normals=geometry.attributes.normal;
      const indices:number[]=[];
      for(let i=0;i<positions.count;i+=3) {
        let facing=0;
        for(let k=0;k<3;k++) facing+=normals.getX(i+k)*decal.direction.x+normals.getY(i+k)*decal.direction.y+normals.getZ(i+k)*decal.direction.z;
        if(facing>-.65)continue;
        indices.push(i,i+1,i+2);
        for(let k=0;k<3;k++) positions.setXYZ(i+k,positions.getX(i+k)+normals.getX(i+k)*.0025,
          positions.getY(i+k)+normals.getY(i+k)*.0025,positions.getZ(i+k)+normals.getZ(i+k)*.0025);
      }
      if(!indices.length){geometry.dispose();continue;}
      geometry.setIndex(indices); positions.needsUpdate=true;
      const mesh = new THREE.Mesh(geometry, material); mesh.name = label.name + '-surface';
      mesh.castShadow = false; mesh.receiveShadow = true; mesh.renderOrder = 2; label.add(mesh);
    }
    if (label.children.length) { body.add(label); count++; }
  }
  body.userData.liveryCount = count;
}

function instantiate(template: THREE.Group): RcVehicleRig {
  const geometryCopies = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
  const materialCopies = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  const clone = (source: THREE.Object3D) => {
    const object = source.clone(true); resetPivot(object);
    object.traverse(child => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      let geometry = geometryCopies.get(mesh.geometry);
      if (!geometry) { geometry = mesh.geometry.clone(); geometryCopies.set(mesh.geometry, geometry); }
      mesh.geometry = geometry;
      const cloneMaterial = (original: THREE.Material) => {
        let material = materialCopies.get(original);
        if (!material) { material = finish(original.name); materialCopies.set(original, material); }
        return material;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(cloneMaterial) : cloneMaterial(mesh.material);
      mesh.castShadow = mesh.receiveShadow = true;
      if (/toner|gls|steklo/.test((Array.isArray(mesh.material) ? mesh.material[0] : mesh.material).name)) mesh.castShadow = false;
    });
    return object;
  };
  const body = new THREE.Group(); body.name = 'rc-trx-downloaded-body';
  body.userData.vehicle = 'Dodge RAM 1500 TRX'; body.userData.brand = 'Город Свет';
  body.userData.author = 'DR1KING100K'; body.userData.license = 'CC-BY-4.0';
  body.userData.source = 'https://sketchfab.com/3d-models/dodge-ram-1500-trx-d6d548c5fe9f4749813f0a386edfd42c';
  body.add(clone(template.getObjectByName('BODY')!));
  const rotors = WHEEL_NAMES.map(name => clone(template.getObjectByName(name)!)) as RcVehicleRig['rotors'];
  const paintMeshes: THREE.Mesh[] = [];
  body.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh && !Array.isArray(mesh.material) && mesh.material.name === 'x3_null__PAINT_1') paintMeshes.push(mesh);
  });
  const livery = brandLivery();
  addLivery(body, livery, paintMeshes);
  let disposed = false;
  return {
    body, rotors,
    setColor(hex) {
      if (disposed || !/^#[0-9a-f]{6}$/i.test(hex)) return;
      for (const material of materialCopies.values()) {
        if (material.name === 'x3_null__PAINT_1') material.color.set(hex);
      }
    },
    dispose() {
      if (disposed) return; disposed = true;
      const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
      for (const root of [body, ...rotors]) {
        root.traverse(object => {
          const mesh = object as THREE.Mesh;
          if (mesh.geometry) geometries.add(mesh.geometry);
          if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material);
        });
        root.removeFromParent(); root.clear();
      }
      materials.add(livery);
      for (const material of materials) {
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
        material.dispose();
      }
      geometries.forEach(geometry => geometry.dispose()); textures.forEach(texture => texture.dispose());
    },
  };
}

/** Callers own the asset URL and catch failures to retain the procedural fallback. */
export function createTrxAssetLoader(url: string): () => Promise<RcVehicleRig> {
  return async () => instantiate(await loadTemplate(url));
}
