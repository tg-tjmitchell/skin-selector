const js = require("@eslint/js");
const tseslint = require("typescript-eslint");
const globals = require("globals");

const sharedGlobals = {
  ...globals.node,
  ...globals.browser
};

module.exports = [
  { ignores: ["dist/**", "node_modules/**"] },
  {
    files: ["**/*.js"],
    languageOptions: {
      globals: sharedGlobals
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }]
    }
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      globals: sharedGlobals,
      parserOptions: {
        project: true,
        tsconfigRootDir: __dirname
      }
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tseslint.configs.recommendedTypeChecked.rules,
      ...tseslint.configs.stylisticTypeChecked.rules,
      "no-undef": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_", "caughtErrorsIgnorePattern": "^_" }]
    }
  }
];
