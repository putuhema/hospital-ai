import * as THREE from "three";

/**
 * Lights, the canvas ground and its tile grid, plus the editor's selection
 * box and placement ghost. Sizes are in tiles; one tile is 2 m.
 */
export function createStage(scene: THREE.Scene, presentation: boolean) {
  // Balanced tropical daylight so bright white PHTC concrete and fresh green
  // RSUD hospital walls both hold clean architectural contrast without washout.
  const hemi = new THREE.HemisphereLight("#e6f1fa", "#9cb488", 2.15);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight("#fff1da", 2.85);
  sun.castShadow = true;
  // Crisp shadow map (on the map, drawn once per rebuild so 2048 stays lightweight).
  sun.shadow.mapSize.setScalar(2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.045;
  sun.shadow.radius = 2.4;
  scene.add(sun, sun.target);

  // Gentle cool sky-fill light from the opposite azimuth for sculpted shadow sides.
  const fill = new THREE.DirectionalLight("#d5e7f7", 0.42);
  fill.castShadow = false;
  scene.add(fill, fill.target);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshStandardMaterial({ color: presentation ? "#cbdab4" : "#e3e9db", roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  // On the map the campus sits straight on the meadow, with no canvas.
  ground.visible = !presentation;
  scene.add(ground);

  const grid = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: "#becab3", transparent: true, opacity: 0.68 }),
  );
  scene.add(grid);

  const selectedBox = new THREE.Box3Helper(new THREE.Box3(), 0x467c4a);
  selectedBox.visible = false;
  const ghost = new THREE.Mesh(
    new THREE.BoxGeometry(1, 0.12, 1),
    new THREE.MeshBasicMaterial({ color: 0x729e60, transparent: true, opacity: 0.5, depthWrite: false }),
  );
  ghost.visible = false;
  scene.add(selectedBox, ghost);

  let reach = 60;
  /** Light the campus from `direction` (x east, z south, y up), e.g. the sun's at this hour. */
  function aim(direction: THREE.Vector3) {
    sun.position.copy(sun.target.position).addScaledVector(direction, reach * 1.2);
    fill.position.set(
      sun.target.position.x - direction.x * reach * 0.9,
      sun.target.position.y + reach * 0.75,
      sun.target.position.z - direction.z * reach * 0.9,
    );
  }

  /** Fit ground, grid and sun shadows to a canvas of `width` × `height` tiles. */
  function resize(width: number, height: number) {
    const W = width * 2,
      D = height * 2;
    ground.geometry.dispose();
    ground.geometry = new THREE.PlaneGeometry(W, D);
    ground.position.set(width, -0.04, height);
    const points: number[] = [];
    for (let x = 0; x <= W; x += 2) points.push(x, 0, 0, x, 0, D);
    for (let z = 0; z <= D; z += 2) points.push(0, 0, z, W, 0, z);
    grid.geometry.dispose();
    grid.geometry = new THREE.BufferGeometry();
    grid.geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    const extent = Math.max(width, height) * 1.5;
    reach = extent + 20;
    sun.position.set(width - 14, extent + 22, height + 14);
    sun.target.position.set(width, 0, height);
    fill.position.set(width + 18, extent * 0.85, height - 18);
    fill.target.position.set(width, 0, height);
    Object.assign(sun.shadow.camera, {
      left: -extent,
      right: extent,
      top: extent,
      bottom: -extent,
      near: 0.1,
      far: extent * 4,
    });
    sun.shadow.camera.updateProjectionMatrix();
  }

  return { ground, grid, selectedBox, ghost, resize, hemi, sun, aim };
}
