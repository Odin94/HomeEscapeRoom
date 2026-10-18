import { clueSchema, clueFileBytes, MAX_CLUE_TOTAL_BYTES } from "./clue";
import { prerequisites } from "./challenge-progress";
import { designSchemeIds } from "./design-scheme";
import { z } from "zod";
import {
  readdirSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { lightTransitionSchema } from "./light-transition";
import { vacuumSchema } from "./vacuum";
export const actionSchema = z.discriminatedUnion("type", [
  lightTransitionSchema,
  vacuumSchema,
  z.strictObject({
    type: z.literal("control"),
    controlId: z.string().min(1),
    on: z.boolean().optional(),
  }),
  z.strictObject({
    type: z.literal("speech"),
    entity: z.string().regex(/^notify\.[a-z0-9_]+_(speak|announce)$/),
    message: z.string().trim().min(1).max(1000),
  }),
]);
export const gameSchema = z
  .strictObject({
    id: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(80),
    name: z.string().trim().min(1).max(80),
    designScheme: z.enum(designSchemeIds).optional(),
    autoStart: z.boolean().optional(),
    clues: z.array(clueSchema).max(50).optional(),
    areas: z
      .array(
        z
          .strictObject({
            id: z
              .string()
              .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
              .max(80),
            name: z.string().trim().min(1).max(80),
            kind: z.enum([
              "qr",
              "text",
              "numbers",
              "colors",
              "symbols",
              "external",
            ]),
            flowPosition: z
              .object({
                x: z.number().finite().min(24).max(10000),
                y: z.number().finite().min(24).max(10000),
              })
              .optional(),
            requires: z.array(z.string()).max(30).optional(),
            revealClues: z.array(z.string()).max(50).optional(),
            onComplete: z.array(actionSchema).max(10).optional(),
            qrMode: z.enum(["prompted", "hidden"]).optional(),
            choices: z
              .array(z.string().trim().min(1).max(24))
              .min(2)
              .max(12)
              .optional(),
            hint: z.string().max(1000),
            description: z.string().max(10000),
            unlockCode: z.string().trim().min(1).max(256),
            caseSensitive: z.boolean().optional(),
            playerView: z.enum(["narrative"]).default("narrative"),
          })
          .superRefine((area, ctx) => {
            const issue = (message: string) =>
              ctx.addIssue({ code: "custom", message });
            if (area.kind === "numbers" && !/^[0-9]+$/.test(area.unlockCode))
              issue(
                "Numbers answers must contain digits only (leading zeroes are preserved).",
              );
            const sequence = area.kind === "colors" || area.kind === "symbols";
            if (sequence) {
              const choices = area.choices || [];
              if (
                new Set(choices).size !== choices.length ||
                choices.length < 2 ||
                choices.some((c) => c.includes("|"))
              )
                issue("Provide 2-12 unique choices without |.");
              const answer = area.unlockCode.split("|");
              if (
                answer.length < 2 ||
                answer.length > 20 ||
                answer.some((c) => !choices.includes(c))
              )
                issue(
                  "Sequence must contain 2-20 choices separated by |, in order.",
                );
              if (
                area.kind === "colors" &&
                choices.some((c) => !/^#[0-9a-fA-F]{6}$/.test(c))
              )
                issue("Colors must be six-digit hex values, such as #ff0000.");
            } else if (area.choices !== undefined)
              issue("Choices are only allowed for colors and symbols.");
            if (area.kind !== "qr" && area.qrMode !== undefined)
              issue("QR mode is only allowed for QR challenges.");
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
        z.strictObject({
          id: z
            .string()
            .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
            .max(80),
          name: z.string().trim().min(1).max(80),
          entity: z.string().regex(/^(light|scene|script)\.[a-z0-9_]+$/),
        }),
      )
      .max(50)
      .refine(
        (a) => new Set(a.map((x) => x.id)).size === a.length,
        "Control IDs must be unique",
      ),
  })
  .superRefine((game, ctx) => {
    const issue = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    const clues = game.clues || [];
    if (new Set(clues.map((c) => c.id)).size !== clues.length)
      issue("Clue IDs must be unique.");
    if (
      clues.reduce(
        (size, c) =>
          size + (c.kind === "markdown" ? 0 : clueFileBytes(c.content)),
        0,
      ) > MAX_CLUE_TOTAL_BYTES
    )
      issue("Clue files must total no more than 1 GB.");
    const visiting = new Set<string>(),
      visited = new Set<string>();
    function visit(index: number) {
      const area = game.areas[index];
      if (visiting.has(area.id)) {
        issue("Challenge prerequisites must not contain cycles.");
        return;
      }
      if (visited.has(area.id)) return;
      visiting.add(area.id);
      for (const id of prerequisites(game, index)) {
        const other = game.areas.findIndex((a) => a.id === id);
        if (other < 0) issue(`Unknown prerequisite: ${id}`);
        else visit(other);
      }
      visiting.delete(area.id);
      visited.add(area.id);
      for (const id of area.revealClues || [])
        if (!clues.some((c) => c.id === id)) issue(`Unknown clue: ${id}`);
    }
    game.areas.forEach((_, index) => visit(index));
    for (const area of game.areas)
      for (const action of area.onComplete || []) {
        if (
          action.type === "control" &&
          !game.controls.some((c) => c.id === action.controlId)
        )
          ctx.addIssue({
            code: "custom",
            message: `Unknown completion control: ${action.controlId}`,
          });
      }
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
  const area = game.areas[progress];
  const text = area.kind === "text" || area.kind === "external";
  const ignoreCase = text && !area.caseSensitive;
  const answer = code.trim();
  const expected = area.unlockCode.trim();
  if (
    (ignoreCase ? answer.toLowerCase() : answer) !==
    (ignoreCase ? expected.toLowerCase() : expected)
  )
    throw new Error("That answer does not unlock this area.");
  return progress + 1;
}
