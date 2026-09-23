# Project Rules

## Health Module SOP Constraint
- BEFORE proposing or executing any code modifications to the Crop Health module, you MUST read the Health Module SOP document at [HEALTH_MODULE_SOP.md](file:///c:/Users/rahul.shetty/Documents/Important/AntiGravity/My%20dashboard/HEALTH_MODULE_SOP.md) to understand current math, logic rules, and historical changes.

## Yield Module SOP Constraint
- BEFORE proposing or executing any code modifications to the Yield & Harvest module, you MUST read the Yield Module SOP document at [YIELD_MODULE_SOP.md](file:///c:/Users/rahul.shetty/Documents/Important/AntiGravity/My%20dashboard/YIELD_MODULE_SOP.md) to understand priority hierarchies, conversion math, and historical changes.


## SOP-First Lookup & Backfill Rule
- Whenever you need to look up a formula, logic rule, threshold, default value, field name, or behavior for the Health or Yield module (e.g. to answer a question, or to understand existing behavior before making a change), **check the relevant SOP first** ([HEALTH_MODULE_SOP.md](file:///c:/Users/rahul.shetty/Documents/Important/AntiGravity/My%20dashboard/HEALTH_MODULE_SOP.md) / [YIELD_MODULE_SOP.md](file:///c:/Users/rahul.shetty/Documents/Important/AntiGravity/My%20dashboard/YIELD_MODULE_SOP.md)) rather than immediately searching or re-deriving it from the codebase. If the SOP already documents it, use that as the answer.
- Only if the item is **not found** in the SOP should you search the actual code to find it.
- Once found in code, **add it to the SOP as part of that same task** (per the SOP Update Constraint below) so the same lookup never requires a code search again. Over time this keeps the SOP growing into a complete reference, reducing repeated full-codebase searches in future conversations.
- This does not relax the requirement to verify against actual code before executing a code change — the SOP is a fast-path for lookups and answering questions, not a substitute for confirming current code behavior when a change is about to be made to logic the SOP covers.

## SOP Update Constraint
- If a code change alters the math, logic, priority hierarchies, or conversion rules documented in [HEALTH_MODULE_SOP.md](file:///c:/Users/rahul.shetty/Documents/Important/AntiGravity/My%20dashboard/HEALTH_MODULE_SOP.md) or [YIELD_MODULE_SOP.md](file:///c:/Users/rahul.shetty/Documents/Important/AntiGravity/My%20dashboard/YIELD_MODULE_SOP.md), the relevant SOP MUST be updated to reflect the change as part of that same task, before the work is considered complete. This prevents the SOP from going stale and misleading future conversations that rely on it for context.
- Any such SOP edit MUST be explicitly called out in the response, the same way other file changes are reported — do not let it pass silently as an incidental edit.

## Automation Testing Constraint
- Do NOT perform automation testing (e.g. using browser subagents or automated browser scripts) unless explicitly requested by the USER.

## Git Operations Constraint
- Never perform any git operations (e.g. git status, git pull, git push, git diff, etc.) in this project automatically.
- Ask explicitly if only needed to check previous git pushes or compare code. NEVER do any git pull or push automatically.

## Verification Workflow (Highest Priority Rule)
- Once code changes are completed, perform the following verification workflow:
  1. **Code Review**: Conduct a thorough review of the code edits for correctness, quality, and style.
  2. **Regression Testing**: You MUST execute the regression test suite by running the exact command `node run_tests.js` from the project root on every code change. Running the suite any other way (e.g. manually calling `runSuite()`, invoking `health_script.test.js` directly, or running it from a subdirectory) does NOT satisfy this rule, even if it produces the same pass count — the exact command must be run. Report the counts of existing vs. new test cases in your response.
  3. **Manual Verification Request**: Inform the user of the completed work and prompt them to do manual testing to confirm.
  4. **Commit Message**: Provide a descriptive git commit/push message at the end of your response summarizing the changes made (do not run any git commands yourself).
- **Completion Gate — no code-change response is considered done without this literal checklist, verbatim, as the closing block of that response:**
  ```
  ✅ Regression suite: node run_tests.js → X/X passing (Y existing, Z new)
  📝 Suggested commit message:
  <the actual commit message text, ready to copy-paste>
  ```
  This checklist is mandatory even when the user's message does not ask for it, even in short responses, and even when only documentation/SOP files changed alongside code. If the test suite was not run via `node run_tests.js`, or no commit message is included, the response is incomplete — go back and add them before replying to the user. This gate has been missed multiple times before; treat it as non-negotiable, not a nice-to-have.

