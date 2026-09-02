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
public_base_url=${OTA_PUBLIC_BASE_URL:-https://reminder.geniusqi.com/releases}
remote_root=${OTA_REMOTE_ROOT:-/opt/reminder/tmp}
container_name=${OTA_CONTAINER_NAME:-reminder_app}
container_release_root=${OTA_CONTAINER_RELEASE_ROOT:-/data/releases}
required=${OTA_REQUIRED:-false}
[[ $app_slug =~ ^[a-z0-9_-]{2,40}$ ]] || { echo "app slug 不合法" >&2; exit 2; }
[[ $application_id =~ ^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$ ]] || { echo "application id 不合法" >&2; exit 2; }
[[ $version_code =~ ^[1-9][0-9]*$ ]] || { echo "version code 不合法" >&2; exit 2; }
[[ $version_name =~ ^[A-Za-z0-9][A-Za-z0-9._+-]{0,39}$ ]] || { echo "version name 不合法" >&2; exit 2; }
[[ -f $apk ]] || { echo "APK 不存在: $apk" >&2; exit 2; }
[[ $public_base_url == https://* ]] || { echo "公开下载地址必须是 HTTPS" >&2; exit 2; }
[[ $remote_root =~ ^/[A-Za-z0-9._/-]+$ && $container_release_root =~ ^/[A-Za-z0-9._/-]+$ ]] || { echo "发布目录不合法" >&2; exit 2; }
[[ $container_name =~ ^[A-Za-z0-9_.-]+$ ]] || { echo "容器名不合法" >&2; exit 2; }
[[ $required == true || $required == false ]] || { echo "OTA_REQUIRED 只能是 true 或 false" >&2; exit 2; }
public_base_url=${public_base_url%/}

project_root=$(cd "$(dirname "$0")/../.." && pwd)
stage="$project_root/tmp/ota-$app_slug"
mkdir -p "$stage"

if [[ ${OTA_SKIP_APK_METADATA_CHECK:-0} != 1 ]]; then
  sdk_dir=${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}
  if [[ -z $sdk_dir && -f $project_root/local.properties ]]; then
    sdk_dir=$(sed -n 's/^sdk\.dir=//p' "$project_root/local.properties" | head -1)
  fi
  apkanalyzer=$(command -v apkanalyzer || true)
  if [[ -z $apkanalyzer && -n $sdk_dir && -d $sdk_dir/cmdline-tools ]]; then
    apkanalyzer=$(find "$sdk_dir/cmdline-tools" -type f -path '*/bin/apkanalyzer' | sort -V | tail -1)
  fi
  [[ -n $apkanalyzer && -x $apkanalyzer ]] || { echo "找不到 apkanalyzer，无法核对 APK；仅紧急情况可显式设置 OTA_SKIP_APK_METADATA_CHECK=1" >&2; exit 2; }
  actual_application_id=$($apkanalyzer manifest application-id "$apk")
  actual_version_code=$($apkanalyzer manifest version-code "$apk")
  actual_version_name=$($apkanalyzer manifest version-name "$apk")
  [[ $actual_application_id == "$application_id" ]] || { echo "APK 包名不匹配: $actual_application_id" >&2; exit 2; }
  [[ $actual_version_code == "$version_code" ]] || { echo "APK versionCode 不匹配: $actual_version_code" >&2; exit 2; }
  [[ $actual_version_name == "$version_name" ]] || { echo "APK versionName 不匹配: $actual_version_name" >&2; exit 2; }
fi

apk_name="$app_slug-$version_name.apk"
cp "$apk" "$stage/$apk_name"
sha256=$(sha256sum "$stage/$apk_name" | cut -d' ' -f1)
size=$(stat -c %s "$stage/$apk_name")
published_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)

node -e 'const fs=require("fs");const [file,applicationId,versionCode,versionName,apkUrl,sha256,size,notes,publishedAt,required]=process.argv.slice(1);fs.writeFileSync(file,JSON.stringify({applicationId,versionCode:Number(versionCode),versionName,apkUrl,sha256,size:Number(size),notes,required:required==="true",publishedAt},null,2)+"\n")' \
  "$stage/stable.json" "$application_id" "$version_code" "$version_name" "$public_base_url/$app_slug/$apk_name" "$sha256" "$size" "$notes" "$published_at" "$required"

if [[ ${OTA_DRY_RUN:-0} == 1 ]]; then
  echo "已生成但未上传: $stage/stable.json"
  exit 0
fi

remote_stage="$remote_root/ota-$app_slug"
ssh "$server" "mkdir -p '$remote_stage'"
scp "$stage/$apk_name" "$stage/stable.json" "$server:$remote_stage/"
ssh "$server" "docker exec '$container_name' mkdir -p '$container_release_root/$app_slug' && docker cp '$remote_stage/$apk_name' '$container_name:$container_release_root/$app_slug/$apk_name' && docker cp '$remote_stage/stable.json' '$container_name:$container_release_root/$app_slug/stable.json' && docker exec -u 0 '$container_name' chmod 0644 '$container_release_root/$app_slug/$apk_name' '$container_release_root/$app_slug/stable.json'"
echo "已发布: $public_base_url/$app_slug/stable.json"
