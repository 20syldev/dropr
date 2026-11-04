#!/bin/bash
# =========================================================
# MN - UI: header, footer, menu engine, input
# =========================================================

draw_header() {
    local title="$1"
    get_terminal_size

    echo -e "${CYAN}${BOLD}"
    echo -e "  $title"
    echo -e "${RESET}"
}

# $1 = index preselected: 0 = Confirm, 1 = Cancel (default).
# Destructive actions the user explicitly asked for pass 0, so a bare Enter does
# what was asked instead of silently cancelling with no feedback at all.
confirm_dialog() {
    local selected="${1:-1}"
    hide_cursor

    while true; do
        tput el
        if [[ $selected -eq 0 ]]; then
            echo -e "  ${WHITE}[${GREEN}✓${WHITE} $T_CONFIRM]${NC}   ${RED}✗${NC} $T_CANCEL"
        else
            echo -e "   ${GREEN}✓${NC} $T_CONFIRM   ${WHITE}[${RED}✗${WHITE} $T_CANCEL]${NC}"
        fi

        read -rsn1 key
        if [[ "$key" == $'\x1b' ]]; then
            read -rsn2 -t 0.1 key
            case "$key" in
                '[C'|'[D') selected=$(( 1 - selected )) ;;
            esac
        else
            case "$key" in
                h|l) selected=$(( 1 - selected )) ;;
                ''|$'\n')
                    show_cursor
                    return $selected
                    ;;
            esac
        fi
        tput cuu1
    done
}

_SELECT_VALUE=""
_SELECT_INDEX=0

select_option() {
    local prompt="$1"
    shift
    local -a items=("$@")
    local count=${#items[@]}
    local selected="${_SELECT_INDEX:-0}"
    local i label key

    [[ $count -eq 0 ]] && return 1
    (( selected >= count )) && selected=0

    hide_cursor
    [[ -n "$prompt" ]] && echo -e "${CYAN}${prompt}${NC}"

    for (( i=0; i<count; i++ )); do
        tput el
        label="${items[$i]#*:::}"
        if [[ $i -eq $selected ]]; then
            echo -e "  ${REVERSE} ${label} ${RESET}"
        else
            echo -e "    ${label}"
        fi
    done
    tput el
    echo -e "\n${DIM}  $T_FOOTER_BASE  $T_FOOTER_SELECT${NC}"

    while true; do
        read -rsn1 key
        if [[ "$key" == $'\x1b' ]]; then
            read -rsn2 -t 0.1 key
            case "$key" in
                '[A') key="UP" ;;
                '[B') key="DOWN" ;;
                *) key="ESC" ;;
            esac
        fi

        case "$key" in
            UP|k)
                (( selected-- ))
                [[ $selected -lt 0 ]] && selected=$(( count - 1 ))
                ;;
            DOWN|j)
                (( selected++ ))
                [[ $selected -ge $count ]] && selected=0
                ;;
            ''|$'\n')
                _SELECT_VALUE="${items[$selected]%%:::*}"
                _SELECT_INDEX=$selected
                show_cursor
                return 0
                ;;
            q|r|R|ESC)
                show_cursor
                return 1
                ;;
        esac

        for (( i=0; i<count+2; i++ )); do
            tput cuu1
        done
        for (( i=0; i<count; i++ )); do
            tput el
            label="${items[$i]#*:::}"
            if [[ $i -eq $selected ]]; then
                echo -e "  ${REVERSE} ${label} ${RESET}"
            else
                echo -e "    ${label}"
            fi
        done
        tput el
        echo -e "\n${DIM}  $T_FOOTER_BASE  $T_FOOTER_SELECT${NC}"
    done
}

toggle_switch() {
    local state="$1"
    local label_on="$2"
    local label_off="$3"
    local key

    hide_cursor

    tput el
    if [[ "$state" == "1" ]]; then
        echo -e "  ${WHITE}[${GREEN}● ${label_on}${WHITE}]${NC}   ${DIM}○ ${label_off}${NC}"
    else
        echo -e "  ${DIM}○ ${label_on}${NC}   ${WHITE}[${RED}○ ${label_off}${WHITE}]${NC}"
    fi

    while true; do
        read -rsn1 key
        if [[ "$key" == $'\x1b' ]]; then
            read -rsn2 -t 0.1 key
            case "$key" in
                '[C'|'[D') state=$(( 1 - state )) ;;
            esac
        else
            case "$key" in
                h|l|' ') state=$(( 1 - state )) ;;
                ''|$'\n')
                    show_cursor
                    return "$state"
                    ;;
            esac
        fi

        tput cuu1
        tput el
        if [[ "$state" == "1" ]]; then
            echo -e "  ${WHITE}[${GREEN}● ${label_on}${WHITE}]${NC}   ${DIM}○ ${label_off}${NC}"
        else
            echo -e "  ${DIM}○ ${label_on}${NC}   ${WHITE}[${RED}○ ${label_off}${WHITE}]${NC}"
        fi
    done
}

_CHK_CORE=0
_CHK_CONFIG=0
_CHK_DATA=0
_CHK_PLUGINS=0

checkbox_select() {
    local prompt="$1"
    shift
    local -a labels=("$@")
    local count=${#labels[@]}
    local -a checked=()
    local sel=0 i mark key

    for (( i=0; i<count; i++ )); do checked[$i]=0; done
    [[ $count -gt 1 ]] && checked[1]=1

    hide_cursor
    [[ -n "$prompt" ]] && echo -e "${RED}${prompt}${NC}"
    echo ""

    for (( i=0; i<count; i++ )); do
        tput el
        mark=" "; [[ ${checked[$i]} -eq 1 ]] && mark="✓"
        if [[ $i -eq $sel ]]; then
            echo -e "  ${REVERSE} [${mark}] ${labels[$i]} ${RESET}"
        else
            echo -e "    [${mark}] ${labels[$i]}"
        fi
    done
    tput el
    echo -e "\n${DIM}  $T_UNINSTALL_FOOTER${NC}"

    while true; do
        read -rsn1 key
        if [[ "$key" == $'\x1b' ]]; then
            read -rsn2 -t 0.1 key
            case "$key" in
                '[A') key="UP" ;;
                '[B') key="DOWN" ;;
                *) key="ESC" ;;
            esac
        fi

        case "$key" in
            UP|k)
                (( sel-- ))
                [[ $sel -lt 0 ]] && sel=$(( count - 1 ))
                ;;
            DOWN|j)
                (( sel++ ))
                [[ $sel -ge $count ]] && sel=0
                ;;
            ' ')
                checked[$sel]=$(( 1 - ${checked[$sel]} ))
                if [[ $sel -eq 0 ]]; then
                    local val=${checked[0]}
                    for (( i=1; i<count; i++ )); do checked[$i]=$val; done
                else
                    [[ ${checked[$sel]} -eq 0 ]] && checked[0]=0
                    local all=1
                    for (( i=1; i<count; i++ )); do
                        [[ ${checked[$i]} -eq 0 ]] && all=0
                    done
                    checked[0]=$all
                fi
                ;;
            a)
                local new_val=$(( 1 - ${checked[0]} ))
                for (( i=0; i<count; i++ )); do checked[$i]=$new_val; done
                ;;
            ''|$'\n')
                _CHK_CORE=${checked[1]}
                _CHK_CONFIG=${checked[2]}
                _CHK_DATA=${checked[3]}
                _CHK_PLUGINS=${checked[4]}
                show_cursor
                return 0
                ;;
            q|r|R|ESC)
                show_cursor
                return 1
                ;;
        esac

        for (( i=0; i<count+2; i++ )); do tput cuu1; done
        for (( i=0; i<count; i++ )); do
            tput el
            mark=" "; [[ ${checked[$i]} -eq 1 ]] && mark="✓"
            if [[ $i -eq $sel ]]; then
                echo -e "  ${REVERSE} [${mark}] ${labels[$i]} ${RESET}"
            else
                echo -e "    [${mark}] ${labels[$i]}"
            fi
        done
        tput el
        echo -e "\n${DIM}  $T_UNINSTALL_FOOTER${NC}"
    done
}

# -------------------- DISPLAY WIDTH -------------------- #

_VISLEN=0
_PAD=""
_TRUNC=""

# Visible width of a string: ANSI stripped, characters not bytes. No fork.
_vislen() {
    local s="$1" out=""
    while [[ "$s" == *$'\033['* ]]; do
        out+="${s%%$'\033['*}"
        s="${s#*$'\033['}"
        s="${s#*m}"
    done
    out+="$s"
    _VISLEN=${#out}
}

# Right-pad to $2 visible columns. Never use printf %-Ns on coloured or UTF-8
# text: %*s here applies to an EMPTY string, so bytes and columns cannot diverge.
_pad() {
    _vislen "$1"
    if (( _VISLEN >= $2 )); then
        _PAD="$1"
    else
        printf -v _PAD '%s%*s' "$1" $(( $2 - _VISLEN )) ''
    fi
}

# Truncate to $2 visible columns with an ellipsis.
# Only safe on plain text: colour must be applied AFTER truncating.
_trunc() {
    if (( $2 < 1 )); then
        _TRUNC=""
        return
    fi
    _vislen "$1"
    if (( _VISLEN <= $2 )); then
        _TRUNC="$1"
    else
        _TRUNC="${1:0:$(( $2 - 1 ))}…"
    fi
}

# Make a row safe to print on exactly ONE terminal line.
# Control characters coming from user data (an alias whose command holds a \n)
# would otherwise desync draw_menu's line accounting: it would clear and redraw
# the wrong rows, leaving stale text on screen. Over-long rows wrap, with the
# same effect, so the row is also fitted to the available width.
# ANSI sequences are copied verbatim and cost no width.
_FIT=""
_fit_row() {
    local s="$1" max="$2" out="" seg n=0
    s="${s//$'\n'/ }"
    s="${s//$'\t'/ }"
    s="${s//$'\r'/}"
    if (( max < 1 )); then _FIT=""; return; fi
    _vislen "$s"
    if (( _VISLEN <= max )); then _FIT="$s"; return; fi
    (( max-- ))
    while [[ -n "$s" ]]; do
        if [[ "$s" == $'\033['* ]]; then
            if [[ "$s" == *m* ]]; then
                seg="${s%%m*}m"
                out+="$seg"
                s="${s#"$seg"}"
                continue
            fi
            out+="$s"
            break
        fi
        (( n >= max )) && break
        out+="${s:0:1}"
        s="${s:1}"
        (( n++ ))
    done
    _FIT="${out}…${FG_RESET}"
}

# -------------------- MENU HELPERS -------------------- #

# Derive the current page from the cursor
_menu_sync_page() {
    CURRENT_PAGE=0
    [[ "$USE_PAGINATION" == "true" ]] || return 0
    (( ITEMS_PER_PAGE > 0 )) || return 0
    CURRENT_PAGE=$(( SELECTED_INDEX / ITEMS_PER_PAGE ))
}

# Key of the selected entry. rc 1 on the "[+] Add" row or an empty menu.
_menu_current_key() {
    local action="${MENU_ACTIONS[$SELECTED_INDEX]:-}"
    [[ -z "$action" || "$action" == generic_add* ]] && return 1
    printf '%s' "${action##*:::}"
}

# Dispatch a key the engine does not handle: the module's KEYS_FN first, then the
# [X] hotkeys of PLAN-HOTKEYS if that plan has shipped. declare -F makes the two
# plans independent of each other's delivery order.
_menu_key() {
    local key="$1" keys_fn
    keys_fn=$(mod_prop "$CURRENT_MENU" "KEYS_FN")
    if [[ -n "$keys_fn" ]] && $keys_fn "$key"; then
        return 0
    fi
    declare -F _try_hotkey >/dev/null && _try_hotkey "$key" && return 0
    return 1
}

draw_footer() {
    local footer_fn
    footer_fn=$(mod_prop "$CURRENT_MENU" "FOOTER_FN")
    if [[ -n "$footer_fn" ]]; then
        $footer_fn
        return
    fi

    local mod_type
    mod_type=$(mod_prop "$CURRENT_MENU" "TYPE")

    local base
    [[ "$CURRENT_MENU" == "main" ]] && base="$T_FOOTER_QUIT" || base="$T_FOOTER_BASE"

    local hint row
    if [[ "$mod_type" == "crud" ]]; then
        if [[ $SELECTED_INDEX -gt 0 ]]; then hint="$T_FOOTER_CRUD"; else hint="$T_FOOTER_ADD"; fi
    else
        hint="$T_FOOTER_SELECT"
    fi
    printf -v row '%b  %s  %s%b' "$DIM" "$base" "$hint" "$NC"
    _fit_row "$row" $(( SCREEN_COLS - 2 ))
    printf '\n%s\n' "$_FIT"
}

draw_menu() {
    local title="$1"
    get_terminal_size
    (( SCREEN_COLS < 20 )) && SCREEN_COLS=80
    local total_items=${#MENU_ITEMS[@]}
    local start_idx=0
    local end_idx=$total_items
    local total_pages=1

    if [[ "$USE_PAGINATION" == "true" && $total_items -gt $ITEMS_PER_PAGE ]]; then
        total_pages=$(( (total_items + ITEMS_PER_PAGE - 1) / ITEMS_PER_PAGE ))
        start_idx=$(( CURRENT_PAGE * ITEMS_PER_PAGE ))
        end_idx=$(( start_idx + ITEMS_PER_PAGE ))
        [[ $end_idx -gt $total_items ]] && end_idx=$total_items
    fi

    tput cup 0 0

    echo -e "${CYAN}${BOLD}"
    tput el
    echo -e "  $title"
    tput el
    echo -e "${RESET}"

    # Optional column header, one non-selectable line owned by the module.
    # Read from CURRENT_MENU on every draw, never from a global a module sets:
    # that is what stops it leaking into the main menu, config or a plugin.
    local header_fn header_line=""
    header_fn=$(mod_prop "$CURRENT_MENU" "HEADER_FN")
    [[ -n "$header_fn" ]] && header_line=$($header_fn)
    if [[ -n "$header_line" ]]; then
        tput el
        _fit_row "$header_line" $(( SCREEN_COLS - 4 ))
        printf '  %s\n' "$_FIT"
    fi

    # A module status line (the filter) replaces the pagination line so the
    # chrome budget stays at 2 lines either way.
    if [[ -n "$_MENU_STATUS" ]]; then
        tput el
        printf '%s\n' "$_MENU_STATUS"
        tput el
        echo ""
    elif [[ "$USE_PAGINATION" == "true" && $total_pages -gt 1 ]]; then
        tput el
        echo -e "${DIM}  $T_PAGE_INFO $((CURRENT_PAGE + 1))/$total_pages  $T_PAGE_CHANGE${NC}"
        tput el
        echo ""
    fi

    local idx=0
    for item in "${MENU_ITEMS[@]}"; do
        if [[ $idx -ge $start_idx && $idx -lt $end_idx ]]; then
            tput el
            _fit_row "$item" $(( SCREEN_COLS - 4 ))
            if [[ $idx -eq $SELECTED_INDEX ]]; then
                printf '  %b%s %b\n' "$REVERSE" "$_FIT" "$RESET"
            else
                printf '  %s\n' "$_FIT"
            fi
        fi
        ((idx++))
    done

    tput ed
    draw_footer
}

handle_input() {
    local key

    # A failed read means the terminal went away: leave instead of looping
    read -rsn1 key || quit_menu

    if [[ "$key" == $'\x1b' ]]; then
        read -rsn2 -t 0.1 key
        case "$key" in
            '[A') key="UP" ;;
            '[B') key="DOWN" ;;
            '[C') key="RIGHT" ;;
            '[D') key="LEFT" ;;
            *) return ;;
        esac
    fi

    local total_items=${#MENU_ITEMS[@]}
    local total_pages=1
    if [[ "$USE_PAGINATION" == "true" && $total_items -gt $ITEMS_PER_PAGE ]]; then
        total_pages=$(( (total_items + ITEMS_PER_PAGE - 1) / ITEMS_PER_PAGE ))
    fi

    case "$key" in
        UP|k)
            ((SELECTED_INDEX--))
            if [[ $SELECTED_INDEX -lt 0 ]]; then
                SELECTED_INDEX=$((total_items - 1))
                if [[ "$USE_PAGINATION" == "true" && $total_pages -gt 1 ]]; then
                    CURRENT_PAGE=$((total_pages - 1))
                    LAST_MENU=""
                fi
            elif [[ "$USE_PAGINATION" == "true" && $total_pages -gt 1 ]]; then
                local page_start=$(( CURRENT_PAGE * ITEMS_PER_PAGE ))
                if [[ $SELECTED_INDEX -lt $page_start ]]; then
                    ((CURRENT_PAGE--))
                    LAST_MENU=""
                fi
            fi
            ;;
        DOWN|j)
            ((SELECTED_INDEX++))
            if [[ $SELECTED_INDEX -ge $total_items ]]; then
                SELECTED_INDEX=0
                CURRENT_PAGE=0
                if [[ "$USE_PAGINATION" == "true" && $total_pages -gt 1 ]]; then
                    LAST_MENU=""
                fi
            elif [[ "$USE_PAGINATION" == "true" && $total_pages -gt 1 ]]; then
                local page_end=$(( (CURRENT_PAGE + 1) * ITEMS_PER_PAGE ))
                if [[ $SELECTED_INDEX -ge $page_end ]]; then
                    ((CURRENT_PAGE++))
                    LAST_MENU=""
                fi
            fi
            ;;
        LEFT|'<'|',')
            if [[ "$USE_PAGINATION" == "true" && $CURRENT_PAGE -gt 0 ]]; then
                ((CURRENT_PAGE--))
                SELECTED_INDEX=$(( CURRENT_PAGE * ITEMS_PER_PAGE ))
                LAST_MENU=""
            fi
            ;;
        RIGHT|'>'|'.')
            if [[ "$USE_PAGINATION" == "true" && $CURRENT_PAGE -lt $((total_pages - 1)) ]]; then
                ((CURRENT_PAGE++))
                SELECTED_INDEX=$(( CURRENT_PAGE * ITEMS_PER_PAGE ))
                LAST_MENU=""
            fi
            ;;
        ''|$'\n')
            execute_action
            ;;
        e|E)
            execute_quick_action "edit"
            ;;
        d|D)
            execute_quick_action "delete"
            ;;
        v|V)
            execute_quick_action "view"
            ;;
        q|Q)
            quit_menu
            ;;
        r|R)
            if [[ "$CURRENT_MENU" != "main" ]]; then
                SELECTED_INDEX=0; CURRENT_PAGE=0; show_main_menu
            fi
            ;;
        *)
            _menu_key "$key"
            ;;
    esac
}

execute_action() {
    local action="${MENU_ACTIONS[$SELECTED_INDEX]:-}"
    [[ -z "$action" ]] && return

    if [[ "$action" == *":::"* ]]; then
        local cmd="${action%%:::*}"
        local params="${action#*:::}"

        local -a PARAMS=()
        while [[ "$params" == *":::"* ]]; do
            PARAMS+=("${params%%:::*}")
            params="${params#*:::}"
        done
        PARAMS+=("$params")

        $cmd "${PARAMS[@]}"
    else
        $action
    fi
}

execute_quick_action() {
    local quick_action="$1"
    local action="${MENU_ACTIONS[$SELECTED_INDEX]:-}"

    [[ -z "$action" ]] && return
    [[ "$action" == generic_add* ]] && return

    if [[ "$action" == *":::"* ]]; then
        local params="${action#*:::}"
        local name
        while [[ "$params" == *":::"* ]]; do
            params="${params#*:::}"
        done
        name="$params"

        case "$quick_action" in
            edit)
                local edit_fn
                edit_fn=$(mod_prop "$CURRENT_MENU" "EDIT_FN")
                if [[ -n "$edit_fn" ]]; then
                    $edit_fn "$name"
                else
                    generic_edit "$CURRENT_MENU" "$name"
                fi
                ;;
            delete)
                generic_delete "$CURRENT_MENU" "$name"
                ;;
            view)
                local view_fn
                view_fn=$(mod_prop "$CURRENT_MENU" "VIEW_FN")
                if [[ -n "$view_fn" ]]; then
                    $view_fn "$name"
                else
                    generic_view "$CURRENT_MENU" "$name"
                fi
                ;;
        esac
    fi

    LAST_MENU=""
}

# A TUI needs a real terminal. Without this guard `read -rsn1` returns an empty
# key on every EOF, which the keymap treats as Enter: mn spins at 100% CPU and
# fires the selected action over and over. CLI paths are unaffected.
_require_tty() {
    [[ -t 0 ]] && return 0
    printf '%b%s%b\n' "$RED" "$T_ERR_NO_TTY" "$NC" >&2
    exit 1
}

cleanup() {
    show_cursor
    tput cnorm
    clear_screen
    exit 0
}

quit_menu() {
    cleanup
}

# Main loop
main_loop() {
    _require_tty
    hide_cursor
    trap 'cleanup' INT TERM EXIT
    tput clear

    show_main_menu
    draw_menu "$T_MENU_TITLE" "true"
    LAST_MENU="main"

    while true; do
        handle_input

        local redraw_mode="false"
        if [[ "$CURRENT_MENU" != "$LAST_MENU" ]]; then
            redraw_mode="true"
            LAST_MENU="$CURRENT_MENU"
        fi

        local title
        title=$(get_menu_title "$CURRENT_MENU")
        draw_menu "$title" "$redraw_mode"
    done
}

# Launch a submenu directly
_run_submenu() {
    _require_tty
    local mod="$1"
    local title
    title=$(mod_prop "$mod" "TITLE")
    hide_cursor
    trap 'cleanup' INT TERM EXIT
    generic_show_menu "$mod"
    LAST_MENU="$mod"
    draw_menu "$title" "true"
    while true; do
        handle_input
        local redraw="false"
        [[ -z "$LAST_MENU" ]] && redraw="true" && LAST_MENU="$mod"
        title=$(get_menu_title "$CURRENT_MENU")
        draw_menu "$title" "$redraw"
    done
}
