import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default [
  {
    ignores: ["node_modules/**", "dist/**", "dist-chrome/**", "dist-firefox/**"]
  },

  // JS core recommended
  js.configs.recommended,

  // JS/MJS/CJS (включая scripts/*.mjs с top-level await)
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
        browser: "readonly",
        chrome: "readonly"
      }
    },
    rules: {
      // оставим базовый смысл правила, но не будем ломать пустые catch
      "no-empty": ["error", { allowEmptyCatch: true }]
    }
  },

  // TypeScript (без type-aware линтинга; typecheck делает tsc)
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module"
      },
      globals: {
        ...globals.browser,
        browser: "readonly",
        chrome: "readonly"
      }
    },
    plugins: {
      "@typescript-eslint": tsPlugin
    },
    rules: {
      // TS-правила (non-type-aware)
      ...tsPlugin.configs.recommended.rules,

      // ВАЖНО: эти JS-правила на TS дают ложные срабатывания
      "no-undef": "off",
      "no-empty": "off",
      "no-unused-vars": "off",

      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_"
        }
      ]
    }
  },

  // Prettier last
  prettier
];
