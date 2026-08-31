#!/bin/sh
set -eu

ssh_host=${REMINDER_SSH_HOST:-root@8.153.101.153}
ssh_key=${REMINDER_SSH_KEY:-/home/hulk/.ssh/id_ed25519_reminder_server}
base_url=${REMINDER_BASE_URL:-https://reminder.geniusqi.com}
package=${REMINDER_ANDROID_PACKAGE:-com.smashwinny.reminder}
temp_user="isolation_test_$$"
temp_password=$(openssl rand -hex 16)
test_task="isolation-proof-$$"
created=0

cleanup() {
  [ "$created" -eq 1 ] || return 0
  ssh -i "$ssh_key" "$ssh_host" "docker exec -e TEST_USERNAME='$temp_user' reminder_app node -e 'const fs=require(\"fs\"),p=\"/data\",n=process.env.TEST_USERNAME;const users=JSON.parse(fs.readFileSync(p+\"/users.json\"));const u=users.find(x=>x.username===n);if(!u)process.exit(0);const atomic=(f,v)=>{fs.writeFileSync(f+\".next\",JSON.stringify(v,null,2),{mode:0o600});fs.renameSync(f+\".next\",f)};atomic(p+\"/users.json\",users.filter(x=>x.id!==u.id));let sessions=[];try{sessions=JSON.parse(fs.readFileSync(p+\"/sessions.json\"))}catch{}atomic(p+\"/sessions.json\",sessions.filter(x=>x.userId!==u.id));fs.rmSync(p+\"/users/\"+u.id,{recursive:true,force:true})'" >/dev/null
}
trap cleanup EXIT INT TERM

owner_token=$(adb shell run-as "$package" cat shared_prefs/tasks_v1.xml | sed -n 's/.*name="auth_token">\([^<]*\)<.*/\1/p' | tr -d '\r')
[ ${#owner_token} -ge 32 ]
invite=$(ssh -i "$ssh_key" "$ssh_host" "sed -n 's/^REGISTRATION_INVITE_CODE=//p' /opt/reminder/deploy/.env")
[ ${#invite} -ge 12 ]

register=$(curl -fsS -X POST "$base_url/api/auth/register" -H 'content-type: application/json' \
  --data "{\"username\":\"$temp_user\",\"password\":\"$temp_password\",\"inviteCode\":\"$invite\"}")
created=1
temp_token=$(printf '%s' "$register" | node -e 'const fs=require("fs");process.stdout.write(JSON.parse(fs.readFileSync(0,"utf8")).token)')

curl -fsS -X POST "$base_url/api/sync" -H 'content-type: application/json' -H "authorization: Bearer $temp_token" \
  --data "{\"mode\":\"upload\",\"tasks\":[{\"id\":\"$test_task\",\"text\":\"隔离测试\",\"createdAt\":1,\"updatedAt\":1}]}" >/dev/null
owner_result=$(curl -fsS -X POST "$base_url/api/sync" -H 'content-type: application/json' -H "authorization: Bearer $owner_token" --data '{"mode":"download","tasks":[]}')
temp_result=$(curl -fsS -X POST "$base_url/api/sync" -H 'content-type: application/json' -H "authorization: Bearer $temp_token" --data '{"mode":"download","tasks":[]}')
OWNER_RESULT="$owner_result" TEMP_RESULT="$temp_result" TEST_TASK="$test_task" node -e '
const owner=JSON.parse(process.env.OWNER_RESULT).tasks,temp=JSON.parse(process.env.TEMP_RESULT).tasks,id=process.env.TEST_TASK;
if(owner.length!==44||owner.some(t=>t.id===id))throw new Error("owner isolation failed");
if(temp.length!==1||temp[0].id!==id)throw new Error("temporary user isolation failed");
console.log("LIVE ISOLATION VERIFIED: owner=44, temporary=1, no cross-account visibility");'

cleanup
created=0
remaining=$(ssh -i "$ssh_key" "$ssh_host" "docker exec reminder_app node -e 'const fs=require(\"fs\");console.log(JSON.parse(fs.readFileSync(\"/data/users.json\")).length)'")
[ "$remaining" = "1" ]
echo "TEMPORARY ACCOUNT REMOVED: accounts=1"
