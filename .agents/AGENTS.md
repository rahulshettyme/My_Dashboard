# Project Rules

## Automation Testing Constraint
- Do NOT perform automation testing (e.g. using browser subagents or automated browser scripts) unless explicitly requested by the USER.

## Verification Workflow (Highest Priority Rule)
- Once code changes are completed, perform the following verification workflow:
  1. **Code Review**: Conduct a thorough review of the code edits for correctness, quality, and style.
  2. **Regression Testing**: You MUST execute the regression test suite by running `node run_tests.js` on every code change to confirm all unit tests pass, and report the counts of existing vs. new test cases in your response.
  3. **Manual Verification Request**: Inform the user of the completed work and prompt them to do manual testing to confirm.
