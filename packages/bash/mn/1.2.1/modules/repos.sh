#!/bin/bash
# =========================================================
# MN - Module: GitHub Repositories
# =========================================================

# -------------------- SCHEMA -------------------- #

MOD_repos_FILE="$REPOS_FILE"
MOD_repos_TITLE="$T_REPOS_TITLE"
MOD_repos_TITLE_ADD="$T_REPOS_TITLE_ADD"
MOD_repos_NOUN="$T_REPOS_NOUN"
MOD_repos_ADD_LABEL="$T_REPOS_ADD_LABEL"
MOD_repos_FIELDS="name path desc"
MOD_repos_PAGINATION="true"
MOD_repos_REGEN="true"
MOD_repos_TYPE="crud"
MOD_repos_MENU_LABEL="$T_MENU_REPOS"
MOD_repos_PRIORITY=20
MOD_repos_CLI_ARGS="repos|repo|r"
MOD_repos_MENU_FORMAT_FN="_repos_menu_format"
MOD_repos_ENTRY_ACTION="repos_manage"

MOD_repos_FIELD_LABEL_name="$T_REPOS_F_NAME"
MOD_repos_FIELD_REQUIRED_name="yes"
MOD_repos_FIELD_TYPE_name="text"
MOD_repos_FIELD_VALIDATE_FN_name="_mn_v_alias_name"

MOD_repos_FIELD_LABEL_path="$T_REPOS_F_PATH"
MOD_repos_FIELD_REQUIRED_path="no"
MOD_repos_FIELD_TYPE_path="text"
MOD_repos_FIELD_DEFAULT_FN_path="_repos_default_path_fn"
MOD_repos_FIELD_TRANSFORM_FN_path="_repos_path_transform"

MOD_repos_FIELD_LABEL_desc="$T_REPOS_F_DESC"
MOD_repos_FIELD_REQUIRED_desc="no"
MOD_repos_FIELD_TYPE_desc="text"

# -------------------- FORMAT -------------------- #

_repos_menu_format() {
    dat_parse "$1"
    local name="${_DAT_FIELDS[0]}" path="${_DAT_FIELDS[1]}"
    # Menu-safe: additive colors only and %s only (see _config_row)
    printf '%s%s%s %s-%s %s%s%s' "$C_CYAN" "$name" "$FG_RESET" "$C_WHITE" "$FG_RESET" \
        "$C_GRAY" "$path" "$FG_RESET"
}

# -------------------- HELPERS -------------------- #

# The root comes from the user's configuration, never from a layout baked into
# the package: see MN_REPOS_ROOT in lib/core.sh and `mn config` -> [P].
_repos_default_path_fn() {
    echo "${MN_REPOS_ROOT}/$1"
}

# An absolute path or a ~ path is kept verbatim; anything else is a bare name
# resolved under the configured root.
_repos_path_transform() {
    local input="$1"
    local name="$2"
    if [[ -z "$input" ]]; then
        echo "${MN_REPOS_ROOT}/${name}"
    elif [[ "$input" != /* && "$input" != ~* && "$input" != \$* ]]; then
        echo "${MN_REPOS_ROOT}/${input}"
    else
        echo "$input"
    fi
}

# -------------------- HOOKS -------------------- #

repos_manage() {
    local name="$1"
    dat_read "$REPOS_FILE" "$name"
    local path="${_DAT_FIELDS[1]}"
    repos_open "$name" "$path"
}

repos_open() {
    local name="$1"
    local path="$2"
    local rc
    # Only a leading ~ or $HOME is expanded, nothing from repos.dat is evaluated
    path=$(_mn_expand_path "$path")
    show_cursor
    clear_screen

    # No spinner: the editor takes the foreground immediately, so a
    # background writer would just scribble over its display.
    $MN_EDITOR "$path"
    rc=$?

    # A GUI editor detaches from the terminal, so the terminal that launched mn
    # can be closed. A terminal editor, or any failure, goes back to the menu.
    if (( rc == 0 )) && mn_editor_is_gui; then
        # The shell is about to die before its wrapper can clean up: nothing was
        # handed over, so drop the empty run file now instead of leaking it
        _mn_wrapped && [[ ! -s "$MN_RUN_FILE" ]] && rm -f -- "$MN_RUN_FILE"
        kill -HUP $PPID 2>/dev/null
        exit 0
    fi
    if (( rc != 0 )); then
        _form_flash "$T_REPOS_OPEN_FAILED"
    fi
    hide_cursor
    LAST_MENU=""
}

# -------------------- WRAPPER -------------------- #

show_repos_menu() { generic_show_menu "repos"; }

# Register the module
ALL_MODULES="${ALL_MODULES:+$ALL_MODULES }repos"
