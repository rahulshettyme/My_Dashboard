# Project Rules

## Health Module SOP Constraint
- BEFORE proposing or executing any code modifications to the Crop Health module, you MUST read the Health Module SOP document at [HEALTH_MODULE_SOP.md](file:///c:/Users/rahul.shetty/Documents/Important/AntiGravity/My%20dashboard/HEALTH_MODULE_SOP.md) to understand current math, logic rules, and historical changes.

## Yield Module SOP Constraint
- BEFORE proposing or executing any code modifications to the Yield & Harvest module, you MUST read the Yield Module SOP document at [YIELD_MODULE_SOP.md](file:///c:/Users/rahul.shetty/Documents/Important/AntiGravity/My%20dashboard/YIELD_MODULE_SOP.md) to understand priority hierarchies, conversion math, and historical changes.


## Automation Testing Constraint
- Do NOT perform automation testing (e.g. using browser subagents or automated browser scripts) unless explicitly requested by the USER.

## Git Operations Constraint
- Never perform any git operations (e.g. git status, git pull, git push, git diff, etc.) in this project automatically.
- Ask explicitly if only needed to check previous git pushes or compare code. NEVER do any git pull or push automatically.

## Verification Workflow (Highest Priority Rule)
- Once code changes are completed, perform the following verification workflow:
  1. **Code Review**: Conduct a thorough review of the code edits for correctness, quality, and style.
  2. **Regression Testing**: You MUST execute the regression test suite by running `node run_tests.js` on every code change to confirm all unit tests pass, and report the counts of existing vs. new test cases in your response.
  3. **Manual Verification Request**: Inform the user of the completed work and prompt them to do manual testing to confirm.
  4. **Commit Message**: Provide a descriptive git commit/push message at the end of your response summarizing the changes made (do not run any git commands yourself).

