import * as THREE from "three";
import type { Piece } from "../model/layout.ts";

// Calm landscape around the campus: gradient sky, drifting clouds, a meadow
// that fades into haze, and low-poly trees.

export const SKY = { top: "#6f9fcb", horizon: "#e2ebee", haze: "#dde7e6" };
const GREENS = ["#7fa36a", "#6d9660", "#8fb178", "#5f8a5a", "#9bbd7f", "#86a877"];
const CONIFERS = ["#4f7a5a", "#5c8766", "#46705a"];

/** Deterministic random numbers, so trees don't jump around between renders. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function skyDome() {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(SKY.top) },
      horizon: { value: new THREE.Color(SKY.horizon) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top;
      uniform vec3 horizon;
      varying vec3 vDir;
      void main() {
        float h = max(vDir.y, 0.0);
        vec3 col = mix(horizon, top, pow(smoothstep(0.0, 0.3, h), 0.7));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), material);
  dome.renderOrder = -1;
  dome.frustumCulled = false;
  return dome;
}

function cloud(rand: () => number, material: THREE.Material) {
  const g = new THREE.Group();
  const puffs = 4 + Math.floor(rand() * 4);
  for (let i = 0; i < puffs; i++) {
    const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), material);
    const r = 5 + rand() * 6;
    puff.scale.set(r * 1.3, r * 0.6, r);
    puff.position.set((i - puffs / 2) * 7 + rand() * 4, rand() * 3, rand() * 8 - 4);
    g.add(puff);
  }
  return g;
}

export function createScenery(scene: THREE.Scene) {
  const root = new THREE.Group();
  root.name = "Scenery";
  scene.add(root);

  const sky = skyDome();
  scene.add(sky);

  const meadow = new THREE.Mesh(
    new THREE.CircleGeometry(1400, 64),
    new THREE.MeshStandardMaterial({ color: "#b3c79a", roughness: 1 }),
  );
  meadow.rotation.x = -Math.PI / 2;
  meadow.position.y = -0.08;
  meadow.receiveShadow = true;
  root.add(meadow);

  const cloudMaterial = new THREE.MeshLambertMaterial({
    color: "#ffffff",
    emissive: "#e8eef2",
    emissiveIntensity: 0.35,
    transparent: true,
    opacity: 0.92,
  });
  const clouds = new THREE.Group();
  const cloudRand = random(7);
  for (let i = 0; i < 11; i++) {
    const c = cloud(cloudRand, cloudMaterial);
    const angle = cloudRand() * Math.PI * 2,
      far = 160 + cloudRand() * 260;
    c.position.set(Math.cos(angle) * far, 34 + cloudRand() * 30, Math.sin(angle) * far);
    clouds.add(c);
  }
  root.add(clouds);

  // Rolling hills on the horizon; the haze turns them soft blue-green.
  const hillMaterial = new THREE.MeshStandardMaterial({ color: "#a3b99a", roughness: 1 });
  const hills = new THREE.Group();
  const hillRand = random(3);
  for (let i = 0; i < 18; i++) {
    const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 12), hillMaterial);
    const angle = (i / 18) * Math.PI * 2 + hillRand() * 0.3,
      far = 780 + hillRand() * 180;
    hill.scale.set(150 + hillRand() * 150, 14 + hillRand() * 26, 150 + hillRand() * 150);
    hill.position.set(Math.cos(angle) * far, -4, Math.sin(angle) * far);
    hills.add(hill);
  }
  root.add(hills);

  // Instanced parts shared by every tree: fast to draw even with hundreds.
  const MAX = 2500;
  const flat = (color: string) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true });
  const trunkGeo = new THREE.CylinderGeometry(0.12, 0.2, 1.4, 6).translate(0, 0.7, 0);
  const crownGeo = new THREE.IcosahedronGeometry(1, 1).translate(0, 2.3, 0);
  const coneGeo = new THREE.ConeGeometry(1, 2.8, 7).translate(0, 2.6, 0);
  const bushGeo = new THREE.IcosahedronGeometry(0.7, 0).translate(0, 0.4, 0);
  const make = (geo: THREE.BufferGeometry, color: string) => {
    const mesh = new THREE.InstancedMesh(geo, flat(color), MAX);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.count = 0;
    root.add(mesh);
    return mesh;
  };
  const trunks = make(trunkGeo, "#8a7058");
  const crowns = make(crownGeo, "#ffffff");
  const cones = make(coneGeo, "#ffffff");
  const bushes = make(bushGeo, "#ffffff");

  let signature = "";
  const fog = new THREE.Fog(SKY.haze, 200, 600);
  scene.fog = fog;
  let haze = { extent: 48 };
  /** Rebuild the trees for a canvas of W × D metres. */
  function update(
    pieces: Piece[],
    W: number,
    D: number,
    /** Tree and foliage amount: 0 none, 1 normal, 2 lush. */
    amount: number,
    camera: THREE.PerspectiveCamera,
  ) {
    const next = JSON.stringify([W, D, amount, pieces.map((p) => [p.x, p.y, p.w, p.h])]);
    if (next === signature) return;
    signature = next;
    const extent = Math.max(W, D);
    // Everything far away grows with the canvas; 1 for the default 48 m campus.
    const scale = Math.max(1, (extent + 60) / 108);
    for (const g of [hills, clouds, meadow]) g.position.set(W / 2, g.position.y, D / 2);
    clouds.scale.setScalar(scale);
    meadow.scale.set(scale, scale, 1); // the meadow is rotated flat, so z is its thickness
    sky.scale.setScalar(1.8 * scale);
    // Keep the render distance short: the landscape dissolves into haze a
    // little way past the campus, like depth of field on a real map.
    const reach = Math.max(70, extent * 0.9);
    const hazeFar = extent * 1.5 + reach + 240;
    camera.far = hazeFar * 2 + 1200;
    camera.updateProjectionMatrix();
    haze = { extent };
    // Hills stand just inside the haze, as faint silhouettes on the horizon.
    hills.scale.setScalar((hazeFar * 0.85) / 960);

    // No frame around the campus: the meadow runs straight under it.
    const rand = random(W * 131 + D * 17);
    const blocked = pieces.map((p) => ({
      x0: p.x * 2 - 2.5,
      z0: p.y * 2 - 2.5,
      x1: (p.x + p.w) * 2 + 2.5,
      z1: (p.y + p.h) * 2 + 2.5,
    }));
    const spots: { x: number; z: number; kind: number }[] = [];
    const free = (x: number, z: number) =>
      !blocked.some((b) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1);
    // Countryside around the campus, thinning out with distance.
    // Wider spacing on big canvases keeps the tree count within budget.
    const step = Math.max(7, Math.sqrt(((W + 2 * reach) * (D + 2 * reach) * 0.5) / (MAX * 0.8)));
    const outside: typeof spots = [];
    for (let x = -reach; x < W + reach; x += step)
      for (let z = -reach; z < D + reach; z += step) {
        const px = x + (rand() - 0.5) * step * 0.7,
          pz = z + (rand() - 0.5) * step * 0.7;
        const out = Math.max(-px, px - W, -pz, pz - D);
        if (out < 0) continue;
        // Open lawn by the campus easing into fuller woodland, with no hard edge.
        const density =
          out < 70 * scale
            ? 0.25 + 0.5 * Math.min(1, out / 40)
            : 0.5 - (out / reach) * 0.3;
        if (rand() > density * amount) continue;
        if (free(px, pz)) outside.push({ x: px, z: pz, kind: rand() < 0.3 ? 1 : 0 });
      }
    // On the map, open lawns inside the campus get trees and shrubs too.
    if (amount > 0)
      for (let x = 1; x < W; x += 5.5)
        for (let z = 1; z < D; z += 5.5) {
          const px = x + (rand() - 0.5) * 3,
            pz = z + (rand() - 0.5) * 3;
          if (px > 0 && px < W && pz > 0 && pz < D && rand() < 0.3 * amount && free(px, pz))
            spots.push({ x: px, z: pz, kind: rand() < 0.45 ? 2 : 0 });
        }

    for (let i = outside.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [outside[i], outside[j]] = [outside[j], outside[i]];
    }
    spots.push(...outside);
    const m = new THREE.Matrix4(),
      q = new THREE.Quaternion(),
      s = new THREE.Vector3(),
      p = new THREE.Vector3(),
      up = new THREE.Vector3(0, 1, 0),
      color = new THREE.Color();
    let t = 0,
      c = 0,
      k = 0,
      b = 0;
    for (const spot of spots.slice(0, MAX)) {
      const size = 0.8 + rand() * 0.7;
      q.setFromAxisAngle(up, rand() * Math.PI * 2);
      p.set(spot.x, 0, spot.z);
      if (spot.kind === 2) {
        s.setScalar(size);
        bushes.setMatrixAt(b, m.compose(p, q, s));
        bushes.setColorAt(b++, color.set(GREENS[Math.floor(rand() * GREENS.length)]));
        continue;
      }
      s.set(size, size * (0.9 + rand() * 0.4), size);
      trunks.setMatrixAt(t++, m.compose(p, q, s));
      if (spot.kind === 1) {
        cones.setMatrixAt(k, m);
        cones.setColorAt(k++, color.set(CONIFERS[Math.floor(rand() * CONIFERS.length)]));
      } else {
        s.set(size * 1.25, size * 1.1, size * 1.25);
        crowns.setMatrixAt(c, m.compose(p, q, s));
        crowns.setColorAt(c++, color.set(GREENS[Math.floor(rand() * GREENS.length)]));
      }
    }
    for (const [mesh, n] of [[trunks, t], [crowns, c], [cones, k], [bushes, b]] as const) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }

  let last = 0;
  /** `focus` is the camera's distance to the point it orbits (the campus). */
  function animate(time: number, camera: THREE.Camera, focus: number) {
    sky.position.copy(camera.position);
    // Haze begins at the far edge of the canvas from wherever the camera is
    // and thickens quickly past it, so the campus stays crisp at any zoom
    // and the countryside around it soon fades out.
    fog.near = focus + haze.extent * 0.5;
    fog.far = fog.near + Math.max(40, haze.extent * 0.6);
    const dt = Math.min(0.1, (time - last) / 1000);
    last = time;
    // Clouds drift slowly around the campus.
    clouds.rotation.y += dt * 0.004;
  }

  function dispose() {
    root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      }
    });
    sky.geometry.dispose();
    (sky.material as THREE.Material).dispose();
    scene.remove(root, sky);
    scene.fog = null;
  }

  return { update, animate, dispose };
}
