#!/bin/bash
# =========================================================
# MN - Updater: staged download, no downgrade, VERSION last
# =========================================================

# Loaded on demand by `mn update` (never at startup). Everything is downloaded and
# checked in a staging directory inside MN_DIR (same filesystem, so the final
# moves are renames); the install is only touched once EVERY file is good, and
# VERSION is written last so a half-finished update can simply be run again.
#
# Contract kept for the 1.1.2 updater, which sources the new core.sh and then
# echoes GREEN, CYAN, NC and T_UPDATE_DONE: those names must stay defined.

_UPDATE_BASE=""
_UPDATE_STAGE=""
_UPDATE_FILES=()
_UPDATE_DIRS=()

# Files fetched when the CDN serves no manifest. Keep in sync with ./manifest.
_UPDATE_FALLBACK="mn completions/mn.bash completions/_mn
lib/core.sh lib/crud.sh lib/dat.sh lib/module.sh lib/plugin.sh lib/ui.sh lib/update.sh
modules/alias.sh modules/config.sh modules/connexions.sh modules/docs.sh modules/funcs.sh modules/repos.sh"

_update_curl() {
    curl -fsSL --connect-timeout 10 --max-time 60 "$@"
}

# Version without its -beta style suffix
_update_core() {
    printf '%s' "${1%%-*}"
}

# Remove exactly what this run created, with no recursive delete: the staged files
# first, then the directories deepest first, then the stage itself. Refuses to act
# unless the stage is a ".update." directory directly under MN_DIR.
_update_cleanup() {
    local f i
    [[ -n "$_UPDATE_STAGE" && "$_UPDATE_STAGE" == "$MN_DIR"/.update.* ]] || return 0
    for f in "${_UPDATE_FILES[@]}"; do
        rm -f -- "$f" 2> /dev/null
    done
    for (( i = ${#_UPDATE_DIRS[@]} - 1; i >= 0; i-- )); do
        rmdir -- "${_UPDATE_DIRS[i]}" 2> /dev/null
    done
    rmdir -- "$_UPDATE_STAGE" 2> /dev/null
    _UPDATE_STAGE=""
    _UPDATE_FILES=()
    _UPDATE_DIRS=()
}

# Download $1 (path relative to the version root) into the stage and check it:
# curl success, non-empty, and a clean `bash -n` for anything bash will run.
# Returns 1 and prints nothing; the caller lists the failures.
_update_stage_file() {
    local rel="$1" dest="$_UPDATE_STAGE/$1" dir chain="" d
    local -a parts=()

    dir=$(dirname -- "$rel")
    while [[ "$dir" != "." && "$dir" != "/" ]]; do
        parts=("$dir" "${parts[@]}")
        dir=$(dirname -- "$dir")
    done
    for d in "${parts[@]}"; do
        if [[ ! -d "$_UPDATE_STAGE/$d" ]]; then
            mkdir -p -- "$_UPDATE_STAGE/$d" || return 1
            _UPDATE_DIRS+=("$_UPDATE_STAGE/$d")
        fi
    done

    # Recorded before the download so a partial file is cleaned up too
    _UPDATE_FILES+=("$dest")
    _update_curl "$_UPDATE_BASE/$rel" -o "$dest" 2> /dev/null || return 1
    [[ -s "$dest" ]] || return 1
    case "$rel" in
        mn|*.sh|*.bash) bash -n "$dest" 2> /dev/null || return 1 ;;
    esac
    return 0
}

# Move a staged file over its final path. mv gives it a new inode: a running mn
# keeps reading the old one instead of the middle of a rewritten file.
_update_install_file() {
    local rel="$1" dir
    dir=$(dirname -- "$rel")
    [[ "$dir" != "." ]] && { mkdir -p -- "$MN_DIR/$dir" || return 1; }
    [[ "$rel" == "mn" ]] && chmod +x "$_UPDATE_STAGE/mn"
    mv -f -- "$_UPDATE_STAGE/$rel" "$MN_DIR/$rel" || return 1
    return 0
}

mn_update() {
    local force=false arg latest="" newest
    local file code _name old_int old_term rc=0
    local -a files=() failed=() installed=()

    for arg in "$@"; do
        case "$arg" in
            --force|-f) force=true ;;
            *)
                echo -e "${RED}$T_ERR_UNKNOWN: ${arg//[[:cntrl:]]/?}${NC}"
                return 1
                ;;
        esac
    done

    # The update executes what it downloads: https, or a local file:// mirror
    if [[ "$MN_CDN" != https://* && "$MN_CDN" != file://* ]]; then
        printf '%b✗ %s%b\n' "$RED" "$T_UPDATE_INSECURE" "$NC"
        return 1
    fi

    echo -e "${BLUE}${T_UPDATE_FETCHING}${NC}"
    latest=$(_update_curl "${MN_CDN}/mn@latest" 2> /dev/null \
        | grep -o '"version": *"[^"]*"' | head -1 | cut -d'"' -f4)

    # The value ends up in a URL and in the VERSION file: a plain version only
    if [[ ! "$latest" =~ ^[0-9]+(\.[0-9]+){0,2}(-[A-Za-z0-9.]+)?$ ]]; then
        echo -e "${RED}${T_UPDATE_FAILED}${NC}"
        return 1
    fi

    # Compare on the core version (no -beta suffix), by sort -V and not by string
    # equality: an older source must never silently replace a newer install.
    if [[ "$(_update_core "$latest")" == "$(_update_core "$VERSION")" ]]; then
        if [[ "$force" != true ]]; then
            if [[ "$VERSION" == *-* ]]; then
                echo -e "${GREEN}${T_UPDATE_DEV_BUILD}${NC} (${CYAN}${VERSION}${NC})"
            else
                echo -e "${GREEN}${T_UPDATE_UP_TO_DATE}${NC} (${CYAN}${VERSION}${NC})"
            fi
            return 0
        fi
    else
        newest=$(printf '%s\n%s\n' "$(_update_core "$latest")" "$(_update_core "$VERSION")" \
            | sort -V | tail -1)
        if [[ "$newest" != "$(_update_core "$latest")" && "$force" != true ]]; then
            echo -e "${YELLOW}${T_UPDATE_NEWER_LOCAL}${NC} (${CYAN}${VERSION}${NC} > ${CYAN}${latest}${NC})"
            return 0
        fi
    fi

    echo -e "${BLUE}${T_UPDATE_UPDATING}${NC} ${CYAN}${VERSION}${NC} → ${CYAN}${latest}${NC}\n"

    _UPDATE_BASE="${MN_CDN}/mn@${latest}"
    mkdir -p "$MN_DIR" || return 1
    _UPDATE_STAGE=$(mktemp -d "$MN_DIR/.update.XXXXXX") || return 1
    _UPDATE_FILES=()
    _UPDATE_DIRS=()

    # An interrupted update leaves nothing behind
    old_int=$(trap -p INT)
    old_term=$(trap -p TERM)
    trap '_update_cleanup; exit 130' INT TERM

    # File list: the manifest when the CDN serves one, else the built-in list
    local manifest
    manifest=$(_update_curl "$_UPDATE_BASE/manifest" 2> /dev/null) || manifest=""
    [[ -n "$manifest" ]] || manifest="${_UPDATE_FALLBACK//[[:space:]]/$'\n'}"
    while IFS= read -r file; do
        [[ -z "$file" || "$file" == VERSION ]] && continue
        # No absolute path, no "..", nothing but plain path characters
        if [[ "$file" == /* || "$file" == *..* || ! "$file" =~ ^[A-Za-z0-9_./-]+$ ]]; then
            failed+=("${file//[[:cntrl:]]/?}")
            continue
        fi
        files+=("$file")
    done <<< "$manifest"

    for file in "${files[@]}"; do
        _update_stage_file "$file" || failed+=("$file")
    done
    # The manifest travels with the files it describes
    if [[ -n "$manifest" ]]; then
        _UPDATE_FILES+=("$_UPDATE_STAGE/manifest")
        printf '%s\n' "$manifest" > "$_UPDATE_STAGE/manifest" 2> /dev/null || failed+=("manifest")
    fi

    # Language files: codes come from the CDN and become paths, so two letters only
    local -a langs=()
    if _update_stage_file "lang/index"; then
        while IFS=: read -r code _name; do
            [[ -z "$code" ]] && continue
            if [[ ! "$code" =~ ^[a-z]{2}$ ]]; then
                failed+=("lang/index")
                break
            fi
            _update_stage_file "lang/${code}.sh" && langs+=("lang/${code}.sh") \
                || failed+=("lang/${code}.sh")
        done < "$_UPDATE_STAGE/lang/index"
    else
        failed+=("lang/index")
    fi

    if (( ${#failed[@]} )); then
        echo -e "${RED}✗ ${T_UPDATE_FILE_FAILED}:${NC}"
        for file in "${failed[@]}"; do printf '    %b✗ %s%b\n' "$RED" "$file" "$NC"; done
        echo -e "\n${YELLOW}${T_UPDATE_ABORTED}${NC}"
        _update_cleanup
        eval "${old_int:-trap - INT}"
        eval "${old_term:-trap - TERM}"
        return 1
    fi

    # Commit: every file is good, move them into place, VERSION last
    mkdir -p "$MN_DIR/plugins"
    for file in "${files[@]}" "${langs[@]}"; do
        if _update_install_file "$file"; then
            installed+=("$file")
            echo -e "${GREEN}${file} ${T_UPDATED}${NC}"
        else
            echo -e "${RED}✗ ${file}${NC}"
            rc=1
        fi
    done
    [[ -f "$_UPDATE_STAGE/manifest" ]] && mv -f -- "$_UPDATE_STAGE/manifest" "$MN_DIR/manifest"

    if (( rc )); then
        # VERSION stays as it was: running the update again repairs the install
        echo -e "\n${YELLOW}${T_UPDATE_ABORTED}${NC}"
        _update_cleanup
        eval "${old_int:-trap - INT}"
        eval "${old_term:-trap - TERM}"
        return 1
    fi

    printf '%s\n' "$latest" > "$_UPDATE_STAGE/VERSION" \
        && mv -f -- "$_UPDATE_STAGE/VERSION" "$MN_DIR/VERSION" || rc=1
    _update_cleanup
    eval "${old_int:-trap - INT}"
    eval "${old_term:-trap - TERM}"
    if (( rc )); then
        echo -e "${RED}✗ VERSION${NC}"
        return 1
    fi

    # Completions
    local bash_comp_dir zsh_comp_dir
    if [[ -w "/usr/share/bash-completion/completions" ]]; then
        bash_comp_dir="/usr/share/bash-completion/completions"
    else
        bash_comp_dir="$HOME/.local/share/bash-completion/completions"
        mkdir -p "$bash_comp_dir"
    fi
    if [[ -w "/usr/share/zsh/vendor-completions" ]]; then
        zsh_comp_dir="/usr/share/zsh/vendor-completions"
    else
        zsh_comp_dir="$HOME/.local/share/zsh/site-functions"
        mkdir -p "$zsh_comp_dir"
    fi
    [[ -f "$MN_DIR/completions/mn.bash" ]] && cp "$MN_DIR/completions/mn.bash" "$bash_comp_dir/mn" \
        && echo -e "${GREEN}bash completion ${T_UPDATED}${NC}"
    [[ -f "$MN_DIR/completions/_mn" ]] && cp "$MN_DIR/completions/_mn" "$zsh_comp_dir/_mn" \
        && echo -e "${GREEN}zsh completion ${T_UPDATED}${NC}"

    # Shell files from the NEW core.sh, in a subshell so this process keeps its own
    # state. A skipped name is a warning, never a failed update.
    ( source "$MN_DIR/lib/core.sh" && regenerate_bash_files ) || true

    echo -e "\n${GREEN}${T_UPDATE_DONE}${NC} ${CYAN}${latest}${NC}"
}
