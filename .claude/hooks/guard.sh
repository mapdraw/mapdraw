#!/bin/sh
# PreToolUse guard: stop Claude from bypassing or editing the git safety hooks.
command -v jq >/dev/null || { echo "Blocked: the git safety guard needs jq." >&2; exit 2; }
input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')
path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty')
if printf '%s' "$cmd" | grep -qiE -- '--no-v|CLAUDECODE|hooksPath|disableAllHooks|env[[:space:]]+(-[a-z]*i|--ignore-environment)|\.githooks|\.git/hooks|\.claude/(hooks|settings)' ||
  printf '%s' "$path" | grep -qiE '(^|/)(\.git|\.githooks|\.claude/hooks)/|\.claude/settings'; then
  echo "Blocked: this could bypass the git safety hooks (see .githooks/README.md)." >&2
  exit 2
fi
