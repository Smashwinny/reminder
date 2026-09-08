#!/bin/sh
set -eu
project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
exec node "$project_root/deploy/verify-friend-flow.js"
