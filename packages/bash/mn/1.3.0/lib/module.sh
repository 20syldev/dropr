#!/bin/bash
# =========================================================
# MN - Module accessors: reading declarative schemas
# =========================================================

# Module registry (each module adds itself via ALL_MODULES)
ALL_MODULES=""

# Read a module property
mod_prop() {
    local mod="$1" prop="$2"
    local varname="MOD_${mod}_${prop}"
    echo "${!varname}"
}

# Read a field property from a module
mod_field_prop() {
    local mod="$1" field="$2" prop="$3"
    local varname="MOD_${mod}_FIELD_${prop}_${field}"
    echo "${!varname}"
}

# Load field names into _MOD_FIELDS
mod_get_fields() {
    local mod="$1"
    local varname="MOD_${mod}_FIELDS"
    read -ra _MOD_FIELDS <<< "${!varname}"
}

# Get the title of a menu
get_menu_title() {
    local menu="$1"
    if [[ "$menu" == "main" ]]; then
        echo "$T_MENU_TITLE"
        return
    fi
    local title
    title=$(mod_prop "$menu" "TITLE")
    [[ -n "$title" ]] && echo "$title" || echo "$menu"
}

# Sort ALL_MODULES by PRIORITY (ascending), output one module name per line
_sort_modules_by_priority() {
    local mod priority
    local -a pairs=()
    for mod in $ALL_MODULES; do
        priority=$(mod_prop "$mod" "PRIORITY")
        priority="${priority:-50}"
        pairs+=("${priority}:${mod}")
    done
    printf '%s\n' "${pairs[@]}" | sort -t: -k1,1n | cut -d: -f2
}

# Route a CLI invocation to the correct handler based on module TYPE.
# Extra arguments go to the module's CLI_FN when it declares one; without a
# CLI_FN they are ignored, exactly like before.
_route_module() {
    local mod="$1"
    shift
    local mod_type cli_fn
    mod_type=$(mod_prop "$mod" "TYPE")
    cli_fn=$(mod_prop "$mod" "CLI_FN")

    if (( $# > 0 )) && [[ -n "$cli_fn" ]]; then
        $cli_fn "$@"
        return
    fi

    case "${mod_type:-crud}" in
        crud)
            _run_submenu "$mod"
            ;;
        menu)
            _require_tty
            local title
            title=$(mod_prop "$mod" "TITLE")
            _tui_enter
            "show_${mod}_menu"
            LAST_MENU="$mod"
            draw_menu "$title" "true"
            while true; do
                handle_input
                local redraw="false"
                [[ -z "$LAST_MENU" ]] && redraw="true" && LAST_MENU="$mod"
                title=$(get_menu_title "$CURRENT_MENU")
                draw_menu "$title" "$redraw"
            done
            ;;
    esac
}

# Yes/No display helper
_display_yes_no() {
    [[ -n "$1" ]] && echo "$T_YES" || echo "$T_NO"
}
