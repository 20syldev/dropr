#!/bin/bash
# =========================================================
# MN - Plugin manager
# =========================================================

MN_PLUGIN_DIR="$MN_DIR/plugins"

# ─── Validation helpers ───────────────────────────────────────────────

# Print an error, never echoing control bytes from user input back to the terminal
_plugin_err() {
    printf '%b✗ %s%s%b\n' "$RED" "$1" "${2:+: ${2//[[:cntrl:]]/?}}" "$NC"
}

# A plugin id is a plain directory name: it becomes plugins/<id>, a path under
# rm -rf, a variable prefix (PLUGIN_<id>_*) and a CDN path segment. No dot, no
# slash, no "@", no upper case, so "..", "../data" and "foo/bar" cannot pass.
_plugin_valid_id() {
    [[ "$1" =~ ^[a-z0-9][a-z0-9_-]*$ ]]
}

# Split "id[@version]" into _PLUGIN_ID and _PLUGIN_VER ("latest" by default).
# $1 = argument, $2 = explicit url|path source (a version cannot go with one).
# Prints the error and returns 1 on any invalid form: a second "@", "foo@",
# "@1.2", an unknown version syntax.
_PLUGIN_ID=""
_PLUGIN_VER=""
_plugin_parse() {
    local arg="$1" source="${2:-}"
    _PLUGIN_ID="${arg%%@*}"
    _PLUGIN_VER="latest"

    if ! _plugin_valid_id "$_PLUGIN_ID"; then
        _plugin_err "$T_PLUGIN_ERR_NAME" "$_PLUGIN_ID"
        return 1
    fi
    if [[ "$arg" == *@* ]]; then
        _PLUGIN_VER="${arg#*@}"
        if [[ ! "$_PLUGIN_VER" =~ ^(latest|[0-9]+(\.[0-9]+){0,2})$ ]]; then
            _plugin_err "$T_PLUGIN_ERR_VERSION" "$arg"
            return 1
        fi
        if [[ -n "$source" ]]; then
            _plugin_err "$T_PLUGIN_ERR_VERSION_SRC" "$arg"
            return 1
        fi
    fi
    return 0
}

# Installed plugin directory for a validated id. Anything that does not resolve
# to exactly plugins/<id> (a symlink, a changed parent) is refused before any rm.
_plugin_dir_ok() {
    local dir="$MN_PLUGIN_DIR/$1" real root
    real=$(readlink -f -- "$dir") || return 1
    root=$(readlink -f -- "$MN_PLUGIN_DIR") || return 1
    [[ "$real" == "$root/$1" ]]
}

# Why _plugin_dir_ok refused: a symlink is never followed, the id itself is valid
_plugin_dir_err() {
    if [[ -L "$MN_PLUGIN_DIR/$1" ]]; then
        _plugin_err "$T_PLUGIN_ERR_LINKED" "$1"
    else
        _plugin_err "$T_PLUGIN_ERR_NAME" "$1"
    fi
}

# Fetch a manifest into _PLUGIN_CONTENT: from the CDN ($2 = version), a local
# file or a URL ($3). Nothing is written by the caller unless this returns 0:
# a failed, empty, truncated or HTML download must never reach plugins/, because
# every plugin is sourced at each start and one broken file breaks every mn run.
# $1 = id, $2 = version, $3 = source, $4 = label for messages.
_PLUGIN_CONTENT=""
_plugin_fetch() {
    local id="$1" ver="$2" source="$3" label="$4" content=""

    if [[ -z "$source" ]]; then
        # mn plugin install downloads code that is then sourced: same rule as mn update
        if [[ "$MN_CDN" != https://* && "$MN_CDN" != file://* ]]; then
            printf '%b✗ %s%b\n' "$RED" "$T_UPDATE_INSECURE" "$NC"
            return 1
        fi
        content=$(curl -fsSL --connect-timeout 10 --max-time 60 \
            "${MN_CDN}/${id}@${ver}/mn.sh" 2> /dev/null) || content=""
    elif [[ -f "$source" ]]; then
        content=$(cat -- "$source" 2> /dev/null) || content=""
    else
        content=$(curl -fsSL --connect-timeout 10 --max-time 60 "$source" 2> /dev/null) || content=""
    fi

    if [[ -z "$content" ]]; then
        _plugin_err "$T_PLUGIN_NOT_FOUND" "$label"
        echo -e "${DIM}$T_PLUGIN_NOT_FOUND_HINT${NC}"
        return 1
    fi
    if ! bash -n <<< "$content" 2> /dev/null; then
        _plugin_err "$T_PLUGIN_ERR_SYNTAX" "$label"
        return 1
    fi
    _PLUGIN_CONTENT="$content"
}

# Write a manifest through a temp file in the same directory, then rename it:
# an interrupted write never leaves a half-written mn.sh behind.
_plugin_write() {
    local dir="$1" tmp="$1/mn.sh.tmp"
    mkdir -p "$dir" || return 1
    printf '%s\n' "$_PLUGIN_CONTENT" > "$tmp" && mv -f "$tmp" "$dir/mn.sh" || {
        rm -f "$tmp"
        return 1
    }
}

# ─── Main dispatcher ──────────────────────────────────────────────────

_plugin_cmd() {
    local subcmd="${1:-}"
    shift 2>/dev/null || true

    case "$subcmd" in
        list|ls)     _plugin_list ;;
        install|add) _plugin_install "$@" ;;
        update)      _plugin_update "$@" ;;
        remove|rm)   _plugin_remove "$@" ;;
        info)        _plugin_info "$@" ;;
        "")          _plugin_help ;;
        *)
            echo -e "${RED}$T_PLUGIN_ERR_UNKNOWN: $subcmd${NC}"
            _plugin_help
            ;;
    esac
}

# ─── mn plugin list ───────────────────────────────────────────────────

_plugin_list() {
    echo -e "${CYAN}${BOLD}$T_PLUGIN_INSTALLED_LIST${NC}\n"

    if [[ ! -d "$MN_PLUGIN_DIR" ]]; then
        echo -e "  ${DIM}$T_PLUGIN_NONE${NC}"
        echo -e "\n  ${CYAN}mn plugin install <name>${NC}"
        return
    fi

    local found=false
    for pdir in "$MN_PLUGIN_DIR"/*/; do
        [[ -d "$pdir" && -f "$pdir/mn.sh" ]] || continue
        found=true

        local name id version desc requires
        name=$(basename "$pdir")
        id="${name//-/_}"
        local v_version="PLUGIN_${id}_VERSION"
        local v_desc="PLUGIN_${id}_DESCRIPTION"
        local v_requires="PLUGIN_${id}_REQUIRES"
        version="${!v_version:-?}"
        desc="${!v_desc:-}"
        requires="${!v_requires:-}"

        # Check dependency status
        local status="${GREEN}$T_PLUGIN_ACTIVE${NC}"
        if [[ -n "$requires" ]]; then
            for dep in $requires; do
                if ! command -v "$dep" &>/dev/null; then
                    status="${RED}$T_PLUGIN_MISSING: $dep${NC}"
                    break
                fi
            done
        fi

        echo -e "  ${CYAN}${name}${NC} ${DIM}v${version}${NC} [${status}]"
        [[ -n "$desc" ]] && echo -e "    ${DIM}$desc${NC}"
    done

    if ! $found; then
        echo -e "  ${DIM}$T_PLUGIN_NONE${NC}"
        echo -e "\n  ${CYAN}mn plugin install <name>${NC}"
    fi
}

# ─── mn plugin install <name> [url|path] ──────────────────────────────

_plugin_install() {
    local arg="${1:-}"
    local source="${2:-}"
    if [[ -z "$arg" ]]; then
        echo -e "${RED}$T_PLUGIN_USAGE_INSTALL${NC}"
        return 1
    fi
    _plugin_parse "$arg" "$source" || return 1
    local name="$_PLUGIN_ID" ver="$_PLUGIN_VER"
    local vid="${name//-/_}"

    local target_dir="$MN_PLUGIN_DIR/$name"
    if [[ -d "$target_dir" && -f "$target_dir/mn.sh" ]]; then
        echo -e "${YELLOW}$T_PLUGIN_ALREADY: '$name'${NC}"
        return 0
    fi
    mkdir -p "$MN_PLUGIN_DIR"
    _plugin_dir_ok "$name" || { _plugin_dir_err "$name"; return 1; }

    echo -e "${BLUE}$T_PLUGIN_LOOKING: '${arg}'...${NC}"

    _plugin_fetch "$name" "$ver" "$source" "$arg" || return 1
    local manifest_content="$_PLUGIN_CONTENT"

    # Read REQUIRES and INSTALL_CMD from manifest (in a subshell to avoid pollution)
    local requires install_cmd
    requires=$(bash -c "
        source /dev/stdin <<'_MANIFEST_EOF'
$manifest_content
_MANIFEST_EOF
        varname=\"PLUGIN_${vid}_REQUIRES\"
        echo \"\${!varname}\"
    " 2>/dev/null)
    install_cmd=$(bash -c "
        source /dev/stdin <<'_MANIFEST_EOF'
$manifest_content
_MANIFEST_EOF
        varname=\"PLUGIN_${vid}_INSTALL_CMD\"
        echo \"\${!varname}\"
    " 2>/dev/null)

    # Check dependencies
    if [[ -n "$requires" ]]; then
        local missing=""
        for dep in $requires; do
            command -v "$dep" &>/dev/null || missing="$missing $dep"
        done

        if [[ -n "$missing" ]]; then
            echo -e "${YELLOW}$T_PLUGIN_REQUIRES:${NC}$missing"
            if [[ -n "$install_cmd" ]]; then
                echo -e "${DIM}$T_PLUGIN_INSTALL_CMD: $install_cmd${NC}\n"
                echo -e "${CYAN}$T_PLUGIN_INSTALL_NOW${NC}"
                if confirm_dialog; then
                    echo ""
                    eval "$install_cmd"
                else
                    echo -e "\n${YELLOW}$T_PLUGIN_DEPS_SKIP${NC}"
                fi
            else
                echo -e "${YELLOW}$T_PLUGIN_DEPS_MANUAL${NC}"
            fi
        fi
    fi

    # Install the plugin
    if ! _plugin_write "$target_dir"; then
        _plugin_err "$T_ERR_WRITE" "$target_dir"
        return 1
    fi

    echo -e "${GREEN}$T_PLUGIN_INSTALLED_OK: '$name'${NC}"
    echo -e "${DIM}$T_PLUGIN_RESTART${NC}"
}

# ─── mn plugin update <name> [url|path] ──────────────────────────────

_plugin_update() {
    local arg="${1:-}"
    local source="${2:-}"
    if [[ -z "$arg" ]]; then
        echo -e "${RED}$T_PLUGIN_USAGE_UPDATE${NC}"
        return 1
    fi
    _plugin_parse "$arg" "$source" || return 1
    local name="$_PLUGIN_ID" ver="$_PLUGIN_VER"

    local target_dir="$MN_PLUGIN_DIR/$name"
    if [[ ! -d "$target_dir" || ! -f "$target_dir/mn.sh" ]]; then
        echo -e "${RED}$T_PLUGIN_NOT_INSTALLED: '$name'${NC}"
        return 1
    fi
    # A linked working copy is updated at its source, never overwritten through the link
    if [[ -L "$target_dir" ]]; then
        _plugin_err "$T_PLUGIN_ERR_SYMLINK" "$name"
        return 1
    fi
    _plugin_dir_ok "$name" || { _plugin_dir_err "$name"; return 1; }

    echo -e "${BLUE}$T_PLUGIN_LOOKING: '${arg}'...${NC}"

    _plugin_fetch "$name" "$ver" "$source" "$arg" || return 1

    if ! _plugin_write "$target_dir"; then
        _plugin_err "$T_ERR_WRITE" "$target_dir"
        return 1
    fi
    echo -e "${GREEN}$T_PLUGIN_UPDATED_OK: '$name'${NC}"
    echo -e "${DIM}$T_PLUGIN_RESTART${NC}"
}

# ─── mn plugin remove <name> ──────────────────────────────────────────

_plugin_remove() {
    local name="${1:-}"
    if [[ -z "$name" ]]; then
        echo -e "${RED}$T_PLUGIN_USAGE_REMOVE${NC}"
        return 1
    fi
    # No "@version" here: only an installed id can be removed
    if ! _plugin_valid_id "$name"; then
        _plugin_err "$T_PLUGIN_ERR_NAME" "$name"
        return 1
    fi

    local target_dir="$MN_PLUGIN_DIR/$name"
    if [[ ! -d "$target_dir" && ! -L "$target_dir" ]]; then
        echo -e "${RED}$T_PLUGIN_NOT_INSTALLED: '$name'${NC}"
        return 1
    fi
    # A symlink (a linked working copy) is removed as a link, never followed.
    # Otherwise rm -rf only on exactly plugins/<name>, as the filesystem resolves it.
    local is_link=0
    if [[ -L "$target_dir" ]]; then
        is_link=1
    elif ! _plugin_dir_ok "$name"; then
        _plugin_dir_err "$name"
        return 1
    fi

    echo -e "${YELLOW}$T_PLUGIN_CONFIRM_REMOVE: '$name'${NC}\n"
    if confirm_dialog; then
        if (( is_link )); then
            rm -f -- "$target_dir"
        else
            rm -rf -- "$target_dir"
        fi
        echo -e "\n${GREEN}$T_PLUGIN_REMOVED: '$name'${NC}"
        echo -e "${DIM}$T_PLUGIN_RESTART${NC}"
    else
        echo -e "\n${BLUE}$T_CANCELLED${NC}"
    fi
}

# ─── mn plugin info <name> ────────────────────────────────────────────

_plugin_info() {
    local name="${1:-}"
    if [[ -z "$name" ]]; then
        echo -e "${RED}$T_PLUGIN_USAGE_INFO${NC}"
        return 1
    fi
    if ! _plugin_valid_id "$name"; then
        _plugin_err "$T_PLUGIN_ERR_NAME" "$name"
        return 1
    fi

    local target_dir="$MN_PLUGIN_DIR/$name"
    if [[ ! -d "$target_dir" || ! -f "$target_dir/mn.sh" ]]; then
        echo -e "${RED}$T_PLUGIN_NOT_INSTALLED: '$name'${NC}"
        return 1
    fi

    local id="${name//-/_}"
    local v_ver="PLUGIN_${id}_VERSION"
    local v_desc="PLUGIN_${id}_DESCRIPTION"
    local v_author="PLUGIN_${id}_AUTHOR"
    local v_requires="PLUGIN_${id}_REQUIRES"
    local v_cmd="PLUGIN_${id}_INSTALL_CMD"

    echo -e "${CYAN}${BOLD}$name${NC} ${DIM}v${!v_ver:-?}${NC}"
    [[ -n "${!v_desc}" ]]     && echo -e "  ${!v_desc}"
    [[ -n "${!v_author}" ]]   && echo -e "  ${DIM}$T_PLUGIN_AUTHOR: ${!v_author}${NC}"
    [[ -n "${!v_requires}" ]] && echo -e "  ${DIM}$T_PLUGIN_REQUIRES: ${!v_requires}${NC}"
    [[ -n "${!v_cmd}" ]]      && echo -e "  ${DIM}$T_PLUGIN_INSTALL_CMD: ${!v_cmd}${NC}"
}

# ─── Help ─────────────────────────────────────────────────────────────

_plugin_help() {
    local -a cmds=(
        "mn plugin list"
        "mn plugin install <name[@version]> [url|path]"
        "mn plugin update <name[@version]> [url|path]"
        "mn plugin remove <name>"
        "mn plugin info <name>"
    )
    local -a descs=(
        "$T_PLUGIN_HELP_LIST"
        "$T_PLUGIN_HELP_INSTALL"
        "$T_PLUGIN_HELP_UPDATE"
        "$T_PLUGIN_HELP_REMOVE"
        "$T_PLUGIN_HELP_INFO"
    )
    local i width=0
    # Columns measured with _pad, never with printf %-Ns on coloured text
    for (( i=0; i<${#cmds[@]}; i++ )); do
        _vislen "${cmds[$i]}"
        (( _VISLEN > width )) && width=$_VISLEN
    done

    echo -e "${CYAN}${BOLD}mn plugin${NC} — $T_PLUGIN_HELP_TITLE\n"
    for (( i=0; i<${#cmds[@]}; i++ )); do
        _pad "${cmds[$i]}" $(( width + 2 ))
        printf '  %b%s%b%s\n' "$WHITE" "$_PAD" "$NC" "${descs[$i]}"
    done
}
