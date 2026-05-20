---
applyTo: "**/*"
excludeAgent: ""
---
# STRICT COPILOT CLOUD REVIEW BOUNDARIES

## 🚨 TOKEN AND SESSION PROTECTION
- This file explicitly applies to all files (**/*) during automated execution loops.
- You are strictly forbidden from executing a full repository tree crawl. 
- You must operate exclusively on the provided pull request git diff hunks (--diff-only context matching).

## 🚫 EXCLUSIONS
- Do NOT spider or read surrounding code files outside the immediate active changes.
- Completely ignore and bypass all pnpm-lock.yaml, node_modules, build targets, dist/ folders, and local environment files (.env).
- If background processing limits or token constraints approach systemic thresholds, truncate analysis immediately.

## 📝 OUTPUT FORMFACTOR
- Respond strictly using a tiny Markdown table format: `[File : Line] | [Defect] | [Correction]`.
- Eliminate all conversational fluff, polite intros, or high-level summaries. Start directly with the table to save output tokens.