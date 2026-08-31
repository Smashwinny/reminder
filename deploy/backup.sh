#!/bin/sh
set -eu
project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
backup_dir="$project_root/backups"
mkdir -p "$backup_dir"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
archive="$backup_dir/reminder-data-$stamp.tar.gz"
data_volume=${REMINDER_DATA_VOLUME:-reminder_data}
docker run --rm -v "$data_volume:/source:ro" -v "$backup_dir:/backup" alpine:3.20 \
  tar -czf "/backup/$(basename "$archive")" -C /source .
(cd "$backup_dir" && sha256sum "$(basename "$archive")" > "$(basename "$archive").sha256")
find "$backup_dir" -maxdepth 1 -type f \( -name 'reminder-data-*.tar.gz' -o -name 'reminder-data-*.tar.gz.sha256' \) -mtime +14 -delete
echo "$archive"
