import ts from "typescript-eslint";
export default ts.config(
  {
    ignores: [
      "node_modules/**",
      "data/**",
      "artifacts/**",
      ".output/**",
      ".tanstack/**",
      "src/routeTree.gen.ts",
    ],
  },
  ...ts.configs.recommended,
  { rules: { "@typescript-eslint/no-explicit-any": "off" } },
);
