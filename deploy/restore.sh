#!/bin/sh
set -eu
if [ "$#" -ne 1 ]; then echo "用法：deploy/restore.sh backups/reminder-data-时间.tar.gz" >&2; exit 2; fi
archive=$(realpath "$1")
test -f "$archive"
archive_dir=$(dirname "$archive")
archive_name=$(basename "$archive")
data_volume=${REMINDER_DATA_VOLUME:-reminder_data}
if [ -f "$archive.sha256" ]; then (cd "$archive_dir" && sha256sum -c "$archive_name.sha256"); fi
echo "将覆盖 reminder_data 数据卷。输入 RESTORE 确认："
read -r answer
test "$answer" = RESTORE
docker compose -f "$(dirname "$0")/docker-compose.yml" down
docker run --rm -v "$data_volume:/target" -v "$archive_dir:/backup:ro" alpine:3.20 \
  sh -c 'find /target -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + && tar -xzf "/backup/'"$archive_name"'" -C /target'
docker compose -f "$(dirname "$0")/docker-compose.yml" up -d
