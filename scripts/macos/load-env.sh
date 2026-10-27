#!/bin/bash
# ─── Reading the .env file ───────────────────────────────────────────────────
#
# The .env is a file the *user* is told to edit, so its values are not
# shell-safe. It used to be `source`d, which runs it as shell code:
#
#   DISPLAY_NAME=My App            -> "App: command not found", exit 127
#   OPENAI_API_KEY=sk-proj-a$xyz   -> "unbound variable", or the key
#                                     silently truncated to `sk-proj-a`
#
# The second one is the worse of the two: a secret that is quietly half
# a secret, and an "invalid API key" from the provider that has nothing
# to do with the real cause.
#
# So the file is *read*, not executed: `KEY=value`, one per line, with
# the value taken literally — no expansion, no command substitution, no
# word splitting, no globbing. The quotes, if there are any, are quotes
# and not part of the value.
#
# This is a library: it defines one function and does nothing else.

# load_env_file <path>
#
# Reads the file and exports every assignment in it.
load_env_file() {
  local _env_file="$1"
  [ -f "$_env_file" ] || return 0

  local _env_line _env_key _env_value
  while IFS= read -r _env_line || [ -n "$_env_line" ]; do
    # Skip the blank lines and the comments.
    case "$_env_line" in
      ""|\#*) continue ;;
    esac
    # Skip the export prefix, if there is one.
    _env_line="${_env_line#export }"
    # Only a real assignment counts.
    case "$_env_line" in
      *=*) ;;
      *) continue ;;
    esac
    _env_key="${_env_line%%=*}"
    _env_value="${_env_line#*=}"
    # The key has to be a name, or the shell would not take it either.
    case "$_env_key" in
      [A-Za-z_]* ) ;;
      * ) continue ;;
    esac
    # The quotes, if there are any, are quotes — not part of the value.
    case "$_env_value" in
      \"*\") _env_value="${_env_value#\"}"; _env_value="${_env_value%\"}" ;;
      \'*\') _env_value="${_env_value#\'}"; _env_value="${_env_value%\'}" ;;
    esac
    export "$_env_key=$_env_value"
  done < "$_env_file"
}
