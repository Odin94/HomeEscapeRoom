// Puzzle answers and unrevealed content must never enter the client bundle.
export const areas = [
  {
    id: "study",
    name: "The study",
    subtitle: "Every secret starts somewhere.",
    kind: "qr",
    hint: "Find the QR marker hidden in the study.",
    description:
      "A desk lamp flickers beside a handwritten note: “The keeper of the night has five letters.”",
  },
  {
    id: "archive",
    name: "The archive",
    subtitle: "Follow the light.",
    kind: "password",
    hint: "The keeper of the night. Five letters. A bird.",
    description:
      "Among the old records, a final transmission reads: “Find the last marker where the house keeps its light.”",
  },
  {
    id: "observatory",
    name: "The observatory",
    subtitle: "Bring the signal home.",
    kind: "qr",
    hint: "Find the final QR marker in the observatory.",
    description:
      "The signal is restored. The house is awake. You made it out, together.",
  },
] as const;
export const unlockCodes = [
  "study-marker-7c92",
  "raven",
  "observatory-marker-a83f",
];
export function nextUnlock(progress: number, code: string) {
  if (progress >= 3)
    throw new Error("Your team has already completed the game.");
  if (code.trim().toLowerCase() !== unlockCodes[progress])
    throw new Error(
      "That does not unlock this area. Check your clue and try again.",
    );
  return progress + 1;
}
