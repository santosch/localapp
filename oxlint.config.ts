// Lint rules: the base JS/TS rules and typescript-eslint's recommended-type-checked set (run with
// `npm run lint` — type-aware, through tsgolint). Warnings fail the check too.
import { defineConfig } from "oxlint";

/** Base JS/TS — syntactic, every package. */
const general = {
  // Base ESLint
  "constructor-super": "error",
  "for-direction": "error",
  "no-async-promise-executor": "error",
  "no-case-declarations": "error",
  "no-class-assign": "error",
  "no-compare-neg-zero": "error",
  "no-cond-assign": "error",
  "no-const-assign": "error",
  "no-constant-binary-expression": "error",
  "no-constant-condition": "error",
  "no-control-regex": "error",
  "no-debugger": "error",
  "no-delete-var": "error",
  "no-dupe-class-members": "error",
  "no-dupe-else-if": "error",
  "no-dupe-keys": "error",
  "no-duplicate-case": "error",
  "no-empty": "error",
  "no-empty-character-class": "error",
  "no-empty-pattern": "error",
  "no-empty-static-block": "error",
  "no-ex-assign": "error",
  "no-fallthrough": "error",
  "no-func-assign": "error",
  // A choice among more than two reads better as a switch or a lookup than nested ternaries.
  "no-nested-ternary": "error",
  "no-global-assign": "error",
  "no-import-assign": "error",
  "no-invalid-regexp": "error",
  "no-irregular-whitespace": "error",
  "no-loss-of-precision": "error",
  "no-misleading-character-class": "error",
  "no-new-native-nonconstructor": "error",
  "no-nonoctal-decimal-escape": "error",
  "no-obj-calls": "error",
  "no-prototype-builtins": "error",
  "no-regex-spaces": "error",
  "no-self-assign": "error",
  "no-setter-return": "error",
  "no-shadow-restricted-names": "error",
  "no-sparse-arrays": "error",
  "no-this-before-super": "error",
  "no-unexpected-multiline": "error",
  "no-unsafe-finally": "error",
  "no-unsafe-negation": "error",
  "no-unsafe-optional-chaining": "error",
  "no-unused-labels": "error",
  "no-unused-private-class-members": "error",
  "no-useless-backreference": "error",
  "no-useless-catch": "error",
  "no-useless-escape": "error",
  "no-with": "error",
  "require-yield": "error",
  "use-isnan": "error",
  "valid-typeof": "error",
  "no-unused-vars": [
    "error",
    { ignoreRestSiblings: true, argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
  ],

  // TypeScript, syntactic
  "@typescript-eslint/ban-ts-comment": "error",
  "no-array-constructor": "error",
  "@typescript-eslint/no-duplicate-enum-values": "error",
  "@typescript-eslint/no-empty-object-type": "error",
  "@typescript-eslint/no-explicit-any": "error",
  "@typescript-eslint/no-extra-non-null-assertion": "error",
  "@typescript-eslint/no-misused-new": "error",
  "@typescript-eslint/no-namespace": "error",
  "@typescript-eslint/no-non-null-asserted-optional-chain": "error",
  "@typescript-eslint/no-require-imports": "error",
  "@typescript-eslint/no-this-alias": "error",
  "@typescript-eslint/no-unnecessary-type-constraint": "error",
  "@typescript-eslint/no-unsafe-declaration-merging": "error",
  "@typescript-eslint/no-unsafe-function-type": "error",
  "no-unused-expressions": "error",
  "@typescript-eslint/no-wrapper-object-types": "error",
  "@typescript-eslint/prefer-as-const": "error",
  "@typescript-eslint/prefer-namespace-keyword": "error",
  "@typescript-eslint/triple-slash-reference": "error",
  "@typescript-eslint/consistent-type-imports": "error",
  // Off, not relaxed: with `noUncheckedIndexedAccess` a `!` after a lookup that was just checked
  // is the idiom (`m[1]!` after a match, `map.get(k)!` after `has`); a throw for each would only
  // add noise. tsc keeps the types honest.
  "@typescript-eslint/no-non-null-assertion": "off",

  // Hygiene
  "array-callback-return": "error",
  "no-bitwise": "warn",
  // Off: the CLI's output is its interface (help, links, status), on stdout and stderr.
  "no-console": "off",
  "no-lone-blocks": "error",
  "no-shadow": ["warn", { hoist: "functions" }],
} as const;

/** typescript-eslint's recommended-type-checked (only under --type-aware). */
const typeaware = {
  "typescript/await-thenable": "warn",
  "typescript/no-array-delete": "error",
  "typescript/no-base-to-string": "error",
  "typescript/no-duplicate-type-constituents": "warn",
  "typescript/no-floating-promises": "warn",
  "typescript/no-for-in-array": "error",
  "typescript/no-implied-eval": "error",
  "typescript/no-misused-promises": "warn",
  "typescript/no-misused-spread": "error",
  "typescript/no-redundant-type-constituents": "warn",
  "typescript/no-unnecessary-type-assertion": "warn",
  "typescript/no-unsafe-argument": "warn",
  "typescript/no-unsafe-assignment": "warn",
  "typescript/no-unsafe-call": "warn",
  "typescript/no-unsafe-enum-comparison": "warn",
  "typescript/no-unsafe-member-access": "warn",
  "typescript/no-unsafe-return": "warn",
  "typescript/no-unsafe-unary-minus": "error",
  "typescript/only-throw-error": "warn",
  "typescript/prefer-promise-reject-errors": "warn",
  // Off: functions of the public interface are async on purpose — a throw anywhere in them becomes
  // a rejection the caller handles, also where nothing is awaited (yet).
  "typescript/require-await": "off",
  "typescript/restrict-plus-operands": "error",
  "typescript/restrict-template-expressions": ["error", { allowNullish: true, allow: [{ name: "Date", from: "lib" }] }],
  "typescript/unbound-method": "warn",
} as const;

export default defineConfig({
  plugins: ["typescript"],
  categories: { correctness: "off" },
  env: { builtin: true, node: true },
  ignorePatterns: ["**/node_modules/**", "**/dist/**"],
  rules: { ...general, ...typeaware },
  overrides: [
    {
      // The examples are plain JavaScript (they run on any Node): the type-checked rules see `any`.
      files: ["example/**"],
      rules: {
        "typescript/no-unsafe-assignment": "off",
        "typescript/no-unsafe-member-access": "off",
        "typescript/no-unsafe-call": "off",
        "typescript/no-unsafe-argument": "off",
        "typescript/no-unsafe-return": "off",
      },
    },
    {
      // Tests build fixtures loosely (`as never`, `!` on what they just set up, async fakes).
      files: ["test/**"],
      rules: {
        "typescript/no-unsafe-assignment": "off",
        "typescript/no-unsafe-member-access": "off",
        "typescript/no-unsafe-call": "off",
        "typescript/no-unsafe-argument": "off",
        "typescript/no-unsafe-return": "off",
        "typescript/no-unnecessary-type-assertion": "off",
        "typescript/no-misused-promises": "off",
      },
    },
  ],
});
