import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

type Look = THREE.Material & {
  color?: THREE.Color;
  emissive?: THREE.Color;
  roughness?: number;
  metalness?: number;
  map?: THREE.Texture | null;
  flatShading?: boolean;
  vertexColors?: boolean;
};

const KEPT = ["position", "normal", "uv"];

/** Meshes that look alike can share one draw: same kind of material, colour, finish and texture. */
function lookOf(mesh: THREE.Mesh) {
  const m = mesh.material as Look,
    g = mesh.geometry;
  const attributes = KEPT.filter((a) => g.hasAttribute(a)).join(",");
  return [
    m.type,
    m.color?.getHexString(),
    m.emissive?.getHexString(),
    m.roughness,
    m.metalness,
    m.map?.uuid,
    m.transparent,
    m.opacity,
    m.side,
    m.flatShading,
    m.depthWrite,
    mesh.castShadow,
    mesh.receiveShadow,
    mesh.renderOrder,
    attributes,
    g.index ? "indexed" : "flat",
    // A room's parts merge only with each other, so tapping one still finds the room.
    mesh.userData.roomId,
  ].join("|");
}

/** Reverse each triangle's winding, for geometry baked through a mirroring transform. */
function flipWinding(g: THREE.BufferGeometry) {
  if (g.index) {
    const index = g.index.array;
    for (let i = 0; i + 2 < index.length; i += 3) [index[i + 1], index[i + 2]] = [index[i + 2], index[i + 1]];
    g.index.needsUpdate = true;
    return;
  }
  for (const name of Object.keys(g.attributes)) {
    const a = g.attributes[name] as THREE.BufferAttribute,
      size = a.itemSize,
      array = a.array;
    for (let v = 0; v + 2 < a.count; v += 3)
      for (let k = 0; k < size; k++) {
        const i = (v + 1) * size + k,
          j = (v + 2) * size + k;
        [array[i], array[j]] = [array[j], array[i]];
      }
    a.needsUpdate = true;
  }
}

/**
 * Merge the meshes under `root` that look alike into one mesh each, so a
 * building is drawn in a handful of calls instead of hundreds. The result is
 * drawn the same. A room's parts merge only with each other and keep its
 * `roomId`; meshes with several materials or vertex colours are left as they are.
 * Merged meshes own their geometry (`userData.generated`).
 */
export function batchMeshes(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert(),
    groups = new Map<string, THREE.Mesh[]>();
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || o instanceof THREE.InstancedMesh || o instanceof THREE.SkinnedMesh) return;
    if (Array.isArray(o.material) || (o.material as Look).vertexColors) return;
    if (!o.geometry.hasAttribute("position") || o.geometry.morphAttributes.position) return;
    const key = lookOf(o);
    const group = groups.get(key);
    if (group) group.push(o);
    else groups.set(key, [o]);
  });

  const relative = new THREE.Matrix4();
  for (const meshes of groups.values()) {
    if (meshes.length < 2) continue;
    const geometries = meshes.map((mesh) => {
      const g = new THREE.BufferGeometry();
      for (const name of KEPT) if (mesh.geometry.hasAttribute(name)) g.setAttribute(name, mesh.geometry.getAttribute(name).clone());
      if (mesh.geometry.index) g.setIndex(mesh.geometry.index.clone());
      relative.multiplyMatrices(inverse, mesh.matrixWorld);
      g.applyMatrix4(relative);
      if (relative.determinant() < 0) flipWinding(g);
      return g;
    });
    const merged = mergeGeometries(geometries, false);
    geometries.forEach((g) => g.dispose());
    if (!merged) continue;
    const first = meshes[0],
      mesh = new THREE.Mesh(merged, first.material);
    mesh.name = `${first.name} (merged)`;
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.renderOrder = first.renderOrder;
    mesh.userData.generated = true;
    if (first.userData.roomId !== undefined) mesh.userData.roomId = first.userData.roomId;
    for (const m of meshes) {
      // Each piece has its own copies of the materials; the merged mesh keeps the first.
      if (m !== first) (m.material as THREE.Material).dispose();
      // Geometry shared with a loaded template stays; generated geometry is freed.
      if (m.userData.generated) m.geometry.dispose();
      m.removeFromParent();
    }
    root.add(mesh);
  }
}
