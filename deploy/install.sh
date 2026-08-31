#!/bin/sh
set -eu

deploy_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
env_file="$deploy_dir/.env"
key_file="$deploy_dir/kimi.key"

if ! docker compose version >/dev/null 2>&1; then
  echo "缺少 Docker Compose v2；停止部署，未修改任何现有项目。" >&2
  exit 2
fi
if docker ps -a --format '{{.Names}}' | grep -qx reminder_app; then
  echo "检测到已有 reminder_app。请使用 docker compose -f deploy/docker-compose.yml up -d --build 更新。" >&2
  exit 3
fi
if ss -ltn 2>/dev/null | grep -qE '127\.0\.0\.1:8787|0\.0\.0\.0:8787|\[::\]:8787'; then
  echo "端口 8787 已被占用；停止部署，未停止占用者。" >&2
  exit 4
fi
if [ ! -f "$env_file" ]; then
  umask 077
  invite=$(openssl rand -hex 18)
  sed "s/^REGISTRATION_INVITE_CODE=.*/REGISTRATION_INVITE_CODE=$invite/" "$deploy_dir/.env.example" > "$env_file"
fi
if [ ! -f "$key_file" ]; then
  umask 077
  : > "$key_file"
fi

docker compose -f "$deploy_dir/docker-compose.yml" up -d --build
for unused in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS http://127.0.0.1:8787/api/healthz >/dev/null 2>&1; then
    echo "拾遗服务启动成功：http://127.0.0.1:8787"
    echo "邀请码保存在 deploy/.env；请勿发到群聊或提交 Git。"
    exit 0
  fi
  sleep 1
done
echo "容器已启动但健康检查未通过，请运行 docker compose -f deploy/docker-compose.yml logs app" >&2
exit 5
