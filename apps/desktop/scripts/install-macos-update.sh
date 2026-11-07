#!/bin/bash
set -euo pipefail

umask 077

fail_update() {
  local target_app="$1"
  local archive="$2"
  local version="$3"
  local result_file="$4"
  printf '{"status":"failed","version":"%s"}\n' "$version" > "$result_file"
  /usr/bin/osascript -e 'display dialog "Upstand could not apply the update. The previous version will be reopened; try again from Settings." buttons {"OK"} with title "Upstand update failed"' >/dev/null 2>&1 || true
  /usr/bin/open "$target_app" >/dev/null 2>&1 || true
  if [[ -n "${work_dir:-}" ]]; then rm -rf "$work_dir"; fi
  rm -rf "$(dirname "$archive")"
}

replace_app() {
  local target_app="$1"
  local source_app="$2"
  local staging_app="${target_app}.upstand-staging-$$"
  local backup_app="${target_app}.upstand-backup-$$"
  if [[ -e "$backup_app" || -e "$staging_app" ]]; then
    return 1
  fi
  if ! /usr/bin/ditto "$source_app" "$staging_app"; then
    /bin/rm -rf "$staging_app"
    return 1
  fi
  if [[ ! -x "$staging_app/Contents/MacOS/upstand" ]]; then
    /bin/rm -rf "$staging_app"
    return 1
  fi
  if ! /bin/mv "$target_app" "$backup_app"; then
    /bin/rm -rf "$staging_app"
    return 1
  fi
  if ! /bin/mv "$staging_app" "$target_app"; then
    /bin/rm -rf "$staging_app"
    /bin/mv "$backup_app" "$target_app"
    return 1
  fi
  if [[ ! -x "$target_app/Contents/MacOS/upstand" ]]; then
    /bin/rm -rf "$target_app"
    /bin/mv "$backup_app" "$target_app"
    return 1
  fi
  /bin/rm -rf "$backup_app"
}

if [[ "${1:-}" == "--replace" ]]; then
  shift
  replace_app "$1" "$2"
  exit $?
fi

if [[ "$#" -ne 5 ]]; then
  exit 2
fi

target_app="$1"
archive="$2"
version="$3"
parent_pid="$4"
result_file="$5"
target_name="$(/usr/bin/basename "$target_app")"
work_dir="$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/upstand-desktop-update.XXXXXX")"

while /bin/kill -0 "$parent_pid" 2>/dev/null; do
  /bin/sleep 1
done

if ! /usr/bin/unzip -Z1 "$archive" | /usr/bin/awk '
  /^\// || /^[A-Za-z]:/ { exit 1 }
  {
    count = split($0, parts, "/")
    for (index = 1; index <= count; index++) {
      if (parts[index] == "..") exit 1
    }
  }
'; then
  fail_update "$target_app" "$archive" "$version" "$result_file"
  exit 1
fi

if ! /usr/bin/ditto -x -k "$archive" "$work_dir/extracted"; then
  fail_update "$target_app" "$archive" "$version" "$result_file"
  exit 1
fi

new_app="$(/usr/bin/find "$work_dir/extracted" -type d -name '*.app' -print -quit)"
if [[ -z "$new_app" || "$(/usr/bin/tr '[:upper:]' '[:lower:]' <<< "$(/usr/bin/basename "$new_app")")" != "$(/usr/bin/tr '[:upper:]' '[:lower:]' <<< "$target_name")" ]]; then
  fail_update "$target_app" "$archive" "$version" "$result_file"
  exit 1
fi

if [[ -w "$(/usr/bin/dirname "$target_app")" ]]; then
  if ! replace_app "$target_app" "$new_app"; then
    fail_update "$target_app" "$archive" "$version" "$result_file"
    exit 1
  fi
else
  if ! /usr/bin/osascript - "$0" "$target_app" "$new_app" <<'APPLESCRIPT'
on run argv
  set helperPath to item 1 of argv
  set targetPath to item 2 of argv
  set sourcePath to item 3 of argv
  do shell script "/bin/bash " & quoted form of helperPath & " --replace " & quoted form of targetPath & " " & quoted form of sourcePath with administrator privileges
end run
APPLESCRIPT
  then
    fail_update "$target_app" "$archive" "$version" "$result_file"
    exit 1
  fi
fi

/bin/rm -rf "$work_dir" "$(/usr/bin/dirname "$archive")"
/usr/bin/open "$target_app" >/dev/null 2>&1
