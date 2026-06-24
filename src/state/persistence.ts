import { STORAGE_KEY } from "../config";
import type { BrickPlacement } from "../build/grid";
import type { Brick } from "../build/brick";

export interface SavedBrick {
  defId: string;
  color: string;
  placement: BrickPlacement;
}

export interface SaveData {
  version: 1;
  scale: number;
  bricks: SavedBrick[];
}

/** Snapshot the snapped bricks of a build into a plain serializable object. */
export function serializeBuild(bricks: Iterable<Brick>, scale: number): SaveData {
  const out: SavedBrick[] = [];
  for (const b of bricks) {
    if (b.state === "snapped" && b.placement) {
      out.push({ defId: b.def.id, color: b.colorName, placement: { ...b.placement } });
    }
  }
  return { version: 1, scale, bricks: out };
}

export function saveToLocal(data: SaveData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function loadFromLocal(): SaveData | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as SaveData;
    return data?.version === 1 && Array.isArray(data.bricks) ? data : null;
  } catch {
    return null;
  }
}

/** Trigger a JSON file download (manual export from the console / future UI). */
export function exportToFile(data: SaveData, name = "blocky-save.json"): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
