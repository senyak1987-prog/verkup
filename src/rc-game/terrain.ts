/** Shared height field: the rendered ground and wheel contacts use the same surface. */
export function terrainHeight(x: number, z: number): number {
  const hill = .52 * Math.exp(-((x - 4.7) ** 2 / 1.6 + (z + 1.1) ** 2 / 4));
  const bank = .32 * Math.exp(-((x + 4.5) ** 2 / 2 + (z - 1.2) ** 2 / 3));
  const strip = Math.exp(-((x + .6) ** 2 / 6 + (z + 4.6) ** 2 / .5));
  return hill + bank + strip * .095 * (1 + Math.sin(x * 9));
}

export const CHECKPOINTS = [
  { x: 6, z: 3.6 }, { x: 6, z: -4 }, { x: 0, z: -5.5 },
  { x: -6, z: -3 }, { x: -6, z: 3.6 }, { x: 0, z: 3.6 },
];

export const OBSTACLES = [
  { x: 2.2, z: 0, radius: .65 }, { x: -2.8, z: -1.5, radius: .65 },
  { x: -.7, z: 1.1, radius: .45 },
];
