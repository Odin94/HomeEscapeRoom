import { z } from "zod";
import {
  readdirSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { resolve, join } from "node:path";
export const gameSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(80),
  name: z.string().trim().min(1).max(80),
  areas: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        kind: z.enum(["qr", "password"]),
        hint: z.string(),
        description: z.string(),
        unlockCode: z.string().trim().min(1),
        playerView: z.enum(["narrative"]).default("narrative"),
      }),
    )
    .min(1)
    .max(30)
    .refine(
      (a) => new Set(a.map((x) => x.id)).size === a.length,
      "Area IDs must be unique",
    ),
  controls: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        entity: z.string().regex(/^(light|scene|script)\.[a-z0-9_]+$/),
      }),
    )
    .max(50)
    .refine(
      (a) => new Set(a.map((x) => x.id)).size === a.length,
      "Control IDs must be unique",
    ),
});
export type Game = z.infer<typeof gameSchema>;
const directory = () => resolve(process.env.GAMES_PATH || "games");
export function loadGames(): Game[] {
  return readdirSync(directory())
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const game = gameSchema.parse(
        JSON.parse(readFileSync(join(directory(), f), "utf8")),
      );
      if (f !== `${game.id}.json`)
        throw new Error(`Game filename must match its ID: ${f}`);
      return game;
    });
}
export function saveGame(value: unknown) {
  const game = gameSchema.parse(value);
  mkdirSync(directory(), { recursive: true });
  const file = join(directory(), `${game.id}.json`);
  writeFileSync(`${file}.tmp`, JSON.stringify(game, null, 2) + "\n");
  renameSync(`${file}.tmp`, file);
  return game;
}
const initial = loadGames()[0];
export const areas = initial.areas;
export const unlockCodes = areas.map((a) => a.unlockCode);
export function nextUnlock(
  progress: number,
  code: string,
  game: Game = initial,
) {
  if (progress >= game.areas.length)
    throw new Error("Your team has already completed the game.");
  if (
    code.trim().toLowerCase() !== game.areas[progress]?.unlockCode.toLowerCase()
  )
    throw new Error("That code does not unlock this area.");
  return progress + 1;
}
