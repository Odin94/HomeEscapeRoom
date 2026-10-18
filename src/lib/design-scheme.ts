export const designSchemes = {
  standard: "Standard",
  spooky: "Dark / spooky",
  "elven-forest": "Elven-forest pastel",
  warm: "Warm and welcoming pastel",
  alpine: "Cool and alpine",
  tropical: "Tropic Island",
  terminal: "SciFi terminal",
} as const;
export type DesignScheme = keyof typeof designSchemes;
export const designSchemeIds = Object.keys(designSchemes) as [
  DesignScheme,
  ...DesignScheme[],
];
