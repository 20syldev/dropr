#!/bin/bash
# =========================================================
# MN - Module: Configuration
# =========================================================

_config_row() {
    local row
    printf -v row '%s[%s]%s %s' "$1" "$2" "$FG_RESET" "$3"
    MENU_ITEMS+=("$row")
}

show_config_menu() {
    CURRENT_MENU="config"
    SELECTED_INDEX=0
    USE_PAGINATION=false

    # MENU_ITEMS carry REAL escape bytes and additive colours: draw_menu prints
    # them with %s (never re-interpreted), and no "0m" reset kills the selection bar.
    MENU_ITEMS=()
    _config_row "$C_MAGENTA" M "$T_CONFIG_EDIT_MN"
    _config_row "$C_BLUE"    B "$T_CONFIG_EDIT_ALIASES"
    _config_row "$C_BLUE"    F "$T_CONFIG_EDIT_FUNCS"
    _config_row "$C_BLUE"    R "$T_CONFIG_EDIT_BASHRC"
    _config_row "$C_GREEN"   S "$T_CONFIG_SOURCE"
    _config_row "$C_CYAN"    L "$T_CONFIG_LANG"
    _config_row "$C_CYAN"    E "$T_CONFIG_EDITOR"
    _config_row "$C_CYAN"    P "$T_CONFIG_REPOS"
    _config_row "$C_CYAN"    C "$T_CONFIG_CDN"
    _config_row "$C_RED"     X "$T_CONFIG_UNINSTALL"
    MENU_ACTIONS=(
        "config_edit_mn"
        "config_edit_aliases"
        "config_edit_functions"
        "config_edit_bashrc"
        "config_source_all"
        "config_change_lang"
        "config_change_editor"
        "config_change_repos"
        "config_change_cdn"
        "config_uninstall"
    )
}

config_edit_mn() {
    show_cursor
    $MN_EDITOR "$MN_DIR"
    hide_cursor
    show_config_menu
}

config_edit_aliases() {
    show_cursor
    $MN_EDITOR "$BASH_ALIASES"
    hide_cursor
    show_config_menu
}

config_edit_functions() {
    show_cursor
    $MN_EDITOR "$BASH_FUNCTIONS"
    hide_cursor
    show_config_menu
}

config_edit_bashrc() {
    show_cursor
    $MN_EDITOR "$HOME/.bashrc"
    hide_cursor
    show_config_menu
}

config_source_all() {
    clear_screen
    draw_header "$T_CONFIG_REGEN_TITLE"

    echo -e "${CYAN}$T_CONFIG_REGEN_MSG${NC}\n"

    regenerate_bash_files

    echo -e "  ${GREEN}✓${NC} ~/.bash_aliases"
    echo -e "  ${GREEN}✓${NC} ~/.bash_functions"
    echo -e "\n${GREEN}$T_CONFIG_REGEN_DONE${NC}"

    sleep 1
    hide_cursor
    show_config_menu
}

config_change_lang() {
    clear_screen
    draw_header "$T_CONFIG_LANG_TITLE"

    echo -e "${WHITE}$T_CONFIG_LANG_CURRENT:${NC} ${CYAN}$MN_LANG${NC}\n"

    local -a sel_opts=()
    local f code name init_idx=0 idx=0
    for f in "$MN_DIR"/lang/*.sh; do
        [[ -f "$f" ]] || continue
        code=$(basename "$f" .sh)
        name=$(. "$f" 2>/dev/null; printf '%s' "${LANG_DISPLAY_NAME:-$code}")
        sel_opts+=("${code}:::${name}")
        [[ "$code" == "$MN_LANG" ]] && init_idx=$idx
        (( idx++ ))
    done

    _SELECT_INDEX=$init_idx
    if select_option "" "${sel_opts[@]}"; then
        local new_lang="$_SELECT_VALUE"
        if [[ "$new_lang" != "$MN_LANG" ]]; then
            echo "$new_lang" > "$MN_LANG_FILE"
            echo -e "\n${GREEN}✓ $T_CONFIG_LANG_CHANGED${NC}"
            sleep 2
            cleanup
        fi
    fi

    hide_cursor
    show_config_menu
}

config_change_editor() {
    clear_screen
    draw_header "$T_CONFIG_EDITOR_TITLE"

    echo -e "${WHITE}$T_CONFIG_EDITOR_CURRENT:${NC} ${CYAN}$MN_EDITOR${NC}\n"

    local preset_vals=("vi" "vim" "nano" "zed" "code -n")
    local preset_labels=("vi" "vim" "nano" "zed" "Visual Studio Code")
    local -a sel_opts=()
    local init_idx=5 i
    for (( i=0; i<${#preset_vals[@]}; i++ )); do
        sel_opts+=("${preset_vals[$i]}:::${preset_labels[$i]}")
        [[ "${preset_vals[$i]}" == "$MN_EDITOR" ]] && init_idx=$i
    done
    sel_opts+=("__custom__:::$T_CONFIG_EDITOR_CUSTOM")

    _SELECT_INDEX=$init_idx
    if select_option "" "${sel_opts[@]}"; then
        local new_editor="$_SELECT_VALUE"
        if [[ "$new_editor" == "__custom__" ]]; then
            show_cursor
            echo -ne "\n${CYAN}$T_CONFIG_EDITOR_CUSTOM:${NC} "
            read -r new_editor
        fi

        if [[ -z "${new_editor// }" || "$new_editor" == *"'"* ]]; then
            new_editor="$MN_EDITOR"
        fi

        if [[ "$new_editor" != "$MN_EDITOR" ]]; then
            echo "$new_editor" > "$MN_EDITOR_FILE"
            MN_EDITOR="$new_editor"
            regenerate_bash_files
            echo -e "\n${GREEN}✓ $T_CONFIG_EDITOR_CHANGED${NC}"
            sleep 2
        fi
    fi

    hide_cursor
    show_config_menu
}

config_change_repos() {
    clear_screen
    draw_header "$T_CONFIG_REPOS_TITLE"

    echo -e "${WHITE}$T_CONFIG_REPOS_CURRENT:${NC} ${CYAN}$MN_REPOS_ROOT${NC}"
    echo -e "${GRAY}$T_CONFIG_REPOS_HINT${NC}\n"

    show_cursor
    local new_root expanded
    read -e -r -i "$MN_REPOS_ROOT" -p "$(printf '%b%s:%b ' "$CYAN" "$T_CONFIG_REPOS_NEW" "$NC")" new_root
    hide_cursor

    new_root="${new_root#"${new_root%%[![:space:]]*}"}"
    new_root="${new_root%"${new_root##*[![:space:]]}"}"
    new_root="${new_root%/}"
    [[ -z "$new_root" ]] && { show_config_menu; LAST_MENU=""; return; }

    # Store the tilde form so the .dat stays portable, but check the real path
    expanded="${new_root/#\~/$HOME}"
    [[ "$expanded" == "$HOME" ]] && new_root="~"
    [[ "$expanded" == "$HOME"/* ]] && new_root="~${expanded#$HOME}"

    if [[ ! -d "$expanded" ]]; then
        echo -e "\n  ${RED}✗ $T_CONFIG_REPOS_MISSING${NC}"
        sleep 2
    else
        echo "$new_root" > "$MN_REPOS_FILE"
        MN_REPOS_ROOT="$new_root"
        echo -e "\n  ${GREEN}✓ $T_CONFIG_REPOS_CHANGED${NC}"
        sleep 1
    fi

    show_config_menu
    LAST_MENU=""
}

config_change_cdn() {
    clear_screen
    draw_header "$T_CONFIG_CDN_TITLE"

    echo -e "${WHITE}$T_CONFIG_CDN_CURRENT:${NC} ${CYAN}$MN_CDN${NC}\n"

    show_cursor
    echo -ne "${CYAN}$T_CONFIG_CDN_NEW:${NC} "
    read -r new_cdn

    if [[ -n "${new_cdn// }" && "$new_cdn" != "$MN_CDN" ]]; then
        echo "$new_cdn" > "$MN_CDN_FILE"
        MN_CDN="$new_cdn"
        echo -e "\n${GREEN}✓ $T_CONFIG_CDN_CHANGED${NC}"
        sleep 2
    fi

    hide_cursor
    show_config_menu
}

# -------------------- REGISTRATION -------------------- #

MOD_config_TYPE="menu"
MOD_config_MENU_LABEL="$T_MENU_CONFIG"
MOD_config_TITLE="$T_MENU_TITLE_CONFIG"
MOD_config_CLI_ARGS="config|c"
MOD_config_PRIORITY=80

ALL_MODULES="${ALL_MODULES:+$ALL_MODULES }config"

config_uninstall() {
    clear_screen
    draw_header "$T_CONFIG_UNINSTALL_TITLE"
    echo ""

    checkbox_select "$T_UNINSTALL_SELECT" \
        "$T_UNINSTALL_ALL" \
        "$T_UNINSTALL_CORE" \
        "$T_UNINSTALL_CONFIG" \
        "$T_UNINSTALL_DATA" \
        "$T_UNINSTALL_PLUGINS"

    if [[ $? -ne 0 ]] || [[ ${_CHK_CORE:-0} -eq 0 && ${_CHK_CONFIG:-0} -eq 0 && \
          ${_CHK_DATA:-0} -eq 0 && ${_CHK_PLUGINS:-0} -eq 0 ]]; then
        hide_cursor
        show_config_menu
        return
    fi

    show_cursor; clear_screen

    # Core: symlink + shell PATH + lib/ modules/ completions/ docs/ mn VERSION manifest
    if [[ ${_CHK_CORE:-0} -eq 1 ]]; then
        for bin_dir in /usr/local/bin "$HOME/.local/bin" "$HOME/bin"; do
            if [ -L "$bin_dir/mn" ]; then
                rm -f "$bin_dir/mn" 2>/dev/null || true
            fi
        done

        for rc in "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile" "$HOME/.zshrc"; do
            if [ -f "$rc" ] && grep -q "# Added by mn installer" "$rc"; then
                sed -i '/# Added by mn installer/d;/export PATH=.*mn/d' "$rc"
            fi
        done

        [ -f "$HOME/.bash_functions" ] && sed -i '/^mn()/d' "$HOME/.bash_functions"

        for comp_file in \
            "/usr/share/bash-completion/completions/mn" \
            "$HOME/.local/share/bash-completion/completions/mn" \
            "/usr/share/zsh/vendor-completions/_mn" \
            "$HOME/.local/share/zsh/site-functions/_mn"; do
            [ -f "$comp_file" ] && rm -f "$comp_file"
        done

        rm -rf "$MN_DIR/lib" "$MN_DIR/modules" "$MN_DIR/completions" "$MN_DIR/docs"
        rm -f  "$MN_DIR/mn" "$MN_DIR/VERSION" "$MN_DIR/manifest"
    fi

    # Configuration
    if [[ ${_CHK_CONFIG:-0} -eq 1 ]]; then
        rm -f  "$MN_DIR/.lang" "$MN_DIR/.editor" "$MN_DIR/.cdn" "$MN_DIR/.repos"
        rm -rf "$MN_DIR/lang"
    fi

    # Data
    if [[ ${_CHK_DATA:-0} -eq 1 ]]; then
        rm -rf "$MN_DIR/data"
    fi

    # Plugins
    if [[ ${_CHK_PLUGINS:-0} -eq 1 ]]; then
        rm -rf "$MN_DIR/plugins"
    fi

    # Remove parent dir if everything selected
    if [[ ${_CHK_CORE:-0} -eq 1 && ${_CHK_CONFIG:-0} -eq 1 && \
          ${_CHK_DATA:-0} -eq 1 && ${_CHK_PLUGINS:-0} -eq 1 ]]; then
        rm -rf "$MN_DIR"
    fi

    echo -e "\n${GREEN}$T_CONFIG_UNINSTALL_DONE${NC}\n"

    if [[ ${_CHK_CORE:-0} -eq 1 ]]; then
        exit 0
    else
        read -n 1 -s
        hide_cursor
        show_config_menu
    fi
}
