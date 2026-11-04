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
MOD_alias_FIELD_VALIDATE_FN_name="_mn_v_alias_name"

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
    # Menu-safe: additive colors only (no SGR 0, it would end the selection bar)
    # and %s only (user data is never interpreted as escapes).
    _trunc "$cmd" 50
    printf '%s%s%s %s-%s %s%s%s' "$C_CYAN" "$name" "$FG_RESET" "$C_WHITE" "$FG_RESET" \
        "$C_GRAY" "$_TRUNC" "$FG_RESET"
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
