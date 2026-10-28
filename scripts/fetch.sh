#!/bin/bash

# Fetch a release into dropr, from a GitHub tag or from the npm registry
# Usage: ./scripts/fetch.sh [options] <user/repo> <path> [version] [name]
#
# Options:
#   --force           Overwrite if version already exists
#   --no-build        Skip the build step (GitHub source only)
#   --exclude <pat>   Exclude file/dir from copy (repeatable)
#   --npm <package>   Fetch the published npm tarball of <package> (npm pack) instead of
#                     cloning the GitHub tag; top-level dotfiles are left out, and
#                     <user/repo> is only used for the release date
#
# Arguments:
#   <user/repo>  GitHub repository (e.g. moxondev/api)
#   <path>       dropr subdirectory (e.g. packages/npm, packages/bash)
#   [version]    Version to fetch (default: latest GitHub release, or npm view <package> version with --npm)
#   [name]       Override package name (default: repo name; pass moxon for moxondev/api)
#
# Examples:
#   ./scripts/fetch.sh 20syldev/gft packages/bash
#   ./scripts/fetch.sh --npm @moxon/api moxondev/api packages/npm 6.1.0 moxon

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

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

FORCE=false
BUILD=true
EXCLUDES=()
NPM_PACKAGE=""
while [[ "${1:-}" == --* ]]; do
    case "$1" in
        --force) FORCE=true ;;
        --no-build) BUILD=false ;;
        --exclude) EXCLUDES+=("${2:?--exclude needs a pattern}"); shift ;;
        --npm) NPM_PACKAGE="${2:?--npm needs a package name}"; shift ;;
        *) err "Unknown option: $1"; exit 1 ;;
    esac
    shift
done

if [ $# -lt 2 ]; then
    echo -e "${BOLD}Usage:${NC} $0 [options] <user/repo> <path> [version] [name]"
    echo -e "       $0 --npm <package> [options] <user/repo> <path> [version] [name]"
    exit 1
fi

REPO="$1"
PATH_DIR="$2"
VERSION="${3:-}"
NAME="${4:-${REPO##*/}}"

# Deprecated projects are frozen, new versions go to their successor
DEPRECATED="$ROOT_DIR/$PATH_DIR/$NAME/.deprecated.json"
if [ -f "$DEPRECATED" ]; then
    SUCCESSOR=$(sed -n 's/.*"successor": *"\([^"]*\)".*/\1/p' "$DEPRECATED")
    err "${BOLD}$PATH_DIR/$NAME${NC} is deprecated in favour of ${BOLD}$SUCCESSOR${NC}."
    info "Pass the successor name as ${BOLD}[name]${NC}: ${DIM}$0 ${NPM_PACKAGE:+--npm $NPM_PACKAGE }$REPO $PATH_DIR ${VERSION:-<version>} ${SUCCESSOR##*/}${NC}"
    exit 1
fi

# Resolve version from the npm registry or from GitHub
if [ -n "$NPM_PACKAGE" ]; then
    if ! command -v npm &>/dev/null; then
        err "npm is required with ${BOLD}--npm${NC}."
        exit 1
    fi
    # A range or a dist-tag (6, latest, next) resolves to the exact version it points to, the highest when several match
    SPEC="${VERSION:-latest}"
    [[ "$SPEC" =~ ^v[0-9] ]] && SPEC="${SPEC#v}"
    RESOLVED=$(npm view "$NPM_PACKAGE@$SPEC" version --json 2>/dev/null \
        | node -e 'try { console.log([].concat(JSON.parse(require("fs").readFileSync(0, "utf8"))).filter((v) => typeof v === "string").at(-1) ?? ""); } catch {}' \
        || true)
elif command -v gft &>/dev/null; then
    if [ -n "$VERSION" ]; then
        RESOLVED=$(gft "$REPO" "$VERSION" -q 2>/dev/null)
    else
        RESOLVED=$(gft "$REPO" -q 2>/dev/null)
    fi
else
    warn "gft is not installed, falling back to GitHub API (rate-limited)"
    info "Install it: ${DIM}curl -fsSL https://dropr.sylvain.sh/bash/gft@latest/install.sh | sh${NC}"
    if [ -n "$VERSION" ]; then
        RESOLVED="$VERSION"
    else
        RESOLVED=$(curl -s "https://api.github.com/repos/$REPO/releases/latest" | grep -o '"tag_name":"[^"]*"' | cut -d'"' -f4)
    fi
fi
if [ -z "$RESOLVED" ]; then
    err "Could not fetch version for ${BOLD}${NPM_PACKAGE:-$REPO}${NC}."
    exit 1
fi
VERSION="$RESOLVED"

# The folder name is the version, and the server reads anything else (latest, 6) as an alias
if [[ ! "${VERSION#v}" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
    err "Version ${BOLD}$VERSION${NC} is not an exact version (X.Y.Z or X.Y.Z-tag)."
    exit 1
fi

if [ -n "$NPM_PACKAGE" ]; then
    ok "Using ${BOLD}$NPM_PACKAGE${NC}@${BOLD}$VERSION${NC} from npm as ${BOLD}$NAME${NC}."
else
    ok "Found ${BOLD}$NAME${NC}@${BOLD}$VERSION${NC} on GitHub."
fi

DEST="$ROOT_DIR/$PATH_DIR/$NAME/$VERSION"
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

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

RSYNC_EXCLUDES=(--exclude='.git' --exclude='node_modules')

if [ -n "$NPM_PACKAGE" ]; then
    # Pack the published tarball, which holds the package under package/
    step "Packing ${BOLD}$NPM_PACKAGE${NC}@${BOLD}$VERSION${NC} from npm..."
    TARBALL=$(npm pack "$NPM_PACKAGE@$VERSION" --pack-destination "$TMPDIR" --silent 2>/dev/null | tail -n 1 || true)
    if [ -z "$TARBALL" ] || [ ! -f "$TMPDIR/$TARBALL" ]; then
        err "Could not pack ${BOLD}$NPM_PACKAGE${NC}@${BOLD}$VERSION${NC} from npm."
        exit 1
    fi
    mkdir -p "$TMPDIR/npm"
    tar -xzf "$TMPDIR/$TARBALL" -C "$TMPDIR/npm"
    SOURCE="$TMPDIR/npm/package"

    # npm packages are stored as their tarball minus top-level dotfiles (.prettierignore, .npmignore...)
    RSYNC_EXCLUDES+=(--exclude='/.*')
else
    step "Cloning ${BOLD}$REPO${NC}@${BOLD}$VERSION${NC}..."
    git clone --depth 1 --branch "$VERSION" "https://github.com/$REPO.git" "$TMPDIR/repo" --quiet
    SOURCE="$TMPDIR/repo"

    # Build if needed
    if [ "$BUILD" = true ] && [ -f "$SOURCE/package.json" ] && grep -q '"build"' "$SOURCE/package.json"; then
        step "Building ${BOLD}$NAME${NC}..."
        (cd "$SOURCE" && npm install --quiet && npm run build --quiet)
    fi
fi

# Copy files
mkdir -p "$DEST"
for pat in "${EXCLUDES[@]}"; do
    RSYNC_EXCLUDES+=(--exclude="$pat")
done
# Links pointing outside the source tree are dropped, the server would otherwise serve their target
rsync -a --safe-links "${RSYNC_EXCLUDES[@]}" "$SOURCE/" "$DEST/"

# Fetch release date from the GitHub release, trying the v-prefixed tag too for npm versions
PUBLISHED=""
for TAG in "$VERSION" "v$VERSION"; do
    if command -v gft &>/dev/null; then
        PUBLISHED=$(gft "$REPO" "$TAG" --json 2>/dev/null | sed -n 's/.*"published_at":"\([^"]*\)".*/\1/p' || true)
    else
        PUBLISHED=$(curl -s "https://api.github.com/repos/$REPO/releases/tags/$TAG" | grep -o '"published_at":"[^"]*"' | cut -d'"' -f4 || true)
    fi
    [ -n "$PUBLISHED" ] && break
done

DATE="${PUBLISHED%%T*}"
if [ -z "$DATE" ]; then
    DATE=$(date +%F)
    warn "No release date found for ${BOLD}$VERSION${NC}, falling back to today."
fi

node "$ROOT_DIR/scripts/versions.mjs" "$ROOT_DIR/$PATH_DIR/$NAME/.versions.json" "$VERSION" "$DATE" "$REPO"
ok "Recorded release date ${BOLD}$DATE${NC}."

echo ""
ok "Fetched ${BOLD}$NAME${NC}@${BOLD}$VERSION${NC} to ${BOLD}$PATH_DIR/$NAME/$VERSION${NC}"
echo -e "${DIM}Files:${NC}"
find "$DEST" -type f -printf "  ${DIM}%P${NC}\n" | sort
