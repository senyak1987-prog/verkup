import * as THREE from 'three';
import type { RcPhysics, CarInput } from './physics';
import type { RcSurface } from './terrainSurface';

/** Fixed GPU pool: dust originates at loaded tyre contacts on sand, never in mid-air. */
export function createVehicleEffects(parent: THREE.Group, chassis: THREE.Group, physics: RcPhysics, surface: RcSurface) {
  const capacity = 384, positions = new Float32Array(capacity * 3), sizes = new Float32Array(capacity);
  const alphas = new Float32Array(capacity), life = new Float32Array(capacity), velocity = new Float32Array(capacity * 3);
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('puffSize', new THREE.BufferAttribute(sizes, 1)); geometry.setAttribute('puffAlpha', new THREE.BufferAttribute(alphas, 1));
  const material = new THREE.ShaderMaterial({ transparent: true, depthWrite: false,
    uniforms: { viewportHeight: { value: 800 }, dustColor: { value: new THREE.Color('#ead3a8') } },
    vertexShader: `attribute float puffSize; attribute float puffAlpha; uniform float viewportHeight; varying float alpha;
      void main(){ vec4 point=modelViewMatrix*vec4(position,1.); gl_Position=projectionMatrix*point;
        float scale=length(modelMatrix[0].xyz); float perspective=projectionMatrix[2][3]==-1.?1./max(.1,-point.z):1.;
        gl_PointSize=clamp(puffSize*scale*viewportHeight*projectionMatrix[1][1]*.5*perspective,1.,100.); alpha=puffAlpha; }`,
    fragmentShader: `uniform vec3 dustColor; varying float alpha;
      void main(){ float r=length(gl_PointCoord-.5)*2.; float edge=1.-smoothstep(.12,1.,r);
        float grain=.85+.15*sin(gl_PointCoord.x*33.+gl_PointCoord.y*47.); gl_FragColor=vec4(dustColor,alpha*edge*grain);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const dust = new THREE.Points(geometry, material); dust.name = 'rc-wheel-dust'; dust.frustumCulled = false; parent.add(dust);
  const viewport = new THREE.Vector2();
  dust.onBeforeRender = renderer => { renderer.getDrawingBufferSize(viewport); material.uniforms.viewportHeight.value = viewport.y; };
  let cursor = 0, emission = 0, night = 0;
  const wheelPoint = new THREE.Vector3(), tilt = new THREE.Euler(), up = new THREE.Vector3(0, 1, 0);
  const modelScale = physics.vehicle.wheelBase / 1.2428678456967728;
  const spots: THREE.SpotLight[] = [], rearLights: THREE.PointLight[] = [];
  for (const side of [-1, 1]) {
    const light = new THREE.SpotLight('#ecf7ff', 16, 10, Math.PI / 7, .55, 2);
    light.name = `rc-headlight-${side}`; light.position.set(side * physics.vehicle.halfWidth * .70, -.055 * modelScale, physics.vehicle.halfLength * .88);
    const target = new THREE.Object3D(); target.position.set(side * physics.vehicle.halfWidth * .70, -physics.vehicle.bodyRestHeight + .10, physics.vehicle.halfLength + 6);
    chassis.add(light, target); light.target = target; spots.push(light);
    const tail = new THREE.PointLight('#ff3320', 1, 1.8, 2); tail.name = `rc-tail-light-${side}`;
    tail.position.set(side * physics.vehicle.halfWidth * .76, -.065 * modelScale, -physics.vehicle.halfLength * .9); chassis.add(tail); rearLights.push(tail);
  }
  const setLightPowers = (brake: boolean) => {
    const scale = parent.getWorldScale(wheelPoint).x;
    spots.forEach(light => { light.intensity = (4 + night * 34) * scale * scale; light.distance = 11 * scale; });
    rearLights.forEach(light => { light.intensity = (brake ? 2.2 : .35) * scale * scale; light.distance = .95 * scale; });
  };
  return {
    setLighting(value: number) { night = THREE.MathUtils.clamp(value, 0, 1); material.uniforms.dustColor.value.set(night > .5 ? '#817666' : '#ead3a8'); setLightPowers(false); },
    step(dt: number, input: CarInput) {
      const state = physics.state, speed = Math.hypot(state.vx,state.vz);
      for (let i = 0; i < capacity; i++) {
        if (life[i] <= 0) continue;
        life[i] = Math.max(0, life[i] - dt); const p = i * 3;
        positions[p] += velocity[p] * dt; positions[p + 1] += velocity[p + 1] * dt; positions[p + 2] += velocity[p + 2] * dt;
        velocity[p + 1] *= Math.exp(-dt * 1.8); sizes[i] += dt * .85; alphas[i] = Math.min(.34, life[i] * .48);
      }
      emission += Math.min(12, speed) * dt * (input.handbrake || Math.abs(state.slipAngle??0)>.15 ? 6 : 4);
      if (speed > .7 && emission >= 1) {
        const repeats = Math.min(3, Math.floor(emission)); emission -= repeats;
        tilt.set(state.pitch, 0, state.roll);
        for (let repeat = 0; repeat < repeats; repeat++) for (const wheel of state.wheels) {
          if (!wheel.contact) continue;
          wheelPoint.set(wheel.x, wheel.height, wheel.z).applyEuler(tilt).applyAxisAngle(up, state.yaw);
          const x = state.x + wheelPoint.x, z = state.z + wheelPoint.z;
          if ((surface.groundKind?.(x, z) ?? 'sand') !== 'sand') continue;
          const index = cursor++ % capacity, p = index * 3;
          life[index] = .9 + Math.random() * .5; sizes[index] = .18 + Math.random() * .18;
          positions[p] = x; positions[p + 1] = surface.height(x, z) + .03; positions[p + 2] = z;
          velocity[p] = -state.vx * .28 + (Math.random() - .5) * .9;
          velocity[p + 1] = .7 + Math.random() * .7; velocity[p + 2] = -state.vz * .28 + (Math.random() - .5) * .9;
        }
      } else if (speed <= .7) emission = 0;
    },
    render(input: CarInput) { geometry.attributes.position.needsUpdate = geometry.attributes.puffSize.needsUpdate = geometry.attributes.puffAlpha.needsUpdate = true; setLightPowers(input.brake||!!input.handbrake); },
    reset() { life.fill(0); alphas.fill(0); emission = cursor = 0; geometry.attributes.puffAlpha.needsUpdate = true; },
  };
}
