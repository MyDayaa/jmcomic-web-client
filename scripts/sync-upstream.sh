#!/usr/bin/env bash
# Keep fork-only changes with a normal merge. Never reset or force-push main.
set -euo pipefail

upstream_url="${1:-https://github.com/TunaFish2K/jmcomic-web-client.git}"
branch="${2:-main}"

git diff --quiet
git diff --cached --quiet
git fetch --no-tags "$upstream_url" "$branch"
upstream_head="$(git rev-parse FETCH_HEAD)"

if git merge-base --is-ancestor "$upstream_head" HEAD; then
    echo 'Upstream is already included; fork changes are preserved.'
    if [[ -n "${GITHUB_OUTPUT:-}" ]]; then echo 'changed=false' >> "$GITHUB_OUTPUT"; fi
    exit 0
fi

if ! git merge --no-ff --no-edit "$upstream_head"; then
    git merge --abort
    echo '::error::Upstream conflicts with fork changes. Main and the live deployment were not replaced.'
    exit 1
fi

git push origin "HEAD:$branch"
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then echo 'changed=true' >> "$GITHUB_OUTPUT"; fi
