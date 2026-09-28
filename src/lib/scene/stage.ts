import * as THREE from "three";

/**
 * Lights, the canvas ground and its tile grid, plus the editor's selection
 * box and placement ghost. Sizes are in tiles; one tile is 2 m.
 */
export function createStage(scene: THREE.Scene, presentation: boolean) {
  scene.add(new THREE.HemisphereLight("#e3eef8", "#a3b88c", 2.4));
  const sun = new THREE.DirectionalLight("#fff0d8", 3.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.normalBias = 0.06;
  scene.add(sun, sun.target);

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
    new THREE.LineBasicMaterial({ color: "#becab3", transparent: true, opacity: 0.7 }),
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
    sun.position.set(width - 15, extent + 20, height - 10);
    sun.target.position.set(width, 0, height);
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

  return { ground, grid, selectedBox, ghost, resize };
}
