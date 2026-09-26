# Git safety for Claude Code

Claude may work on other branches, but it can't change `main` or push.

How it works:

- Claude Code sets `CLAUDECODE=1` in every shell it runs. A normal terminal doesn't.
- `reference-transaction` refuses any change to `main` when that is set. `pre-push` refuses every push.
- At each session start, `.claude/settings.json` copies both into `.git/hooks/`, where checkouts can't
  remove them.
- `.claude/hooks/guard.sh` stops Claude from switching them off. It blocks `--no-verify` and similar
  commands, and edits to these files, to `.git/` and to Claude Code's settings files.

Claude Code's IDE extensions also set `CLAUDECODE=1` in the IDE's built-in terminal, so git commands
typed there are blocked like Claude's. Use a normal terminal for those.

This stops mistakes. It can't stop a Claude that deliberately hides a command, for example in a script
file.

To use in another project: copy `.githooks/`, `.claude/hooks/` and the `hooks` block of
`.claude/settings.json`, and make sure `.gitignore` doesn't ignore them. Needs `jq` and git 2.31+. Any
`pre-push` or `reference-transaction` already in `.git/hooks/` gets overwritten. If `core.hooksPath` is
set (Husky, for example), these hooks don't run. If your main branch isn't `main`, change it in
`reference-transaction`.
