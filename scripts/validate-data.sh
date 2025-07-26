#!/bin/bash
set -e

echo "Starting validation of changed JSON files..."

CHANGED_FILES=$1

if [ -z "$CHANGED_FILES" ]; then
  echo "No changed files detected. Exiting."
  exit 0
fi

JSON_FILES=$(echo "$CHANGED_FILES" | tr ' ' '\n' | grep '^data/.*\.json$')

if [ -z "$JSON_FILES" ]; then
  echo "No changed data files (.json) in 'data/' directory. Skipping."
  exit 0
fi

HAS_ERROR=false

validate_mode() {
  local file=$1
  local mode=$2
  local has_error=false

  for key in "resolution_type" "fps_behavior" "target_fps"; do
    if ! jq -e ".\"$mode\" | has(\"$key\")" "$file" >/dev/null; then
      echo "ERROR: $mode is missing required key: '$key'."
      has_error=true
    fi
  done

  res_type=$(jq -r ".\"$mode\".resolution_type" "$file")
  if [[ "$res_type" != "Fixed" && "$res_type" != "Dynamic" && "$res_type" != "Multiple Fixed" ]]; then
    echo "ERROR: $mode.resolution_type must be 'Fixed', 'Dynamic', or 'Multiple Fixed', but found '$res_type'."
    has_error=true
  fi

  fps_behavior=$(jq -r ".\"$mode\".fps_behavior" "$file")
  if [[ "$fps_behavior" != "Locked" && "$fps_behavior" != "Unlocked" ]]; then
    echo "ERROR: $mode.fps_behavior must be 'Locked' or 'Unlocked', but found '$fps_behavior'."
    has_error=true
  fi

  fps_type=$(jq -r ".\"$mode\".target_fps | type" "$file")
  if [ "$fps_type" != "number" ]; then
    echo "ERROR: $mode.target_fps must be a number, but found '$fps_type'."
    has_error=true
  fi

  if [ "$has_error" = true ]; then
    return 1
  else
    return 0
  fi
}

for file in $JSON_FILES; do
  echo ""
  echo "Validating: $file"

  CURRENT_FILE_HAS_ERROR=false

  if ! jq -e . "$file" >/dev/null 2>&1; then
    echo "ERROR: Invalid JSON format."
    CURRENT_FILE_HAS_ERROR=true
  else
    if ! validate_mode "$file" "docked"; then
      CURRENT_FILE_HAS_ERROR=true
    fi
    if ! validate_mode "$file" "handheld"; then
      CURRENT_FILE_HAS_ERROR=true
    fi
  fi

  if [ "$CURRENT_FILE_HAS_ERROR" = true ]; then
    HAS_ERROR=true
    echo "*** Validation FAILED for $file"
  else
    echo "* Validation PASSED for $file"
  fi
done

echo ""
if [ "$HAS_ERROR" = true ]; then
  echo "Validation failed for one or more files."
  exit 1
else
  echo "All changed data files passed validation!"
  exit 0
fi