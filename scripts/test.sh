#!/usr/bin/env bash
# Run the whole test suite (backend + frontend). Run this before committing.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "== backend =="
"$DIR/test-backend.sh"
echo
echo "== frontend =="
"$DIR/test-frontend.sh"
