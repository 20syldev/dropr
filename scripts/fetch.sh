#!/bin/bash

# Fetch a GitHub release into the CDN
# Usage: ./scripts/fetch.sh [options] <user/repo> <path> [version] [name]
#
# Options:
#   --force           Overwrite if version already exists
#   --no-build        Skip the build step
#   --exclude <pat>   Exclude file/dir from copy (repeatable)
#
# Arguments:
#   <user/repo>  GitHub repository (e.g. 20syldev/api)
#   <path>       CDN subdirectory (e.g. npm, bash)
#   [version]    GitHub release tag to fetch (default: latest)
#   [name]       Override package name (default: repo name)

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

info()  { echo -e "${BLUE}[INFO]${NC} $1"; }
ok()    { echo -e "${GREEN}[ OK ]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()   { echo -e "${RED}[FAIL]${NC} $1"; }
step()  { echo -e "${CYAN}[....]${NC} $1"; }

CDN_DIR="$(cd "$(dirname "$0")/.." && pwd)"

FORCE=false
BUILD=true
EXCLUDES=()
while [[ "${1:-}" == --* ]]; do
    case "$1" in
        --force) FORCE=true ;;
        --no-build) BUILD=false ;;
        --exclude) EXCLUDES+=("$2"); shift ;;
        *) err "Unknown option: $1"; exit 1 ;;
    esac
    shift
done

if [ $# -lt 2 ]; then
    echo -e "${BOLD}Usage:${NC} $0 [options] <user/repo> <path> [version] [name]"
    exit 1
fi

REPO="$1"
PATH_DIR="$2"
VERSION="${3:-}"
NAME="${4:-${REPO##*/}}"

# Resolve version from GitHub
if command -v gft &>/dev/null; then
    if [ -n "$VERSION" ]; then
        RESOLVED=$(gft "$REPO" "$VERSION" -q 2>/dev/null)
    else
        RESOLVED=$(gft "$REPO" -q 2>/dev/null)
    fi
else
    warn "gft is not installed — falling back to GitHub API (rate-limited)"
    info "Install it: ${DIM}curl -fsSL https://cdn.sylvain.sh/bash/gft@latest/install.sh | sh${NC}"
    if [ -n "$VERSION" ]; then
        RESOLVED="$VERSION"
    else
        RESOLVED=$(curl -s "https://api.github.com/repos/$REPO/releases/latest" | grep -o '"tag_name":"[^"]*"' | cut -d'"' -f4)
    fi
fi
if [ -z "$RESOLVED" ]; then
    err "Could not fetch version for ${BOLD}$REPO${NC}."
    exit 1
fi
VERSION="$RESOLVED"

ok "Found ${BOLD}$NAME${NC}@${BOLD}$VERSION${NC} on GitHub."

DEST="$CDN_DIR/$PATH_DIR/$NAME/$VERSION"
if [ -d "$DEST" ]; then
    if [ "$FORCE" = true ]; then
        warn "Overwriting ${BOLD}$PATH_DIR/$NAME/$VERSION${NC}..."
        rm -rf "$DEST"
    else
        info "Version ${BOLD}$VERSION${NC} already exists at ${BOLD}$PATH_DIR/$NAME/$VERSION${NC}."
        info "Use ${BOLD}--force${NC} to overwrite."
        exit 0
    fi
fi

# Clone the release tag
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

step "Cloning ${BOLD}$REPO${NC}@${BOLD}$VERSION${NC}..."
git clone --depth 1 --branch "$VERSION" "https://github.com/$REPO.git" "$TMPDIR/repo" --quiet

# Build if needed
if [ "$BUILD" = true ] && [ -f "$TMPDIR/repo/package.json" ] && grep -q '"build"' "$TMPDIR/repo/package.json"; then
    step "Building ${BOLD}$NAME${NC}..."
    (cd "$TMPDIR/repo" && npm install --quiet && npm run build --quiet)
fi

# Copy files
mkdir -p "$DEST"
RSYNC_EXCLUDES=(--exclude='.git' --exclude='node_modules')
for pat in "${EXCLUDES[@]}"; do
    RSYNC_EXCLUDES+=(--exclude="$pat")
done
rsync -a "${RSYNC_EXCLUDES[@]}" "$TMPDIR/repo/" "$DEST/"

# Fetch release date
if command -v gft &>/dev/null; then
    PUBLISHED=$(gft "$REPO" "$VERSION" --json 2>/dev/null | sed -n 's/.*"published_at":"\([^"]*\)".*/\1/p')
else
    PUBLISHED=$(curl -s "https://api.github.com/repos/$REPO/releases/tags/$VERSION" | grep -o '"published_at":"[^"]*"' | cut -d'"' -f4)
fi

DATE="${PUBLISHED%%T*}"
if [ -z "$DATE" ]; then
    DATE=$(date +%F)
    warn "No release date found for ${BOLD}$VERSION${NC}, falling back to today."
fi

node "$CDN_DIR/scripts/versions.mjs" "$CDN_DIR/$PATH_DIR/$NAME/.versions.json" "$VERSION" "$DATE" "$REPO"
ok "Recorded release date ${BOLD}$DATE${NC}."

echo ""
ok "Fetched ${BOLD}$NAME${NC}@${BOLD}$VERSION${NC} to ${BOLD}$PATH_DIR/$NAME/$VERSION${NC}"
echo -e "${DIM}Files:${NC}"
find "$DEST" -type f -printf "  ${DIM}%P${NC}\n" | sort
