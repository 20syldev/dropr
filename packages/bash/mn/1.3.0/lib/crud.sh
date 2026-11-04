#!/bin/bash
# =========================================================
# MN - Generic CRUD engine
# =========================================================

_MENU_LINES=()
_MENU_STATUS=""
_MENU_HIDE_ADD="false"

# Build the menu of a module from its .dat file.
# $2 = key to keep the cursor on (after an add / edit / filter), optional.
generic_show_menu() {
    local mod="$1"
    local keep_key="${2:-}"
    CURRENT_MENU="$mod"
    SELECTED_INDEX=0
    CURRENT_PAGE=0

    local pagination
    pagination=$(mod_prop "$mod" "PAGINATION")
    USE_PAGINATION="$pagination"
    _menu_page_size

    MENU_ITEMS=()
    MENU_ACTIONS=()

    local dat_file format_fn entry_action prepare_fn add_label line key display
    dat_file=$(mod_prop "$mod" "FILE")
    format_fn=$(mod_prop "$mod" "MENU_FORMAT_FN")
    entry_action=$(mod_prop "$mod" "ENTRY_ACTION")
    prepare_fn=$(mod_prop "$mod" "MENU_PREPARE_FN")
    add_label=$(mod_prop "$mod" "ADD_LABEL")

    # Default line source: the .dat file, comments and blanks skipped
    _MENU_LINES=()
    if [[ -f "$dat_file" && -s "$dat_file" ]]; then
        while IFS= read -r line || [[ -n "$line" ]]; do
            [[ -z "$line" || "$line" == \#* ]] && continue
            _MENU_LINES+=("$line")
        done < "$dat_file"
    fi

    # Reset before the hook so a module can never leak state into another menu
    _MENU_STATUS=""
    _MENU_HIDE_ADD="false"
    # PASS 1: runs in THIS shell, may reorder or filter _MENU_LINES and compute
    # layout globals that the format function reads back from its subshell.
    [[ -n "$prepare_fn" ]] && $prepare_fn "$mod" "$dat_file"

    if [[ "$_MENU_HIDE_ADD" != "true" ]]; then
        # printf -v with %b so the row carries real escape bytes, and additive
        # colours so the selection bar survives it.
        local add_row
        printf -v add_row '%b[+]%b %s' "$C_GREEN" "$FG_RESET" "$add_label"
        MENU_ITEMS+=("$add_row")
        MENU_ACTIONS+=("generic_add:::$mod")
    fi

    # A module without MENU_FORMAT_FN or ENTRY_ACTION gets the key and the view:
    # an empty name would make the engine execute the data line itself.
    [[ -z "$entry_action" ]] && entry_action="_mod_entry_view:::$mod"

    for line in "${_MENU_LINES[@]}"; do
        key="${line%%:::*}"
        if [[ -n "$format_fn" ]]; then
            display=$($format_fn "$line")
        else
            display="$key"
        fi
        MENU_ITEMS+=("$display")
        MENU_ACTIONS+=("${entry_action}:::${key}")
    done

    # Restore the cursor on a given key instead of jumping back to the top
    if [[ -n "$keep_key" ]]; then
        local i
        for (( i=0; i<${#MENU_ACTIONS[@]}; i++ )); do
            if [[ "${MENU_ACTIONS[$i]##*:::}" == "$keep_key" ]]; then
                SELECTED_INDEX=$i
                break
            fi
        done
        _menu_sync_page
    fi
}

# -------------------- FORM PLUMBING -------------------- #

_FORM_VALUES=()
_FORM_MSG=""
_FORM_ANSWER=""
# Key of the record being edited ("" on add). Hooks that run in a subshell read it
# to tell "the record itself" from "another record" (duplicate checks).
_FORM_OLD_KEY=""
# Typing this alone in any field aborts the wizard. Ctrl-D cannot be used:
# with read -e -i the prefilled buffer is non-empty, so EOF never fires.
FORM_CANCEL="!"

# Readline prompt. \001..\002 mark the non-printing bytes; without them readline
# miscounts the columns and redraws over the label on the first Ctrl-A or arrow.
_form_prompt() {
    local label="$1" hint="$2" out
    printf -v out '\001%s\002  %s' "$C_CYAN" "$label"
    [[ -n "$hint" ]] && printf -v out '%s\001%s\002 %s' "$out" "$C_GRAY" "$hint"
    printf -v out '%s\001%s\002: \001%s\002' "$out" "$C_CYAN" "$FG_RESET"
    printf '%s' "$out"
}

# Redraw the already-captured fields with a check mark
_form_recap() {
    local mod="$1" upto="$2"
    local i label val display_fn
    for (( i=0; i<upto; i++ )); do
        label=$(mod_field_prop "$mod" "${_MOD_FIELDS[$i]}" "LABEL")
        val="${_FORM_VALUES[$i]}"
        display_fn=$(mod_field_prop "$mod" "${_MOD_FIELDS[$i]}" "DISPLAY_FN")
        [[ -n "$display_fn" ]] && val=$($display_fn "$val")
        printf '  %s✓%s %s: %s%s%s\n' "$C_GREEN" "$FG_RESET" "$label" "$C_WHITE" "${val//[[:cntrl:]]/?}" "$FG_RESET"
    done
    (( upto > 0 )) && echo ""
    return 0
}

# REQUIRED, then VALIDATE_FN. Message left in _FORM_MSG, rc 1 when invalid.
# A VALIDATE_FN returns 0 when valid, or 1 with its message on stdout.
_form_validate() {
    local mod="$1" field="$2" value="$3"
    local label required fn err
    label=$(mod_field_prop "$mod" "$field" "LABEL")
    required=$(mod_field_prop "$mod" "$field" "REQUIRED")
    if [[ "$required" == "yes" && -z "$value" ]]; then
        _FORM_MSG="$label $T_REQUIRED"
        return 1
    fi
    if ! dat_safe_value "$value"; then
        _FORM_MSG="$label: $T_ERR_SEPARATOR"
        return 1
    fi
    fn=$(mod_field_prop "$mod" "$field" "VALIDATE_FN")
    if [[ -n "$fn" ]]; then
        if ! err=$($fn "$value"); then
            _FORM_MSG="$label: ${err:-$T_FORM_INVALID}"
            return 1
        fi
    fi
    return 0
}

# Always-visible cancel hint, dimmed, right under the header
_form_hint() {
    printf '  %b%s%b\n\n' "$DIM" "$T_FORM_CANCEL_HINT" "$NC"
}

# Ask one field. Result in _FORM_ANSWER, rc 1 when the user cancels the wizard.
# Ctrl-C cancels like the cancel word: inside the TUI the menu's INT trap would
# quit mn, so it is swapped for a flag trap for the duration of the question and
# put back afterwards (same pattern as _funcs_sudo).
_form_ask() {
    local old_int rc
    old_int=$(trap -p INT)
    _FORM_INTR=""
    trap '_FORM_INTR=1' INT
    _form_ask_field "$@"
    rc=$?
    eval "${old_int:-trap - INT}"
    [[ -n "$_FORM_INTR" ]] && rc=1
    _FORM_INTR=""
    return $rc
}

_form_ask_field() {
    local mod="$1" field="$2" prefill="$3"
    local label hint ftype choices
    label=$(mod_field_prop "$mod" "$field" "LABEL")
    hint=$(mod_field_prop "$mod" "$field" "HINT")
    ftype=$(mod_field_prop "$mod" "$field" "TYPE")
    choices=$(mod_field_prop "$mod" "$field" "CHOICES")
    _FORM_ANSWER=""

    # bash restarts a plain read after a trapped signal, so Ctrl-C would never
    # reach it. A read inside $( ) runs in a child that dies on SIGINT with
    # status 130, which is the cancellation signal for the text and password cases.
    case "$ftype" in
        password)
            echo -ne "$(_form_prompt "$label" "$hint")"
            # A failed read means EOF (Ctrl-D, or stdin closed) or Ctrl-C: abort
            # the wizard. Without this the retry loop below would spin forever on
            # a required field, with no way out but Ctrl-C.
            _FORM_ANSWER=$(read -rs v && printf %s "$v") || { echo ""; return 1; }
            echo ""
            ;;
        choice)
            local -a items=() opts=()
            local c cval cdisp idx=0 ci=0
            local IFS='|'
            items=($choices)
            unset IFS
            for c in "${items[@]}"; do
                cval="${c#*:}"; cval="${cval%%:*}"
                cdisp="${c#*:}"; cdisp="${cdisp#*:}"
                opts+=("${cval}:::${cdisp}")
                [[ "$cval" == "$prefill" ]] && idx=$ci
                (( ci++ ))
            done
            echo -e "${CYAN}  ${label}:${NC}"
            _SELECT_INDEX=$idx
            # Cancelling keeps the current value; it is re-validated by the caller,
            # so an out-of-list value can never be saved silently. The key reader
            # polls so that Ctrl-C (a flag, see _form_ask) is noticed without a key.
            _SELECT_POLL=0.2 select_option "" "${opts[@]}" \
                && _FORM_ANSWER="$_SELECT_VALUE" || _FORM_ANSWER="$prefill"
            ;;
        *)
            # -e -i pre-fills an editable value: an unchanged field costs one
            # keystroke. -r keeps backslashes intact (aliases.dat contains some).
            # The value goes through stdout, as the read itself cannot be interrupted.
            _FORM_ANSWER=$(read -e -r -i "$prefill" -p "$(_form_prompt "$label" "$hint")" v \
                && printf %s "$v") || return 1
            ;;
    esac

    [[ "$_FORM_ANSWER" == "$FORM_CANCEL" ]] && return 1
    return 0
}

# Regenerate the shell files after a data change. The record itself is already
# written, so a failure is a warning, never a silent success. regenerate_bash_files
# has printed the detail (the file or the skipped names) on stderr.
_mod_regen() {
    regenerate_bash_files && return 0
    printf '\n  %s⚠ %s%s\n' "$C_YELLOW" "$T_REGEN_FAILED" "$FG_RESET"
    sleep 2
    return 1
}

# Shared write path for add and edit. $3 = old key ("" when adding).
_form_commit() {
    local mod="$1" dat_file="$2" old_key="$3"
    local regen normalize_fn dat_header line

    normalize_fn=$(mod_prop "$mod" "NORMALIZE_FN")
    if [[ -n "$normalize_fn" ]]; then
        # Whole-record normalisation, run in the parent through its stdout: this is
        # the only hook that can rewrite a field from another field's value (a pasted
        # user@host split into target + user). A TRANSFORM_FN cannot: it is called in
        # a command substitution, so its globals are lost.
        mapfile -t _FORM_VALUES < <($normalize_fn "${_FORM_VALUES[@]}")
    fi

    if ! line=$(dat_join "${_FORM_VALUES[@]}"); then
        _FORM_MSG="$T_ERR_SEPARATOR"
        return 1
    fi

    # One atomic step: the old record is dropped and the new one added together,
    # or nothing changes. The sort and header steps below only reorder a file
    # that is already complete, so a failure there never loses a record.
    if ! dat_upsert "$dat_file" "$old_key" "$line"; then
        _FORM_MSG="$T_ERR_WRITE: $dat_file"
        return 1
    fi
    sort_dat_file "$dat_file"
    dat_header=$(mod_prop "$mod" "DAT_HEADER")
    [[ -n "$dat_header" ]] && dat_ensure_header "$dat_file" "$dat_header"

    regen=$(mod_prop "$mod" "REGEN")
    [[ "$regen" == "true" ]] && { _mod_regen || true; }
    return 0
}

# Inline error, then hand back to the caller
_form_flash() {
    show_cursor
    echo -e "\n  ${RED}✗ $1${NC}"
    sleep 2
    hide_cursor
    LAST_MENU=""
}

# Step-by-step add wizard, one screen per field, nothing lost on error
generic_add() {
    local mod="$1"
    local title dat_file noun
    title=$(mod_prop "$mod" "TITLE_ADD")
    dat_file=$(mod_prop "$mod" "FILE")
    noun=$(mod_prop "$mod" "NOUN")

    show_cursor
    mod_get_fields "$mod"
    _FORM_VALUES=()
    _FORM_MSG=""
    _FORM_OLD_KEY=""
    local step=0 field transform_fn

    for field in "${_MOD_FIELDS[@]}"; do
        local default_val default_fn prefill
        default_val=$(mod_field_prop "$mod" "$field" "DEFAULT")
        default_fn=$(mod_field_prop "$mod" "$field" "DEFAULT_FN")
        prefill="$default_val"
        # DEFAULT_FN receives every value captured so far, in field order
        [[ -n "$default_fn" ]] && prefill=$($default_fn "${_FORM_VALUES[@]}")

        while true; do
            clear_screen
            draw_header "$title"
            _form_hint
            _form_recap "$mod" "$step"
            if [[ -n "$_FORM_MSG" ]]; then
                echo -e "  ${RED}✗ ${_FORM_MSG}${NC}\n"
                _FORM_MSG=""
            fi

            if ! _form_ask "$mod" "$field" "$prefill"; then
                hide_cursor
                generic_show_menu "$mod"
                return
            fi

            # Same call as 1.1.2: right after the read, with the values captured so
            # far, before the checks so that the stored value is the validated one.
            # Not applied on edit, which never transformed anything.
            transform_fn=$(mod_field_prop "$mod" "$field" "TRANSFORM_FN")
            [[ -n "$transform_fn" ]] \
                && _FORM_ANSWER=$($transform_fn "$_FORM_ANSWER" "${_FORM_VALUES[@]}")

            _form_validate "$mod" "$field" "$_FORM_ANSWER" || { prefill="$_FORM_ANSWER"; continue; }

            # Field 0 is the entry key: refuse a duplicate
            if (( step == 0 )) && dat_read "$dat_file" "$_FORM_ANSWER"; then
                _FORM_MSG="${noun^} '$_FORM_ANSWER' $T_ALREADY_EXISTS"
                prefill="$_FORM_ANSWER"
                continue
            fi
            break
        done

        _FORM_VALUES+=("$_FORM_ANSWER")
        (( step++ ))
    done

    if ! _form_commit "$mod" "$dat_file" ""; then
        _form_flash "$_FORM_MSG"
        generic_show_menu "$mod"
        return
    fi

    local post_add_fn
    post_add_fn=$(mod_prop "$mod" "POST_ADD_FN")
    if [[ -n "$post_add_fn" ]] && ! $post_add_fn "${_FORM_VALUES[@]}"; then
        hide_cursor
        generic_show_menu "$mod" "${_FORM_VALUES[0]}"
        return
    fi

    clear_screen
    draw_header "$title"
    _form_recap "$mod" "${#_MOD_FIELDS[@]}"
    printf '  %s✓ %s '"'"'%s'"'"' %s !%s\n' "$C_GREEN" "${noun^}" "${_FORM_VALUES[0]//[[:cntrl:]]/?}" "$T_ADDED" "$FG_RESET"
    sleep 1
    hide_cursor
    generic_show_menu "$mod" "${_FORM_VALUES[0]}"
}

# Edit wizard: same path as add, prefilled from the file, key field included
generic_edit() {
    local mod="$1"
    local key="$2"
    local dat_file noun
    dat_file=$(mod_prop "$mod" "FILE")
    noun=$(mod_prop "$mod" "NOUN")

    dat_read "$dat_file" "$key" || return
    local -a old=("${_DAT_FIELDS[@]}")

    show_cursor
    mod_get_fields "$mod"
    _FORM_VALUES=()
    _FORM_MSG=""
    _FORM_OLD_KEY="$key"
    local step=0 field

    for field in "${_MOD_FIELDS[@]}"; do
        local prefill="${old[$step]:-}"
        while true; do
            clear_screen
            draw_header "${T_EDIT_PREFIX}: $key"
            _form_hint
            _form_recap "$mod" "$step"
            if [[ -n "$_FORM_MSG" ]]; then
                echo -e "  ${RED}✗ ${_FORM_MSG}${NC}\n"
                _FORM_MSG=""
            fi

            if ! _form_ask "$mod" "$field" "$prefill"; then
                hide_cursor
                generic_show_menu "$mod" "$key"
                return
            fi

            _form_validate "$mod" "$field" "$_FORM_ANSWER" || { prefill="$_FORM_ANSWER"; continue; }

            # Renaming is allowed; only a collision with ANOTHER entry is refused
            if (( step == 0 )) && [[ "$_FORM_ANSWER" != "$key" ]] \
                && dat_read "$dat_file" "$_FORM_ANSWER"; then
                _FORM_MSG="${noun^} '$_FORM_ANSWER' $T_ALREADY_EXISTS"
                prefill="$_FORM_ANSWER"
                continue
            fi
            break
        done

        _FORM_VALUES+=("$_FORM_ANSWER")
        (( step++ ))
    done

    if ! _form_commit "$mod" "$dat_file" "$key"; then
        _form_flash "$_FORM_MSG"
        generic_show_menu "$mod" "$key"
        return
    fi

    clear_screen
    draw_header "${T_EDIT_PREFIX}: ${_FORM_VALUES[0]}"
    _form_recap "$mod" "${#_MOD_FIELDS[@]}"
    echo -e "  ${GREEN}✓ ${noun^} $T_UPDATED !${NC}"
    sleep 1
    hide_cursor
    generic_show_menu "$mod" "${_FORM_VALUES[0]}"
}

# Deletion with confirmation
generic_delete() {
    local mod="$1"
    local key="$2"

    local custom_fn
    custom_fn=$(mod_prop "$mod" "DELETE_FN")
    if [[ -n "$custom_fn" ]]; then
        $custom_fn "$key"
        return
    fi

    local dat_file regen noun
    dat_file=$(mod_prop "$mod" "FILE")
    regen=$(mod_prop "$mod" "REGEN")
    noun=$(mod_prop "$mod" "NOUN")

    clear_screen
    draw_header "${T_DEL_PREFIX}: ${key//\\/\\\\}"
    show_cursor

    dat_read "$dat_file" "$key" && _mod_print_fields "$mod" 0
    echo ""

    # Preselect "confirm": the user pressed [D] on this entry on purpose, and a
    # bare Enter used to cancel with no message at all.
    if confirm_dialog 0; then
        # A record that is still in the file must never be reported as deleted
        if dat_delete_entry "$dat_file" "$key"; then
            [[ "$regen" == "true" ]] && { _mod_regen || true; }
            echo -e "\n${GREEN}✓ ${noun^} $T_DELETED !${NC}"
        else
            echo -e "\n${RED}✗ $T_ERR_WRITE: $dat_file${NC}"
        fi
    else
        echo -e "\n${GRAY}$T_CANCELLED${NC}"
    fi
    sleep 1

    hide_cursor
    generic_show_menu "$mod"
}

# Print the record that dat_read just loaded: one aligned, indented row per
# non-empty field, starting at field index $2 (0 = with the key). Values go
# through ui_kv, so they are shown verbatim.
_mod_print_fields() {
    local mod="$1" first="${2:-0}"
    local i field val display_fn w=0
    local -a labels=() values=()

    mod_get_fields "$mod"
    for (( i = first; i < ${#_MOD_FIELDS[@]}; i++ )); do
        val="${_DAT_FIELDS[$i]}"
        [[ -z "$val" ]] && continue
        field="${_MOD_FIELDS[$i]}"
        display_fn=$(mod_field_prop "$mod" "$field" "DISPLAY_FN")
        [[ -n "$display_fn" ]] && val=$($display_fn "$val")
        labels+=("$(mod_field_prop "$mod" "$field" "LABEL")")
        values+=("$val")
        _vislen "${labels[${#labels[@]}-1]}"
        (( _VISLEN > w )) && w=$_VISLEN
    done
    for (( i = 0; i < ${#labels[@]}; i++ )); do
        ui_kv "${labels[i]}" "${values[i]}" "$w"
    done
}

# Detailed view
generic_view() {
    local mod="$1"
    local key="$2"

    local dat_file
    dat_file=$(mod_prop "$mod" "FILE")

    clear_screen
    draw_header "$(echo "$mod" | tr '[:lower:]' '[:upper:]'): ${key//\\/\\\\}"

    dat_read "$dat_file" "$key" && _mod_print_fields "$mod" 1

    echo -e "\n${DIM}$T_PRESS_KEY${NC}"
    _wait_key
    hide_cursor
    LAST_MENU=""
}

# Entry action: exit mn and let the shell wrapper run the command. Without the
# wrapper nothing could run it, so show it and stay in the menu instead of quitting
# silently and replaying the command later.
_mod_entry_run() {
    local mod="$1"
    local key="$2"
    local run_fn cmd
    run_fn=$(mod_prop "$mod" "RUN_FN")
    if [[ -n "$run_fn" ]]; then
        cmd=$($run_fn "$key")
    else
        cmd="$key"
    fi

    if _mn_wrapped && printf '%s\n' "$cmd" > "$MN_RUN_FILE" 2>/dev/null; then
        cleanup
    fi

    clear_screen
    draw_header "$(mod_prop "$mod" "TITLE")"
    printf '\n  %s→%s %s\n\n' "$C_CYAN" "$FG_RESET" "${cmd//[[:cntrl:]]/?}"
    printf '  %s%s%s\n' "$C_YELLOW" "$T_NO_WRAPPER" "$FG_RESET"
    printf '\n  %s%s%s\n' "$C_GRAY" "$T_PRESS_KEY" "$FG_RESET"
    _wait_key
    hide_cursor
    LAST_MENU=""
}

# Default entry action (view)
_mod_entry_view() {
    local mod="$1"
    local key="$2"
    local view_fn
    view_fn=$(mod_prop "$mod" "VIEW_FN")
    if [[ -n "$view_fn" ]]; then
        $view_fn "$key"
    else
        generic_view "$mod" "$key"
    fi
}
