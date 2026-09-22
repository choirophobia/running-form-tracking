// Batch 3: generic 3D vector/geometry primitives used by the metric
// computation functions. No pose-specific domain knowledge here — see
// pose-landmarks.ts for that.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export function subtract(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function scale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function magnitude(v: Vec3): number {
  return Math.sqrt(dot(v, v));
}

export function distance(a: Vec3, b: Vec3): number {
  return magnitude(subtract(a, b));
}

export function midpoint(a: Vec3, b: Vec3): Vec3 {
  return scale(add(a, b), 0.5);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Angle, in degrees, of the vertex angle a-vertex-c: the angle between
 * rays vertex->a and vertex->c. Used for joint angles, e.g.
 * `angleAtVertex(shoulder, elbow, wrist)` gives the elbow's bend angle.
 *
 * Degenerate case (a or c coincides with vertex, i.e. a zero-length ray
 * with no defined direction) returns 0 rather than NaN.
 */
export function angleAtVertex(a: Vec3, vertex: Vec3, c: Vec3): number {
  const u = subtract(a, vertex);
  const v = subtract(c, vertex);
  const magU = magnitude(u);
  const magV = magnitude(v);
  if (magU === 0 || magV === 0) return 0;
  const cosTheta = clamp(dot(u, v) / (magU * magV), -1, 1);
  return (Math.acos(cosTheta) * 180) / Math.PI;
}

export function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
