#!/bin/bash
# =========================================================
# MN - Module: Alias
# =========================================================

# -------------------- SCHEMA -------------------- #

MOD_alias_FILE="$ALIAS_FILE"
MOD_alias_TITLE="$T_ALIAS_TITLE"
MOD_alias_TITLE_ADD="$T_ALIAS_TITLE_ADD"
MOD_alias_NOUN="$T_ALIAS_NOUN"
MOD_alias_ADD_LABEL="$T_ALIAS_ADD_LABEL"
MOD_alias_FIELDS="name cmd desc"
MOD_alias_PAGINATION="true"
MOD_alias_REGEN="true"
MOD_alias_TYPE="crud"
MOD_alias_MENU_LABEL="$T_MENU_ALIAS"
MOD_alias_PRIORITY=30
MOD_alias_CLI_ARGS="alias|a"
MOD_alias_MENU_FORMAT_FN="_alias_menu_format"
MOD_alias_ENTRY_ACTION="_mod_entry_run:::alias"
MOD_alias_RUN_FN="_alias_run_cmd"

MOD_alias_FIELD_LABEL_name="$T_ALIAS_F_NAME"
MOD_alias_FIELD_REQUIRED_name="yes"
MOD_alias_FIELD_TYPE_name="text"

MOD_alias_FIELD_LABEL_cmd="$T_ALIAS_F_CMD"
MOD_alias_FIELD_REQUIRED_cmd="yes"
MOD_alias_FIELD_TYPE_cmd="text"

MOD_alias_FIELD_LABEL_desc="$T_ALIAS_F_DESC"
MOD_alias_FIELD_REQUIRED_desc="no"
MOD_alias_FIELD_TYPE_desc="text"

# -------------------- FORMAT -------------------- #

_alias_menu_format() {
    dat_parse "$1"
    local name="${_DAT_FIELDS[0]}" cmd="${_DAT_FIELDS[1]}"
    [[ ${#cmd} -gt 50 ]] && cmd="${cmd:0:47}..."
    echo -e "${CYAN}$name${NC} ${WHITE}-${NC} ${GRAY}$cmd${NC}"
}

# -------------------- HOOKS -------------------- #

_alias_run_cmd() {
    local name="$1"
    dat_read "$ALIAS_FILE" "$name"
    echo "${_DAT_FIELDS[1]}"
}

# -------------------- WRAPPER -------------------- #

show_alias_menu() { generic_show_menu "alias"; }

# Register the module
ALL_MODULES="${ALL_MODULES:+$ALL_MODULES }alias"
