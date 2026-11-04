#!/bin/bash
# =========================================================
# MN - Plugin manager
# =========================================================

MN_PLUGIN_DIR="$MN_DIR/plugins"

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
    local name="$1"
    local source="${2:-}"
    if [[ -z "$name" ]]; then
        echo -e "${RED}$T_PLUGIN_USAGE_INSTALL${NC}"
        return 1
    fi

    local target_dir="$MN_PLUGIN_DIR/$name"
    if [[ -d "$target_dir" && -f "$target_dir/mn.sh" ]]; then
        echo -e "${YELLOW}$T_PLUGIN_ALREADY: '$name'${NC}"
        return 0
    fi

    echo -e "${BLUE}$T_PLUGIN_LOOKING: '${name}'...${NC}"

    local manifest_content
    if [[ -z "$source" ]]; then
        # Default: CDN
        manifest_content=$(curl -fsSL "${MN_CDN}/${name}@latest/mn.sh" 2>/dev/null)
    elif [[ -f "$source" ]]; then
        # Local file path
        manifest_content=$(cat "$source")
    else
        # Custom URL
        manifest_content=$(curl -fsSL "$source" 2>/dev/null)
    fi

    if [[ -z "$manifest_content" ]]; then
        echo -e "${RED}$T_PLUGIN_NOT_FOUND: '$name'${NC}"
        echo -e "${DIM}$T_PLUGIN_NOT_FOUND_HINT${NC}"
        return 1
    fi

    # Read REQUIRES and INSTALL_CMD from manifest (in a subshell to avoid pollution)
    local requires install_cmd
    requires=$(bash -c "
        source /dev/stdin <<'_MANIFEST_EOF'
$manifest_content
_MANIFEST_EOF
        varname=\"PLUGIN_${name}_REQUIRES\"
        echo \"\${!varname}\"
    " 2>/dev/null)
    install_cmd=$(bash -c "
        source /dev/stdin <<'_MANIFEST_EOF'
$manifest_content
_MANIFEST_EOF
        varname=\"PLUGIN_${name}_INSTALL_CMD\"
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
                show_cursor
                echo -e "${CYAN}$T_PLUGIN_INSTALL_NOW${NC}"
                if confirm_dialog; then
                    echo ""
                    eval "$install_cmd"
                else
                    echo -e "\n${YELLOW}$T_PLUGIN_DEPS_SKIP${NC}"
                fi
                hide_cursor
            else
                echo -e "${YELLOW}$T_PLUGIN_DEPS_MANUAL${NC}"
            fi
        fi
    fi

    # Install the plugin
    mkdir -p "$target_dir"
    echo "$manifest_content" > "$target_dir/mn.sh"

    echo -e "${GREEN}$T_PLUGIN_INSTALLED_OK: '$name'${NC}"
    echo -e "${DIM}$T_PLUGIN_RESTART${NC}"
}

# ─── mn plugin update <name> [url|path] ──────────────────────────────

_plugin_update() {
    local name="$1"
    local source="${2:-}"
    if [[ -z "$name" ]]; then
        echo -e "${RED}$T_PLUGIN_USAGE_UPDATE${NC}"
        return 1
    fi

    local target_dir="$MN_PLUGIN_DIR/$name"
    if [[ ! -d "$target_dir" || ! -f "$target_dir/mn.sh" ]]; then
        echo -e "${RED}$T_PLUGIN_NOT_INSTALLED: '$name'${NC}"
        return 1
    fi

    echo -e "${BLUE}$T_PLUGIN_LOOKING: '${name}'...${NC}"

    local manifest_content
    if [[ -z "$source" ]]; then
        manifest_content=$(curl -fsSL "${MN_CDN}/${name}@latest/mn.sh" 2>/dev/null)
    elif [[ -f "$source" ]]; then
        manifest_content=$(cat "$source")
    else
        manifest_content=$(curl -fsSL "$source" 2>/dev/null)
    fi

    if [[ -z "$manifest_content" ]]; then
        echo -e "${RED}$T_PLUGIN_NOT_FOUND: '$name'${NC}"
        echo -e "${DIM}$T_PLUGIN_NOT_FOUND_HINT${NC}"
        return 1
    fi

    echo "$manifest_content" > "$target_dir/mn.sh"
    echo -e "${GREEN}$T_PLUGIN_UPDATED_OK: '$name'${NC}"
    echo -e "${DIM}$T_PLUGIN_RESTART${NC}"
}

# ─── mn plugin remove <name> ──────────────────────────────────────────

_plugin_remove() {
    local name="$1"
    if [[ -z "$name" ]]; then
        echo -e "${RED}$T_PLUGIN_USAGE_REMOVE${NC}"
        return 1
    fi

    local target_dir="$MN_PLUGIN_DIR/$name"
    if [[ ! -d "$target_dir" ]]; then
        echo -e "${RED}$T_PLUGIN_NOT_INSTALLED: '$name'${NC}"
        return 1
    fi

    echo -e "${YELLOW}$T_PLUGIN_CONFIRM_REMOVE: '$name'${NC}\n"
    show_cursor
    if confirm_dialog; then
        rm -rf "$target_dir"
        echo -e "\n${GREEN}$T_PLUGIN_REMOVED: '$name'${NC}"
        echo -e "${DIM}$T_PLUGIN_RESTART${NC}"
    fi
    hide_cursor
}

# ─── mn plugin info <name> ────────────────────────────────────────────

_plugin_info() {
    local name="$1"
    if [[ -z "$name" ]]; then
        echo -e "${RED}$T_PLUGIN_USAGE_INFO${NC}"
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
    local v_url="PLUGIN_${id}_INSTALL_URL"

    echo -e "${CYAN}${BOLD}$name${NC} ${DIM}v${!v_ver:-?}${NC}"
    [[ -n "${!v_desc}" ]]     && echo -e "  ${!v_desc}"
    [[ -n "${!v_author}" ]]   && echo -e "  ${DIM}$T_PLUGIN_AUTHOR: ${!v_author}${NC}"
    [[ -n "${!v_requires}" ]] && echo -e "  ${DIM}$T_PLUGIN_REQUIRES: ${!v_requires}${NC}"
    [[ -n "${!v_url}" ]]      && echo -e "  ${DIM}URL: ${!v_url}${NC}"
}

# ─── Help ─────────────────────────────────────────────────────────────

_plugin_help() {
    echo -e "${CYAN}${BOLD}mn plugin${NC} — $T_PLUGIN_HELP_TITLE\n"
    echo -e "  ${WHITE}mn plugin list${NC}                      $T_PLUGIN_HELP_LIST"
    echo -e "  ${WHITE}mn plugin install <name> [url|path]${NC}  $T_PLUGIN_HELP_INSTALL"
    echo -e "  ${WHITE}mn plugin update <name> [url|path]${NC}   $T_PLUGIN_HELP_UPDATE"
    echo -e "  ${WHITE}mn plugin remove <name>${NC}              $T_PLUGIN_HELP_REMOVE"
    echo -e "  ${WHITE}mn plugin info <name>${NC}                $T_PLUGIN_HELP_INFO"
}
