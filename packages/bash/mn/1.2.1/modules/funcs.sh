#!/bin/bash
# =========================================================
# MN - Module: Functions
# =========================================================

# -------------------- SCHEMA -------------------- #

MOD_funcs_FILE="$FUNCS_FILE"
MOD_funcs_TITLE="$T_FUNCS_TITLE"
MOD_funcs_TITLE_ADD="$T_FUNCS_TITLE_ADD"
MOD_funcs_NOUN="$T_FUNCS_NOUN"
MOD_funcs_ADD_LABEL="$T_FUNCS_ADD_LABEL"
MOD_funcs_FIELDS="name desc func_type"
MOD_funcs_PAGINATION="true"
MOD_funcs_REGEN="true"
MOD_funcs_TYPE="crud"
MOD_funcs_MENU_LABEL="$T_MENU_FUNCS"
MOD_funcs_PRIORITY=40
MOD_funcs_CLI_ARGS="funcs|func|f"
MOD_funcs_MENU_FORMAT_FN="_funcs_menu_format"
MOD_funcs_ENTRY_ACTION="_mod_entry_run:::funcs"
MOD_funcs_POST_ADD_FN="_funcs_post_add"
MOD_funcs_DELETE_FN="_funcs_delete"
MOD_funcs_VIEW_FN="_funcs_view"
MOD_funcs_EDIT_FN="funcs_edit"

MOD_funcs_FIELD_LABEL_name="$T_FUNCS_F_NAME"
MOD_funcs_FIELD_REQUIRED_name="yes"
MOD_funcs_FIELD_TYPE_name="text"
MOD_funcs_FIELD_VALIDATE_FN_name="_mn_v_func_name"

MOD_funcs_FIELD_LABEL_desc="$T_FUNCS_F_DESC"
MOD_funcs_FIELD_REQUIRED_desc="no"
MOD_funcs_FIELD_TYPE_desc="text"

MOD_funcs_FIELD_LABEL_func_type="$T_FUNCS_F_TYPE"
MOD_funcs_FIELD_REQUIRED_func_type="no"
MOD_funcs_FIELD_TYPE_func_type="choice"
MOD_funcs_FIELD_CHOICES_func_type="1::$T_FUNCS_TYPE_NORMAL|2:shell:$T_FUNCS_TYPE_SHELL"
MOD_funcs_FIELD_DEFAULT_func_type=""

# -------------------- FORMAT -------------------- #

_funcs_menu_format() {
    dat_parse "$1"
    local name="${_DAT_FIELDS[0]}" desc="${_DAT_FIELDS[1]}" type="${_DAT_FIELDS[2]}"
    local type_tag=""
    # Menu-safe: additive colors only and %s only (see _config_row)
    [[ "$type" == "shell" ]] && printf -v type_tag ' %s[shell]%s' "$C_YELLOW" "$FG_RESET"
    printf '%s%s%s%s %s-%s %s%s%s' "$C_CYAN" "$name" "$FG_RESET" "$type_tag" \
        "$C_WHITE" "$FG_RESET" "$C_GRAY" "$desc" "$FG_RESET"
}

# -------------------- HOOKS -------------------- #

# Run sudo without letting Ctrl-C at the password prompt kill the TUI
_funcs_sudo() {
    local old_trap rc
    old_trap=$(trap -p INT)
    trap : INT
    sudo "$@"
    rc=$?
    eval "${old_trap:-trap - INT}"
    return $rc
}

# Open a script in the editor, via sudoedit when the file is not writable
_funcs_open_editor() {
    local script="$1"
    if [[ -w "$script" ]]; then
        $MN_EDITOR "$script"
    else
        local sudo_editor="$MN_EDITOR"
        mn_editor_is_gui && sudo_editor="$sudo_editor --wait"
        echo -e "  ${YELLOW}$T_FUNCS_ROOT_OWNED${NC}"
        if ! SUDO_EDITOR="$sudo_editor" _funcs_sudo -e "$script"; then
            echo -e "  ${RED}✗ $T_FUNCS_EDIT_FAILED${NC}"
            sleep 2
        fi
    fi
}

# Remove a script, via sudo when its directory is not writable
_funcs_remove_file() {
    local script="$1"
    local dir="${script%/*}"
    if [[ -w "$dir" ]]; then
        rm -f "$script"
    else
        echo -e "  ${YELLOW}$T_FUNCS_ROOT_OWNED${NC}"
        _funcs_sudo rm -f "$script"
    fi
}

# Custom view: show script content
_funcs_view() {
    local name="$1"
    clear_screen
    draw_header "${T_FUNCS_NOUN^}: $name"

    dat_read "$FUNCS_FILE" "$name"
    local desc="${_DAT_FIELDS[1]}"
    local type="${_DAT_FIELDS[2]}"
    local script
    script=$(funcs_script_path "$name")

    # Stored values go through ui_kv: shown verbatim, never through echo -e
    ui_kv "$T_FUNCS_F_DESC" "$desc"
    [[ "$type" == "shell" ]] && ui_kv "$T_FUNCS_F_TYPE" "shell ($T_FUNCS_SOURCED)"
    ui_kv "$T_FUNCS_FILE_LABEL" "$script"
    echo ""

    if [[ -f "$script" ]]; then
        echo -e "${CYAN}$T_FUNCS_CONTENT${NC}"
        cat "$script"
        echo -e "${CYAN}$T_FUNCS_CONTENT_END${NC}"
    else
        echo -e "${RED}✗ $script $T_FUNCS_NOT_FOUND${NC}"
    fi

    echo -e "\n${DIM}$T_PRESS_KEY${NC}"
    _wait_key
    hide_cursor
    LAST_MENU=""
}

# Custom edit: open in the configured editor
funcs_edit() {
    local name="$1"
    show_cursor

    local script
    if script=$(funcs_script_path "$name"); then
        _funcs_open_editor "$script"
    else
        clear_screen
        draw_header "${T_EDIT_PREFIX}: $name"
        echo -e "${RED}✗ $script $T_FUNCS_NOT_FOUND${NC}"
        sleep 1
    fi
    hide_cursor
    show_funcs_menu
}

# Post-add: create script and open in the configured editor
_funcs_post_add() {
    local name="$1"
    local type="${3:-}"
    local script
    if ! script=$(funcs_script_path "$name"); then
        local dir="${script%/*}"
        mkdir -p "$dir" 2>/dev/null
        if ! { echo '#!/bin/bash' > "$script"; } 2>/dev/null; then
            dat_delete_entry "$FUNCS_FILE" "$name"
            regenerate_bash_files
            echo -e "  ${RED}✗ $T_FUNCS_CREATE_FAILED: $script${NC}"
            sleep 2
            return 1
        fi
        chmod +x "$script"
        if [[ "$type" != "shell" && ":$PATH:" != *":$dir:"* ]]; then
            echo -e "  ${YELLOW}⚠ $dir $T_FUNCS_PATH_WARN${NC}"
            sleep 2
        fi
    fi
    echo -e "  ${CYAN}$T_FUNCS_OPEN_EDITOR $script...${NC}"
    sleep 1
    _funcs_open_editor "$script"
    return 0
}

# Custom deletion: double confirmation
_funcs_delete() {
    local name="$1"
    clear_screen
    draw_header "${T_DEL_PREFIX}: $name"
    show_cursor

    dat_read "$FUNCS_FILE" "$name"
    local desc="${_DAT_FIELDS[1]}"
    local script
    script=$(funcs_script_path "$name")

    ui_kv "${T_FUNCS_NOUN^}" "$name"
    [[ -n "$desc" ]] && ui_kv "$T_FUNCS_F_DESC" "$desc"
    ui_kv "$T_FUNCS_FILE_LABEL" "$script"
    echo ""

    echo -e "${CYAN}$T_FUNCS_DEL_DAT${NC}"
    if confirm_dialog; then
        # The record is still in the file: say so, and keep the script
        if ! dat_delete_entry "$FUNCS_FILE" "$name"; then
            echo -e "\n${RED}✗ $T_ERR_WRITE: $FUNCS_FILE${NC}"
            sleep 2
            hide_cursor
            show_funcs_menu
            return
        fi
        _mod_regen || true

        if [[ -f "$script" ]]; then
            echo -e "\n${CYAN}$T_FUNCS_DEL_FILE $script ?${NC}"
            if confirm_dialog; then
                if _funcs_remove_file "$script"; then
                    echo -e "\n${GREEN}✓ $T_FUNCS_DEL_BOTH${NC}"
                else
                    echo -e "\n${RED}✗ $T_FUNCS_DEL_FAILED: $script${NC}"
                    sleep 1
                fi
            else
                echo -e "\n${GREEN}✓ $T_FUNCS_DEL_ENTRY${NC}"
            fi
        else
            echo -e "\n${GREEN}✓ $T_FUNCS_DEL_ENTRY${NC}"
        fi
        sleep 1
    fi

    hide_cursor
    show_funcs_menu
}

# -------------------- WRAPPER -------------------- #

show_funcs_menu() { generic_show_menu "funcs"; }

# Register the module
ALL_MODULES="${ALL_MODULES:+$ALL_MODULES }funcs"
