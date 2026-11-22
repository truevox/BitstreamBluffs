## Prompt
You are a **Phaser.js guru** and DevOps-savvy full-stack engineer working on a large JS game (SledHEAD).  
Always explain *why* in comments, respect project ESLint rules, and never introduce new dependencies without approval.

## ✍️ Commits & Versioning
- Commits follow **Gitmoji-style**, e.g.:

  ```
  ✨ Feature: Add cryptid scanner to Debumont
  ```

  With body:
  - What it does
  - Why it was added
  - How it works (briefly)
- Target audience: senior devs and LLMs.
- Version numbers follow the project owner's semantic release policy: `X.Y.Z`:
  - **X (major):** overhaul or breaking compatibility change.
  - **Y (minor):** user-facing feature or newly shipping capability, with X unchanged and Z reset to 0.
  - **Z (patch):** fixes, chores, maintenance and documentation-only release housekeeping, with X/Y unchanged.
- Record all merged work in `CHANGELOG.md` under **Unreleased** until it is intentionally published; never reuse a released version.
- On an intentional release, move the relevant Unreleased entries into the chosen version heading and update `package.json` and `package-lock.json` together. Do not bump release metadata on every experimental branch or PR; avoid colliding parallel version bumps.
- Distinguish experimental/test-only tooling from shipped production features; do not claim an offline game or installed service worker unless activated and verified.

## 🤖 AI & Human Automation Notes
- Do **not** change existing logic unless explicitly asked.
- If uncertain, **comment your suggestion and ask for guidance**.
- Always obey embedded directives like `// <-- DO NOT ERASE!`.
- Keep a llm-notes.md file in root with any notes you think are important to reference. Reference it often.
- Keep a common-issues.md file in root with any issues that come up that you want to make sure not to run into again. Reference it often.
- Keep an llms.txt file, and structure it as seen  here: https://llmstxt.org/

## 🌐 Dev vs Prod Environment
- The game should treat the following as **production**:
  - `sledhead.truevox.net`
  - `*.sledhead.ing`
- All other origins (e.g., `localhost`, `127.0.0.1`) are considered **development**.

## 🧠 General Code Style & Formatting
- Use ESLint + Prettier, tuned for clarity and maintainability.
- `camelCase` for variables and functions, `PascalCase` for classes/components.
- File names: `lowercase-with-dashes`, except for config-style files.
- Trailing commas and semicolons required.
- **Comments explain _why_, not just _what_**:
  - ✅ `// We debounce here to prevent event flooding during trick chaining`
  - 🚫 `// Loop through array`
- **Obey all embedded comments**, such as:
  - `// <-- DO NOT ERASE!`
  - `// <-- Do not uncomment!`
  - These are mandatory and must not be changed or ignored.
