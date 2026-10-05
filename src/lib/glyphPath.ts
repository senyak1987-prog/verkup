import type { Path } from "opentype.js";

export function serializeGlyphPath(path: Pick<Path, "commands">) {
  const coordinate = (value: number) => {
    if (!Number.isFinite(value)) throw new Error("Контур шрифта содержит некорректные координаты.");
    return String(Number(value.toFixed(3)));
  };
  // OpenType.js 2's decimal rounding produces NaN for near-integer floats
  // such as 115.00000000000001. Preserve every validated outline command.
  return path.commands.map((command) => {
    switch (command.type) {
      case "M": case "L": return command.type + coordinate(command.x) + " " + coordinate(command.y);
      case "Q": return "Q" + coordinate(command.x1) + " " + coordinate(command.y1) + " " + coordinate(command.x) + " " + coordinate(command.y);
      case "C": return "C" + coordinate(command.x1) + " " + coordinate(command.y1) + " " + coordinate(command.x2) + " " + coordinate(command.y2) + " " + coordinate(command.x) + " " + coordinate(command.y);
      case "Z": return "Z";
      default: throw new Error("Команда контура шрифта не поддерживается.");
    }
  }).join("");
}
