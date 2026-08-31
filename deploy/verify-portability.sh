#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
run_id=$$
source_volume="reminder_verify_source_$run_id"
target_volume="reminder_verify_target_$run_id"
source_container="reminder_verify_source_$run_id"
target_container="reminder_verify_target_$run_id"
work="$project_root/tmp/portability-$run_id"
port=${REMINDER_VERIFY_PORT:-18787}
mkdir -p "$work"

cleanup() {
  docker rm -f "$source_container" "$target_container" >/dev/null 2>&1 || true
  docker volume rm "$source_volume" "$target_volume" >/dev/null 2>&1 || true
  rm -rf -- "$work"
}
trap cleanup EXIT INT TERM

docker build -t reminder-sync:verify "$project_root/sync-server" >/dev/null
docker volume create "$source_volume" >/dev/null
docker run -d --name "$source_container" -p "127.0.0.1:$port:8787" \
  -v "$source_volume:/data" -e REGISTRATION_INVITE_CODE=portable-test-invite reminder-sync:verify >/dev/null

for unused in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS "http://127.0.0.1:$port/api/healthz" >/dev/null 2>&1; then break; fi
  sleep 1
done
register=$(curl -fsS -X POST "http://127.0.0.1:$port/api/auth/register" -H 'content-type: application/json' \
  --data '{"username":"portable_user","password":"portable-password","inviteCode":"portable-test-invite"}')
token=$(node -e 'const fs=require("fs");process.stdout.write(JSON.parse(fs.readFileSync(0,"utf8")).token)' <<EOF
$register
EOF
)
curl -fsS -X POST "http://127.0.0.1:$port/api/sync" -H 'content-type: application/json' \
  -H "authorization: Bearer $token" --data '{"mode":"upload","tasks":[{"id":"portable-proof","text":"换服务器后仍存在","createdAt":1,"updatedAt":1}]}' >/dev/null
docker rm -f "$source_container" >/dev/null

docker run --rm -v "$source_volume:/source:ro" -v "$work:/backup" alpine:3.20 tar -czf /backup/data.tar.gz -C /source .
docker volume create "$target_volume" >/dev/null
docker run --rm -v "$target_volume:/target" -v "$work:/backup:ro" alpine:3.20 tar -xzf /backup/data.tar.gz -C /target
docker run -d --name "$target_container" -p "127.0.0.1:$port:8787" \
  -v "$target_volume:/data" -e REGISTRATION_INVITE_CODE=portable-test-invite reminder-sync:verify >/dev/null
for unused in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS "http://127.0.0.1:$port/api/healthz" >/dev/null 2>&1; then break; fi
  sleep 1
done
login=$(curl -fsS -X POST "http://127.0.0.1:$port/api/auth/login" -H 'content-type: application/json' \
  --data '{"username":"portable_user","password":"portable-password"}')
restored_token=$(node -e 'const fs=require("fs");process.stdout.write(JSON.parse(fs.readFileSync(0,"utf8")).token)' <<EOF
$login
EOF
)
result=$(curl -fsS -X POST "http://127.0.0.1:$port/api/sync" -H 'content-type: application/json' \
  -H "authorization: Bearer $restored_token" --data '{"mode":"download","tasks":[]}')
node -e 'const fs=require("fs");const x=JSON.parse(fs.readFileSync(0,"utf8"));if(!x.tasks.some(t=>t.id==="portable-proof"))process.exit(1)' <<EOF
$result
EOF
echo "PORTABILITY VERIFIED: account and task restored into a fresh volume"
