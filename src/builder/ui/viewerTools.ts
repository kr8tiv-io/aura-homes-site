import * as THREE from 'three';

const EPS = 1e-4;

/** Keep a pick ray on the visible side of a section cut. */
export function restrictRayToSection(raycaster: THREE.Raycaster, planes: readonly THREE.Plane[]): boolean {
  raycaster.near = 0;
  raycaster.far = Infinity;
  const plane = planes[0];
  if (!plane) return true;
  const inside = plane.distanceToPoint(raycaster.ray.origin) >= 0;
  const crossing = raycaster.ray.distanceToPlane(plane);
  if (crossing === null) return inside;
  if (inside) raycaster.far = crossing;
  else raycaster.near = crossing + EPS;
  return true;
}
