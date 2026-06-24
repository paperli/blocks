import { Scene } from "@babylonjs/core/scene";
import { Vector3, Matrix } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { BRICK_COLORS, BRICK_HEIGHT, UNITS } from "../config";
import { BuildGrid } from "./grid";

export interface BrickDef {
  /** Stable id, e.g. "2x4". */
  id: string;
  /** Footprint in studs along local X. */
  w: number;
  /** Footprint in studs along local Z. */
  d: number;
}

/** Starter brick set (PRD: a few basic bricks). */
export const BRICK_DEFS: BrickDef[] = [
  { id: "1x1", w: 1, d: 1 },
  { id: "1x2", w: 1, d: 2 },
  { id: "1x4", w: 1, d: 4 },
  { id: "2x2", w: 2, d: 2 },
  { id: "2x4", w: 2, d: 4 },
];

export function brickDefById(id: string): BrickDef | undefined {
  return BRICK_DEFS.find((b) => b.id === id);
}

/** All bricks are full-height in v1. */
export const BRICK_PLATES = BuildGrid.fullBrickPlates;

const matCache = new Map<string, StandardMaterial>();

export function brickMaterial(scene: Scene, colorName: string): StandardMaterial {
  const key = colorName;
  let mat = matCache.get(key);
  if (mat) return mat;
  mat = new StandardMaterial(`brickMat_${key}`, scene);
  const hex = BRICK_COLORS[colorName] ?? "#cccccc";
  mat.diffuseColor = Color3.FromHexString(hex);
  mat.specularColor = new Color3(0.25, 0.25, 0.25);
  mat.specularPower = 64;
  matCache.set(key, mat);
  return mat;
}

/**
 * Build a brick mesh: a box body plus studs on top as thin instances of a
 * single cylinder (one draw call for all studs of the brick). The returned
 * mesh's local origin is the brick center; +Y is up. Studs are positioned on
 * the same pitch as the build grid so footprints line up when snapped.
 */
export function createBrickMesh(scene: Scene, def: BrickDef, colorName: string): Mesh {
  const width = def.w * UNITS.STUD_PITCH;
  const depth = def.d * UNITS.STUD_PITCH;
  const mat = brickMaterial(scene, colorName);

  const body = MeshBuilder.CreateBox(
    `brick_${def.id}`,
    { width, height: BRICK_HEIGHT, depth },
    scene,
  );
  body.material = mat;

  const stud = MeshBuilder.CreateCylinder(
    `studs_${def.id}`,
    { diameter: UNITS.STUD_RADIUS * 2, height: UNITS.STUD_HEIGHT, tessellation: 12 },
    scene,
  );
  stud.material = mat;
  stud.parent = body;
  stud.isPickable = false;

  const topY = BRICK_HEIGHT / 2 + UNITS.STUD_HEIGHT / 2;
  const matrices: Matrix[] = [];
  for (let i = 0; i < def.w; i++) {
    for (let j = 0; j < def.d; j++) {
      const x = (i - (def.w - 1) / 2) * UNITS.STUD_PITCH;
      const z = (j - (def.d - 1) / 2) * UNITS.STUD_PITCH;
      matrices.push(Matrix.Translation(x, topY, z));
    }
  }
  stud.thinInstanceAdd(matrices);

  return body;
}

/** Half-extent helper for placing the brick's bottom face on a surface. */
export function brickHalfHeight(): number {
  return BRICK_HEIGHT / 2;
}

/** A small world-space anchor offset so a grabbed brick floats above the pinch. */
export const GRAB_OFFSET = new Vector3(0, 0, 0);
