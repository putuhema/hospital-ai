import * as THREE from "three";

type Textured = THREE.Material & { map?: THREE.Texture | null };

/**
 * Remove every child of a group and free its GPU resources. Geometry shared
 * with loaded model templates must survive, so callers can opt out per mesh.
 */
export function clearGroup(
  group: THREE.Group,
  ownsGeometry: (o: THREE.Mesh | THREE.Sprite) => boolean = () => true,
) {
  for (const child of [...group.children]) {
    child.traverse((o) => {
      if (!(o instanceof THREE.Mesh || o instanceof THREE.Sprite)) return;
      for (const m of (Array.isArray(o.material) ? o.material : [o.material]) as Textured[]) {
        m.map?.dispose();
        m.dispose();
      }
      if (ownsGeometry(o)) o.geometry.dispose();
    });
    group.remove(child);
  }
}
