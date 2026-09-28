import * as THREE from "three";

/** Size of a label as a fraction of the viewport height. */
export const LABEL_SIZE = { building: 0.024, room: 0.017 };

/** A rounded name tag drawn to a canvas, kept at a constant on-screen size. */
export function createLabel(text: string, kind: keyof typeof LABEL_SIZE) {
  const strong = kind === "building";
  const canvas = document.createElement("canvas"),
    ctx = canvas.getContext("2d")!,
    font = `${strong ? 600 : 500} 44px system-ui, sans-serif`;
  ctx.font = font;
  canvas.width = Math.ceil(ctx.measureText(text).width) + 44;
  canvas.height = 72;
  // Resizing the canvas resets its state, so the font is set again.
  ctx.font = font;
  ctx.fillStyle = strong ? "#fffffff0" : "#fffef6e8";
  ctx.strokeStyle = strong ? "#2d4a38" : "#9fb09a";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(2, 2, canvas.width - 4, canvas.height - 4, 34);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = strong ? "#1f3a2b" : "#40523f";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 22, canvas.height / 2 + 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, depthTest: false, sizeAttenuation: false }),
  );
  const size = LABEL_SIZE[kind];
  sprite.scale.set((canvas.width / canvas.height) * size, size, 1);
  sprite.renderOrder = strong ? 11 : 10;
  sprite.userData.priority = strong ? 0 : 1;
  return sprite;
}

/**
 * Hide labels that would overlap one already shown, like a street map:
 * building names win over room names, nearer labels over farther ones.
 */
export function createDeclutter() {
  const projected = new THREE.Vector3();
  let last = 0;
  return (group: THREE.Group, camera: THREE.Camera & { projectionMatrix: THREE.Matrix4 }, width: number, height: number, time: number) => {
    if (time - last < 120) return;
    last = time;
    // Screen pixels per unit of a non-attenuated sprite's scale.
    const unit = (camera.projectionMatrix.elements[5] * height) / 2,
      placed: [number, number, number, number][] = [];
    const sprites = (group.children as THREE.Sprite[])
      .map((sprite) => ({ sprite, distance: sprite.position.distanceToSquared(camera.position) }))
      .sort((a, b) => a.sprite.userData.priority - b.sprite.userData.priority || a.distance - b.distance);
    for (const { sprite } of sprites) {
      projected.copy(sprite.position).project(camera);
      const x = ((projected.x + 1) / 2) * width,
        y = ((1 - projected.y) / 2) * height,
        hw = (sprite.scale.x * unit) / 2 + 3,
        hh = (sprite.scale.y * unit) / 2 + 2;
      const box: [number, number, number, number] = [x - hw, y - hh, x + hw, y + hh];
      sprite.visible =
        projected.z < 1 &&
        !placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]);
      if (sprite.visible) placed.push(box);
    }
  };
}
