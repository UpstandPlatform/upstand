#!/bin/sh
set -eu

umask 077

write_failure() {
  result_file=$1
  version=$2
  printf '{"status":"failed","version":"%s"}\n' "$version" > "$result_file"
  if command -v notify-send >/dev/null 2>&1; then
    notify-send "Upstand update failed" "The previous version was restored. Retry from Settings."
  fi
}

replace_app() {
  target_root=$1
  archive=$2
  executable_name=$3
  parent_dir=$(dirname "$target_root")
  work_dir=$(mktemp -d "$parent_dir/.upstand-update.XXXXXX") || return 1
  backup_root="${target_root}.upstand-backup-$$"
  if ! unzip -Z1 "$archive" | awk '
    /^\// || /^[A-Za-z]:/ { exit 1 }
    {
      gsub(/\\\\/, "/")
      count = split($0, parts, "/")
      for (index = 1; index <= count; index++) {
        if (parts[index] == "..") exit 1
      }
    }
  '; then
    rm -rf "$work_dir"
    return 1
  fi
  if ! unzip -q "$archive" -d "$work_dir/extracted"; then
    rm -rf "$work_dir"
    return 1
  fi
  app_asar=$(find "$work_dir/extracted" -type f -path '*/resources/app.asar' -print -quit)
  if [ -z "$app_asar" ]; then
    rm -rf "$work_dir"
    return 1
  fi
  resources_dir=$(dirname "$app_asar")
  new_root=$(dirname "$resources_dir")
  if [ ! -x "$new_root/$executable_name" ] || [ -e "$backup_root" ]; then
    rm -rf "$work_dir"
    return 1
  fi
  if ! mv "$target_root" "$backup_root"; then
    rm -rf "$work_dir"
    return 1
  fi
  if ! mv "$new_root" "$target_root"; then
    mv "$backup_root" "$target_root"
    rm -rf "$work_dir"
    return 1
  fi
  if [ ! -x "$target_root/$executable_name" ]; then
    rm -rf "$target_root"
    mv "$backup_root" "$target_root"
    rm -rf "$work_dir"
    return 1
  fi
  rm -rf "$backup_root" "$work_dir"
}

if [ "${1:-}" = "--replace" ]; then
  shift
  replace_app "$1" "$2" "$3"
  exit $?
fi

if [ "$#" -ne 6 ]; then
  exit 2
fi

target_root=$1
archive=$2
executable_name=$3
version=$4
parent_pid=$5
result_file=$6

while kill -0 "$parent_pid" 2>/dev/null; do
  sleep 1
done

parent_dir=$(dirname "$target_root")
if [ -w "$parent_dir" ]; then
  if ! replace_app "$target_root" "$archive" "$executable_name"; then
    write_failure "$result_file" "$version"
    if [ -x "$target_root/$executable_name" ]; then
      nohup "$target_root/$executable_name" >/dev/null 2>&1 &
    fi
    exit 1
  fi
else
  if ! command -v pkexec >/dev/null 2>&1 || ! pkexec /bin/sh "$0" --replace "$target_root" "$archive" "$executable_name"; then
    write_failure "$result_file" "$version"
    if [ -x "$target_root/$executable_name" ]; then
      nohup "$target_root/$executable_name" >/dev/null 2>&1 &
    fi
    exit 1
  fi
fi

rm -rf "$(dirname "$archive")"
nohup "$target_root/$executable_name" >/dev/null 2>&1 &
