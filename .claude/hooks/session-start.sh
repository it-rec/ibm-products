#!/bin/bash
set -euo pipefail

# Set the git author/committer identity for this repository so commits made
# during Claude Code on the web sessions are attributed to the repo owner.
#
# Only runs in the remote (web) environment, where the container's global git
# config defaults to a generic identity. Local/desktop sessions are left alone
# so they keep using whatever identity the developer has configured.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

git config user.name "it-rec"
git config user.email "19797875+it-rec@users.noreply.github.com"
