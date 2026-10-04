import applicationConfig from "../../eslint.config.js";
import tseslint from "typescript-eslint";

export default [
  ...applicationConfig,
  { files: ["**/*.ts"], languageOptions: { parser: tseslint.parser } },
];
