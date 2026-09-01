#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 7 ]]; then
  echo "用法: $0 <app-slug> <application-id> <version-code> <version-name> <apk> <notes> <server>" >&2
  exit 2
fi

app_slug=$1
application_id=$2
version_code=$3
version_name=$4
apk=$5
notes=$6
server=$7
[[ $app_slug =~ ^[a-z0-9_-]{2,40}$ ]] || { echo "app slug 不合法" >&2; exit 2; }
[[ $version_code =~ ^[1-9][0-9]*$ ]] || { echo "version code 不合法" >&2; exit 2; }
[[ -f $apk ]] || { echo "APK 不存在: $apk" >&2; exit 2; }

project_root=$(cd "$(dirname "$0")/../.." && pwd)
stage="$project_root/tmp/ota-$app_slug"
mkdir -p "$stage"
apk_name="$app_slug-$version_name.apk"
cp "$apk" "$stage/$apk_name"
sha256=$(sha256sum "$stage/$apk_name" | cut -d' ' -f1)
size=$(stat -c %s "$stage/$apk_name")
published_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)

node -e 'const fs=require("fs");const [file,applicationId,versionCode,versionName,apkUrl,sha256,size,notes,publishedAt]=process.argv.slice(1);fs.writeFileSync(file,JSON.stringify({applicationId,versionCode:Number(versionCode),versionName,apkUrl,sha256,size:Number(size),notes,required:false,publishedAt},null,2)+"\n")' \
  "$stage/stable.json" "$application_id" "$version_code" "$version_name" "https://reminder.geniusqi.com/releases/$app_slug/$apk_name" "$sha256" "$size" "$notes" "$published_at"

ssh "$server" "mkdir -p /opt/reminder/tmp/ota-$app_slug"
scp "$stage/$apk_name" "$stage/stable.json" "$server:/opt/reminder/tmp/ota-$app_slug/"
ssh "$server" "docker exec reminder_app mkdir -p /data/releases/$app_slug && docker cp /opt/reminder/tmp/ota-$app_slug/$apk_name reminder_app:/data/releases/$app_slug/$apk_name && docker cp /opt/reminder/tmp/ota-$app_slug/stable.json reminder_app:/data/releases/$app_slug/stable.json && docker exec -u 0 reminder_app chmod 0644 /data/releases/$app_slug/$apk_name /data/releases/$app_slug/stable.json"
echo "已发布: https://reminder.geniusqi.com/releases/$app_slug/stable.json"
