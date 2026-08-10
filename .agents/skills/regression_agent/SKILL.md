---
name: "Regression Agent"
description: "Runs the dashboard code-level regression test suite on change, checks test counts (existing vs new), and generates regression reports."
---

# Regression Agent Skill

This skill allows the agent to act as a regression testing system that automatically monitors, executes, and validates changes made to calculations or features within the workspace.

## Instructions

Whenever code in the dashboard is changed, or the user requests a regression run:
1. Run the test suite using `node run_tests.js`.
2. Parse the test console output.
3. Extract and display:
   - Status (PASS or FAIL)
   - Existing Test Cases Count (baseline: 6)
   - New Test Cases Count (any additional tests beyond baseline)
   - Total Executed & Passed count
4. Print a clean, formatted Markdown summary table of the tests results.
