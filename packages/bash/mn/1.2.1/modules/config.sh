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
            echo ""
            read -e -r -p "$(_form_prompt "$T_CONFIG_EDITOR_CUSTOM" "")" new_editor || new_editor=""
            hide_cursor
        fi

        new_editor="${new_editor#"${new_editor%%[![:space:]]*}"}"
        new_editor="${new_editor%"${new_editor##*[![:space:]]}"}"

        # An empty answer cancels; anything else must start with a command that exists.
        # The command is pasted as shell text into the generated repo aliases, so no
        # shell metacharacter or quote is accepted.
        local bad=$';|&$`<>()\\"\'\n'
        if [[ -n "$new_editor" && "$new_editor" != "$MN_EDITOR" ]]; then
            if [[ "$new_editor" == *["$bad"]* ]]; then
                _form_flash "$T_CONFIG_EDITOR_CHARS"
            elif ! command -v -- "${new_editor%% *}" > /dev/null 2>&1; then
                _form_flash "$T_CONFIG_EDITOR_INVALID: ${new_editor%% *}"
            else
                echo "$new_editor" > "$MN_EDITOR_FILE"
                MN_EDITOR="$new_editor"
                regenerate_bash_files
                echo -e "\n${GREEN}✓ $T_CONFIG_EDITOR_CHANGED${NC}"
                sleep 2
            fi
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
    read -e -r -i "$MN_REPOS_ROOT" -p "$(_form_prompt "$T_CONFIG_REPOS_NEW" "")" new_root || new_root=""
    hide_cursor

    new_root="${new_root#"${new_root%%[![:space:]]*}"}"
    new_root="${new_root%"${new_root##*[![:space:]]}"}"
    [[ -z "$new_root" ]] && { show_config_menu; LAST_MENU=""; return; }

    # Only /abs, ~ and ~/x: a relative path would move with the cwd, ~user is not expanded
    if [[ "$new_root" != /* && "$new_root" != "~" && "$new_root" != "~/"* ]]; then
        _form_flash "$T_CONFIG_REPOS_ABSOLUTE"
        show_config_menu
        return
    fi
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
    local new_cdn
    read -e -r -i "$MN_CDN" -p "$(_form_prompt "$T_CONFIG_CDN_NEW" "")" new_cdn || new_cdn="$MN_CDN"
    hide_cursor

    new_cdn="${new_cdn#"${new_cdn%%[![:space:]]*}"}"
    new_cdn="${new_cdn%"${new_cdn##*[![:space:]]}"}"

    # https only (mn update executes what it downloads), a real host, no trailing /
    local cdn_re='^https://[^/[:space:][:cntrl:]]([^[:space:][:cntrl:]]*[^/[:space:][:cntrl:]])?$'
    if [[ -z "$new_cdn" ]]; then
        # Emptied on purpose: back to the default source
        rm -f "$MN_CDN_FILE"
        MN_CDN="$MN_CDN_DEFAULT"
        echo -e "\n${GREEN}✓ $T_CONFIG_CDN_RESET${NC}"
        sleep 2
    elif [[ "$new_cdn" != "$MN_CDN" ]]; then
        if [[ ! "$new_cdn" =~ $cdn_re ]]; then
            _form_flash "$T_CONFIG_CDN_HTTPS"
        elif ! curl -fsS --max-time 5 "$new_cdn/mn@latest" 2> /dev/null | grep -q '"version"'; then
            _form_flash "$T_CONFIG_CDN_UNREACHABLE"
        else
            echo "$new_cdn" > "$MN_CDN_FILE"
            MN_CDN="$new_cdn"
            echo -e "\n${GREEN}✓ $T_CONFIG_CDN_CHANGED${NC}"
            sleep 2
        fi
    fi

    show_config_menu
    LAST_MENU=""
}

# -------------------- REGISTRATION -------------------- #

MOD_config_TYPE="menu"
MOD_config_MENU_LABEL="$T_MENU_CONFIG"
MOD_config_TITLE="$T_MENU_TITLE_CONFIG"
MOD_config_CLI_ARGS="config|c"
MOD_config_PRIORITY=80

ALL_MODULES="${ALL_MODULES:+$ALL_MODULES }config"

# Names from "$2.." that exist under "$1", as "dir/{a,b}" (or "dir/a" for one).
# Echoes nothing when none of them exists.
_uninstall_paths() {
    local dir="$1" name found=""
    shift
    for name in "$@"; do
        [[ -e "$dir/$name" || -L "$dir/$name" ]] && found+="${found:+,}$name"
    done
    [[ -z "$found" ]] && return 0
    [[ "$found" == *,* ]] && found="{$found}"
    printf '%s/%s' "$dir" "$found"
}

# True when $1 holds mn's block as one begin line followed by one end line. An end
# marker above the begin (a bad merge, a hand edit) would make the sed range run to
# the end of the file and eat the user's lines, so such a file is left alone.
_uninstall_block_ok() {
    awk -v b="$_MN_BLOCK_BEGIN" -v e="$_MN_BLOCK_END" '
        $0 == b { if (open) bad = 1; open = 1; seen = 1; next }
        $0 == e { if (!open) bad = 1; open = 0 }
        END { exit !(seen && !open && !bad) }
    ' "$1"
}

# What mn left in a shell file, as the exact lines that will go, or nothing.
_uninstall_shell_note() {
    local f="$1" note="" rest
    grep -qxF '# Added by mn installer' "$f" && note+="# Added by mn installer"
    rest=$(< "$f")
    if _uninstall_block_ok "$f"; then
        note+="${note:+, }$_MN_BLOCK_BEGIN ... $_MN_BLOCK_END"
        rest=$(sed '/^# >>> mn >>>$/,/^# <<< mn <<<$/d' "$f")
    fi
    # The 1.1 wrapper lived outside any block, only in ~/.bash_functions
    if [[ "$f" == "$BASH_FUNCTIONS" ]] && grep -q '^mn()' <<< "$rest"; then
        note+="${note:+, }mn()"
    fi
    printf '%s' "$note"
}

# Back to where the uninstall was started: the config menu in a TUI, the shell
# prompt for `mn uninstall`.
_uninstall_back() {
    if [[ -n "$_MN_TUI" ]]; then
        hide_cursor
        show_config_menu
        LAST_MENU=""
    else
        show_cursor
        printf '%b%s%b\n' "$BLUE" "$T_CANCELLED" "$NC"
    fi
}

config_uninstall() {
    _require_tty
    clear_screen
    draw_header "$T_CONFIG_UNINSTALL_TITLE"
    echo ""

    if ! checkbox_select "$T_UNINSTALL_SELECT" \
        "$T_UNINSTALL_ALL" \
        "$T_UNINSTALL_CORE" \
        "$T_UNINSTALL_CONFIG" \
        "$T_UNINSTALL_DATA" \
        "$T_UNINSTALL_PLUGINS"; then
        _uninstall_back
        return
    fi

    if [[ ${_CHK_CORE:-0} -eq 0 && ${_CHK_CONFIG:-0} -eq 0 && \
          ${_CHK_DATA:-0} -eq 0 && ${_CHK_PLUGINS:-0} -eq 0 ]]; then
        printf '\n%b%s%b\n' "$YELLOW" "$T_UNINSTALL_NOTHING" "$NC"
        if [[ -n "$_MN_TUI" ]]; then
            _wait_key
            _uninstall_back
        else
            show_cursor
        fi
        return
    fi

    # Work out what exists BEFORE anything is removed: the summary shows exactly
    # this, and the removal below acts on exactly this and nothing else.
    local bin_dir rc comp_file name script line self note i
    local -a links=() shell_files=() shell_notes=() comps=() scripts=()

    # Only a link that really resolves to this install is ours (the same
    # directory may hold a link to another mn)
    self=$(readlink -f "$MN_DIR/mn")
    for bin_dir in /usr/local/bin "$HOME/.local/bin" "$HOME/bin"; do
        [[ -L "$bin_dir/mn" && "$(readlink -f "$bin_dir/mn")" == "$self" ]] && links+=("$bin_dir/mn")
    done
    for rc in "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile" "$HOME/.zshrc" \
              "$BASH_ALIASES" "$BASH_FUNCTIONS"; do
        [[ -f "$rc" ]] || continue
        note=$(_uninstall_shell_note "$rc")
        [[ -n "$note" ]] && { shell_files+=("$rc"); shell_notes+=("$note"); }
    done
    for comp_file in \
        "/usr/share/bash-completion/completions/mn" \
        "$HOME/.local/share/bash-completion/completions/mn" \
        "/usr/share/zsh/vendor-completions/_mn" \
        "$HOME/.local/share/zsh/site-functions/_mn"; do
        [[ -f "$comp_file" ]] && comps+=("$comp_file")
    done
    # Function scripts are the user's own code: listed, never deleted
    if [[ -f "$FUNCS_FILE" ]]; then
        while IFS= read -r line || [[ -n "$line" ]]; do
            [[ -z "$line" || "$line" =~ ^# ]] && continue
            name="${line%%:::*}"
            _mn_v_func_name "$name" > /dev/null || continue
            script=$(funcs_script_path "$name") && scripts+=("$script")
        done < "$FUNCS_FILE"
    fi

    # Summary: language-neutral paths; shell files show the exact lines that go
    clear_screen
    draw_header "$T_CONFIG_UNINSTALL_TITLE"
    printf '\n%b%s%b\n' "$BOLD" "$T_UNINSTALL_SUMMARY" "$NC"
    if [[ ${_CHK_CORE:-0} -eq 1 ]]; then
        printf '\n  %b%s%b\n' "$CYAN" "$T_UNINSTALL_CORE" "$NC"
        printf '    %s\n' "$(_uninstall_paths "$MN_DIR" lib modules completions lang mn VERSION manifest)"
        for line in "${links[@]}" "${comps[@]}"; do printf '    %s\n' "$line"; done
        for (( i=0; i<${#shell_files[@]}; i++ )); do
            printf '    %s  %b(%s)%b\n' "${shell_files[$i]}" "$DIM" "${shell_notes[$i]}" "$NC"
        done
    fi
    if [[ ${_CHK_CONFIG:-0} -eq 1 ]]; then
        printf '\n  %b%s%b\n' "$CYAN" "$T_UNINSTALL_CONFIG" "$NC"
        line=$(_uninstall_paths "$MN_DIR" .lang .editor .cdn .repos)
        printf '    %s\n' "${line:-$MN_DIR/.lang}"
    fi
    if [[ ${_CHK_DATA:-0} -eq 1 ]]; then
        printf '\n  %b%s%b\n' "$CYAN" "$T_UNINSTALL_DATA" "$NC"
        printf '    %s\n' "$(_uninstall_paths "$MN_DIR" data docs)"
    fi
    if [[ ${_CHK_PLUGINS:-0} -eq 1 ]]; then
        printf '\n  %b%s%b\n' "$CYAN" "$T_UNINSTALL_PLUGINS" "$NC"
        printf '    %s\n' "$MN_DIR/plugins"
    fi
    if [[ ${#scripts[@]} -gt 0 ]]; then
        printf '\n%b%s%b\n' "$DIM" "$T_UNINSTALL_KEPT" "$NC"
        for line in "${scripts[@]}"; do printf '    %b%s%b\n' "$DIM" "$line" "$NC"; done
    fi
    echo ""

    # Cancel is preselected: a stray Enter never uninstalls
    echo -e "${RED}${T_CONFIG_UNINSTALL_CONFIRM}${NC}"
    if ! confirm_dialog 1; then
        _uninstall_back
        return
    fi
    echo ""

    # Core: bin links, installer lines, mn's own block, completions, program files
    if [[ ${_CHK_CORE:-0} -eq 1 ]]; then
        for line in "${links[@]}"; do rm -f "$line" 2> /dev/null || true; done
        for rc in "${shell_files[@]}"; do
            grep -qxF '# Added by mn installer' "$rc" &&
                sed -i --follow-symlinks '/^# Added by mn installer$/{N;d}' "$rc"
            if _uninstall_block_ok "$rc"; then
                sed -i --follow-symlinks '/^# >>> mn >>>$/,/^# <<< mn <<<$/d' "$rc"
            fi
        done
        # Legacy 1.1 wrapper, written outside any block
        [[ -f "$BASH_FUNCTIONS" ]] && sed -i --follow-symlinks '/^mn()/d' "$BASH_FUNCTIONS"
        for comp_file in "${comps[@]}"; do rm -f "$comp_file" 2> /dev/null || true; done

        rm -rf "$MN_DIR/lib" "$MN_DIR/modules" "$MN_DIR/completions" "$MN_DIR/lang"
        rm -f  "$MN_DIR/mn" "$MN_DIR/VERSION" "$MN_DIR/manifest"
        echo -e "${GREEN}$T_UNINSTALL_REMOVED_CORE${NC}"
    fi

    # Configuration: the dotfiles only (lang/ belongs to Core, mn needs it to run)
    if [[ ${_CHK_CONFIG:-0} -eq 1 ]]; then
        rm -f "$MN_DIR/.lang" "$MN_DIR/.editor" "$MN_DIR/.cdn" "$MN_DIR/.repos"
        echo -e "${GREEN}$T_UNINSTALL_REMOVED_CONFIG${NC}"
    fi

    # Data: records and the user's docs
    if [[ ${_CHK_DATA:-0} -eq 1 ]]; then
        rm -rf "$MN_DIR/data" "$MN_DIR/docs"
        echo -e "${GREEN}$T_UNINSTALL_REMOVED_DATA${NC}"
    fi

    # Plugins
    if [[ ${_CHK_PLUGINS:-0} -eq 1 ]]; then
        rm -rf "$MN_DIR/plugins"
        echo -e "${GREEN}$T_UNINSTALL_REMOVED_PLUGINS${NC}"
    fi

    # Remove the parent dir if everything was selected, but only when it is empty:
    # anything else in it was never listed above, so it stays
    if [[ ${_CHK_CORE:-0} -eq 1 && ${_CHK_CONFIG:-0} -eq 1 && \
          ${_CHK_DATA:-0} -eq 1 && ${_CHK_PLUGINS:-0} -eq 1 ]]; then
        rmdir "$MN_DIR" 2> /dev/null ||
            printf '%b%s%b %s\n' "$YELLOW" "$T_UNINSTALL_NOT_EMPTY" "$NC" "$MN_DIR"
    fi

    # The tree may be gone: no menu, no screen clear, no cleanup trap. The last
    # thing on screen stays the message, right above the shell prompt.
    trap - EXIT INT TERM
    show_cursor
    [[ ${_CHK_CORE:-0} -eq 1 ]] && echo -e "\n${GREEN}$T_CONFIG_UNINSTALL_DONE${NC}"
    echo ""
    exit 0
}
