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

# -------------------- KEY INPUT -------------------- #

# Result of the last _read_key. One of:
#   UP DOWN LEFT RIGHT HOME END PGUP PGDN DEL    cursor and editing keys
#   ENTER SPACE TAB BACKSPACE ESC                named control keys
#   NONE      the timeout expired with no key
#   EOF       stdin is closed or the terminal went away
#   UNKNOWN   an escape sequence nothing maps (F5, Insert, Alt+x, Ctrl+arrows...)
#   <char>    any other single character, as typed
_KEY=""

# Read one key press and decode it into _KEY. $1 = optional timeout in seconds.
# This is the only key reader: it consumes a whole escape sequence, so a key such
# as Delete ("ESC [ 3 ~") can never leak "3~" into the next read or into a prompt.
_read_key() {
    local c seq="" more n=0
    _KEY=""

    # -N1 (not -n1) keeps Space and Enter: -n1 trims them to an empty string
    IFS= read -rsN1 ${1:+-t "$1"} c
    case $? in
        0) ;;
        1) _KEY="EOF"; return 0 ;;
        *) _KEY="NONE"; return 0 ;;
    esac

    if [[ "$c" == $'\x1b' ]]; then
        # Drain the rest of the sequence: at least 2 bytes, up to a final byte.
        # A bare Esc press yields nothing within the timeout.
        while (( n < 16 )) && IFS= read -rsN1 -t 0.05 more; do
            seq+="$more"
            (( n++ ))
            [[ ${#seq} -ge 2 && "$more" == [@A-Z~a-z^\$] ]] && break
        done
        case "$seq" in
            '')                      _KEY="ESC" ;;
            '[A'|'OA')               _KEY="UP" ;;
            '[B'|'OB')               _KEY="DOWN" ;;
            '[C'|'OC')               _KEY="RIGHT" ;;
            '[D'|'OD')               _KEY="LEFT" ;;
            '[H'|'OH'|'[1~'|'[7~')   _KEY="HOME" ;;
            '[F'|'OF'|'[4~'|'[8~')   _KEY="END" ;;
            '[5~')                   _KEY="PGUP" ;;
            '[6~')                   _KEY="PGDN" ;;
            '[3~')                   _KEY="DEL" ;;
            *)                       _KEY="UNKNOWN" ;;
        esac
        return 0
    fi

    case "$c" in
        $'\n'|$'\r')   _KEY="ENTER" ;;
        ' ')           _KEY="SPACE" ;;
        $'\t')         _KEY="TAB" ;;
        $'\x7f'|$'\b') _KEY="BACKSPACE" ;;
        '')            _KEY="UNKNOWN" ;;     # a NUL byte
        *)             _KEY="$c" ;;
    esac
    return 0
}

# "Press any key" screens. Anything already typed ahead is dropped first, then one
# whole key is read, so the arrow that dismisses a screen is fully consumed and
# can never be replayed as a command on the menu underneath.
_wait_key() {
    while IFS= read -rsN1 -t 0.01 _; do :; done
    _read_key
}

# Run a dialog that hides the cursor. In the TUI the menu's cleanup trap restores
# it; from the CLI (`mn uninstall`, `mn plugin ...`) no trap exists, so Ctrl-C or
# TERM would leave the shell prompt without a cursor. The previous traps are put back.
_with_cursor_guard() {
    local rc old_int old_term
    if [[ -n "$_MN_TUI" ]]; then
        "$@"
        return
    fi
    old_int=$(trap -p INT)
    old_term=$(trap -p TERM)
    trap 'show_cursor; exit 130' INT
    trap 'show_cursor; exit 143' TERM
    "$@"
    rc=$?
    eval "${old_int:-trap - INT}"
    eval "${old_term:-trap - TERM}"
    return $rc
}

# $1 = index preselected: 0 = Confirm, 1 = Cancel (default).
# Destructive actions the user explicitly asked for pass 0, so a bare Enter does
# what was asked instead of silently cancelling with no feedback at all.
# Returns 0 = confirmed, 1 = cancelled (n, q, Esc, end of input, or Cancel + Enter).
# The cursor is restored on every exit path, so callers never have to.
confirm_dialog() { _with_cursor_guard _confirm_dialog "$@"; }
_confirm_dialog() {
    local selected="${1:-1}"
    hide_cursor

    while true; do
        tput el
        if [[ $selected -eq 0 ]]; then
            echo -e "  ${WHITE}[${GREEN}✓${WHITE} $T_CONFIRM]${NC}   ${RED}✗${NC} $T_CANCEL"
        else
            echo -e "   ${GREEN}✓${NC} $T_CONFIRM   ${WHITE}[${RED}✗${WHITE} $T_CANCEL]${NC}"
        fi

        _read_key
        case "$_KEY" in
            LEFT|RIGHT|h|l|TAB) selected=$(( 1 - selected )) ;;
            y|Y|o|O)
                show_cursor
                return 0
                ;;
            n|N|q|Q|ESC|EOF)
                show_cursor
                return 1
                ;;
            ENTER)
                show_cursor
                return $selected
                ;;
        esac
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
            echo -e "   ${label}"
        fi
    done
    tput el
    echo -e "\n${DIM}  $T_FOOTER_BASE  $T_FOOTER_SELECT${NC}"

    while true; do
        # _SELECT_POLL (seconds) lets a caller that traps Ctrl-C into _FORM_INTR
        # notice it without a key press; a timeout then returns NONE.
        _read_key ${_SELECT_POLL:+"$_SELECT_POLL"}
        key="$_KEY"
        if [[ -n "$_FORM_INTR" ]]; then
            show_cursor
            return 1
        fi

        case "$key" in
            NONE)
                continue
                ;;
            UP|k)
                (( selected-- ))
                [[ $selected -lt 0 ]] && selected=$(( count - 1 ))
                ;;
            DOWN|j)
                (( selected++ ))
                [[ $selected -ge $count ]] && selected=0
                ;;
            ENTER)
                _SELECT_VALUE="${items[$selected]%%:::*}"
                _SELECT_INDEX=$selected
                show_cursor
                return 0
                ;;
            q|r|R|ESC|EOF)
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
                echo -e "   ${label}"
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
    local key initial="$1"

    hide_cursor

    tput el
    if [[ "$state" == "1" ]]; then
        echo -e "  ${WHITE}[${GREEN}● ${label_on}${WHITE}]${NC}   ${DIM}○ ${label_off}${NC}"
    else
        echo -e "  ${DIM}○ ${label_on}${NC}   ${WHITE}[${RED}○ ${label_off}${WHITE}]${NC}"
    fi

    while true; do
        _read_key
        case "$_KEY" in
            LEFT|RIGHT|h|l|SPACE) state=$(( 1 - state )) ;;
            ENTER)
                show_cursor
                return "$state"
                ;;
            EOF)
                # End of input: nothing more can be chosen, keep the initial state
                show_cursor
                return "$initial"
                ;;
        esac

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
_CHECKED=()

# Checklist: every row starts unticked, so a bare Enter selects nothing. Each row
# is "$1.." in order; row 0 is the "all" row. Space toggles, "a" flips everything.
# On Enter (rc 0) the state is returned in _CHECKED (one 0/1 per row, same indices
# as the labels) and, for the uninstall screens, in _CHK_* (rows 1 to 4).
# ESC, q, r and end of input cancel (rc 1) and leave _CHECKED empty.
checkbox_select() { _with_cursor_guard _checkbox_select "$@"; }
_checkbox_select() {
    local prompt="$1"
    shift
    local -a labels=("$@")
    local count=${#labels[@]}
    local -a checked=()
    local sel=0 i mark key footer

    _CHECKED=()
    _CHK_CORE=0; _CHK_CONFIG=0; _CHK_DATA=0; _CHK_PLUGINS=0
    for (( i=0; i<count; i++ )); do checked[$i]=0; done

    get_terminal_size
    _fit_row "  $T_UNINSTALL_FOOTER" $(( SCREEN_COLS - 2 ))
    footer="$_FIT"

    hide_cursor
    [[ -n "$prompt" ]] && echo -e "${RED}${prompt}${NC}"
    echo ""

    for (( i=0; i<count; i++ )); do
        tput el
        mark=" "; [[ ${checked[$i]} -eq 1 ]] && mark="✓"
        if [[ $i -eq $sel ]]; then
            echo -e "  ${REVERSE} [${mark}] ${labels[$i]} ${RESET}"
        else
            echo -e "   [${mark}] ${labels[$i]}"
        fi
    done
    tput el
    echo -e "\n${DIM}${footer}${NC}"

    while true; do
        _read_key
        key="$_KEY"

        case "$key" in
            UP|k)
                (( sel-- ))
                [[ $sel -lt 0 ]] && sel=$(( count - 1 ))
                ;;
            DOWN|j)
                (( sel++ ))
                [[ $sel -ge $count ]] && sel=0
                ;;
            SPACE)
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
            ENTER)
                _CHECKED=("${checked[@]}")
                _CHK_CORE=${checked[1]:-0}
                _CHK_CONFIG=${checked[2]:-0}
                _CHK_DATA=${checked[3]:-0}
                _CHK_PLUGINS=${checked[4]:-0}
                show_cursor
                return 0
                ;;
            q|r|R|ESC|EOF)
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
                echo -e "   [${mark}] ${labels[$i]}"
            fi
        done
        tput el
        echo -e "\n${DIM}${footer}${NC}"
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

# One "label  value" detail row, indented by 2. The value is user data: it is
# printed through %s with control characters replaced, never through echo -e, so
# what is shown is exactly what is stored (and cannot move the cursor).
# $3 = label width in columns (default 14), measured with _pad.
ui_kv() {
    local label="$1" value="$2" width="${3:-14}"
    _pad "$label" "$width"
    printf '  %s%s%s %s\n' "$C_WHITE" "$_PAD" "$FG_RESET" "${value//[[:cntrl:]]/?}"
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

# A frame is a list of lines. It is written at once, in a single printf, inside a
# synchronized update: nothing tears and nothing is left half drawn. Every line
# (row 0 included) is cleared before it is drawn, so no stale text survives.
# Each line is placed with an absolute cursor move instead of a newline: nothing
# can scroll the screen, and printf then writes the frame in one piece (bash
# flushes its output at every newline).
_FRAME_LINES=()
_frame_flush() {
    local i n=${#_FRAME_LINES[@]} out
    (( SCREEN_ROWS > 0 && n > SCREEN_ROWS )) && n=$SCREEN_ROWS
    out=$'\e[?2026h'"$_T_REENTER"
    for (( i = 0; i < n; i++ )); do
        out+=$'\e['"$(( i + 1 ))"$';1H'"${_FRAME_LINES[i]}${_T_EL}"
    done
    out+="${_T_ED}"$'\e[?2026l'
    printf '%s' "$out"
}

draw_menu() {
    local title="$1"
    # The size is read at start and after a resize, not on every frame
    if [[ -n "$_MN_RESIZED" ]]; then
        _MN_RESIZED=""
        _menu_page_size
        # A module that lays its columns out from the width builds them again,
        # on the same entry; the others only need the page to follow the cursor
        local prep="MOD_${CURRENT_MENU}_MENU_PREPARE_FN"
        if [[ -n "${!prep:-}" ]]; then
            generic_show_menu "$CURRENT_MENU" "${MENU_ACTIONS[SELECTED_INDEX]##*:::}"
        else
            _menu_sync_page
        fi
    fi
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

    local line
    _FRAME_LINES=("")
    printf -v title '%b' "$title"
    _fit_row "  $title" $(( SCREEN_COLS - 2 ))
    printf -v line '%b%b%s%b' "$CYAN" "$BOLD" "$_FIT" "$RESET"
    _FRAME_LINES+=("$line" "")

    # Optional column header, one non-selectable line owned by the module.
    # Read from CURRENT_MENU on every draw, never from a global a module sets:
    # that is what stops it leaking into the main menu, config or a plugin.
    local header_fn header_line=""
    header_fn=$(mod_prop "$CURRENT_MENU" "HEADER_FN")
    [[ -n "$header_fn" ]] && header_line=$($header_fn)
    if [[ -n "$header_line" ]]; then
        _fit_row "$header_line" $(( SCREEN_COLS - 4 ))
        _FRAME_LINES+=("  $_FIT")
    fi

    # A module status line (the filter) replaces the pagination line so the
    # chrome budget stays at 2 lines either way.
    if [[ -n "$_MENU_STATUS" ]]; then
        _fit_row "$_MENU_STATUS" $(( SCREEN_COLS - 2 ))
        _FRAME_LINES+=("$_FIT" "")
    elif [[ "$USE_PAGINATION" == "true" && $total_pages -gt 1 ]]; then
        printf -v line '%b  %s %d/%d  %s%b' "$DIM" "$T_PAGE_INFO" $((CURRENT_PAGE + 1)) \
            "$total_pages" "$T_PAGE_CHANGE" "$NC"
        _FRAME_LINES+=("$line" "")
    fi

    local idx=0
    for item in "${MENU_ITEMS[@]}"; do
        if [[ $idx -ge $start_idx && $idx -lt $end_idx ]]; then
            _fit_row "$item" $(( SCREEN_COLS - 4 ))
            if [[ $idx -eq $SELECTED_INDEX ]]; then
                # Any reset inside the row (module or plugin colours) would end the
                # reverse video of the bar: re-apply it after every reset.
                _FIT=${_FIT//$'\e[0;'/$'\e[0;7;'}
                _FIT=${_FIT//$'\e[0m'/$'\e[0;7m'}
                _FIT=${_FIT//$'\e[m'/$'\e[0;7m'}
                printf -v line '  %b%s %b' "$REVERSE" "$_FIT" "$RESET"
            else
                line="  $_FIT"
            fi
            _FRAME_LINES+=("$line")
        fi
        ((idx++))
    done

    # An empty menu (no docs yet, no record) says so instead of showing nothing
    if (( total_items == 0 )); then
        printf -v line '  %b%s%b' "$DIM" "$T_MENU_EMPTY" "$NC"
        _FRAME_LINES+=("$line")
    fi

    # The footer is two lines by convention: a blank (or detail) line, then the hints
    local footer fl
    footer=$(draw_footer)
    if [[ -n "$footer" ]]; then
        while IFS= read -r fl; do _FRAME_LINES+=("$fl"); done <<< "$footer"
    fi

    _frame_flush
}

# The resize signal arrives while mn waits for a key. The handler only raises a
# flag: it can run inside a timed read, and a handler that draws for longer than the
# read timeout lets the alarm fire inside it, which aborts bash. The size is re-read
# on the next frame; if the menu is idle, the wait loop draws that frame at once.
_MN_RESIZED=""
_MN_IDLE=""
_MN_STOP=""
_tui_winch() { _MN_RESIZED=1; }
_tui_stop() { _MN_STOP=1; }

# Draw the current menu from the wait loop, only while it waits for a key:
# anywhere else (a wizard, a detail screen) the next screen draws itself.
_tui_redraw() {
    [[ -n "$_MN_IDLE" ]] || return 0
    local title
    title=$(get_menu_title "$CURRENT_MENU")
    draw_menu "$title"
}

handle_input() {
    local key

    # A trapped signal (resize, Ctrl-Z) only runs when a builtin returns, so the
    # key is awaited in short slices. Ctrl-Z is handled during this wait alone. Outside
    # it, mn ignores it (a stop would leave the terminal in raw mode); a child that
    # owns the terminal gets the default back, or it would stop with mn waiting for it.
    _MN_IDLE=1
    _MN_STOP=""
    trap '_tui_stop' TSTP
    while :; do
        _read_key 0.5
        [[ "$_KEY" != "NONE" ]] && break
        [[ -n "$_MN_STOP" ]] && { _MN_STOP=""; _tui_suspend; }
        [[ -n "$_MN_RESIZED" ]] && _tui_redraw
    done
    trap '' TSTP
    _MN_IDLE=""
    key="$_KEY"

    # End of input means the terminal went away: leave instead of looping
    [[ "$key" == "EOF" ]] && quit_menu

    # Keys the engine has no use for are dropped here, so that a module hook
    # (KEYS_FN) only ever sees real characters
    case "$key" in
        NONE|UNKNOWN|SPACE|TAB|BACKSPACE|DEL) return 0 ;;
    esac

    local total_items=${#MENU_ITEMS[@]}
    local total_pages=1
    if [[ "$USE_PAGINATION" == "true" && $total_items -gt $ITEMS_PER_PAGE ]]; then
        total_pages=$(( (total_items + ITEMS_PER_PAGE - 1) / ITEMS_PER_PAGE ))
    fi

    # Nothing to move on or act on in an empty menu: the cursor would go to -1 and
    # Enter would index the arrays with it. q, r and Esc still work, and so does a
    # module hotkey (the connexions filter can leave a menu with no row at all).
    if (( total_items == 0 )); then
        case "$key" in
            UP|k|DOWN|j|LEFT|PGUP|'<'|','|RIGHT|PGDN|'>'|'.'|ENTER|e|E|d|D|v|V) return 0 ;;
        esac
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
        LEFT|PGUP|'<'|',')
            if [[ "$USE_PAGINATION" == "true" && $CURRENT_PAGE -gt 0 ]]; then
                ((CURRENT_PAGE--))
                SELECTED_INDEX=$(( CURRENT_PAGE * ITEMS_PER_PAGE ))
                LAST_MENU=""
            fi
            ;;
        RIGHT|PGDN|'>'|'.')
            if [[ "$USE_PAGINATION" == "true" && $CURRENT_PAGE -lt $((total_pages - 1)) ]]; then
                ((CURRENT_PAGE++))
                SELECTED_INDEX=$(( CURRENT_PAGE * ITEMS_PER_PAGE ))
                LAST_MENU=""
            fi
            ;;
        HOME)
            (( total_items > 0 )) || return 0
            SELECTED_INDEX=0
            CURRENT_PAGE=0
            [[ "$USE_PAGINATION" == "true" && $total_pages -gt 1 ]] && LAST_MENU=""
            ;;
        END)
            (( total_items > 0 )) || return 0
            SELECTED_INDEX=$((total_items - 1))
            if [[ "$USE_PAGINATION" == "true" && $total_pages -gt 1 ]]; then
                CURRENT_PAGE=$((total_pages - 1))
                LAST_MENU=""
            fi
            ;;
        ENTER)
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
        r|R|ESC)
            if [[ "$CURRENT_MENU" != "main" ]]; then
                SELECTED_INDEX=0; CURRENT_PAGE=0; show_main_menu
            fi
            ;;
        *)
            # Single characters only: any other name is a key the engine ignores
            (( ${#key} == 1 )) && _menu_key "$key"
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

        # Only dispatch what is a function: a malformed action must never run as
        # a command found in PATH
        declare -F "$cmd" >/dev/null || return 0
        $cmd "${PARAMS[@]}"
    else
        declare -F "$action" >/dev/null || return 0
        $action
    fi
}

execute_quick_action() {
    local quick_action="$1"
    local action="${MENU_ACTIONS[$SELECTED_INDEX]:-}"

    # e, d and v are record actions: only a crud menu has records. On Docs, a
    # plugin menu or the main menu they used to run generic_edit on a module
    # without a FILE (awk on the tty, a stray .XXXXXX file, a wiped screen).
    [[ "$(mod_prop "$CURRENT_MENU" "TYPE")" == "crud" ]] || return 0
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

# A TUI needs a real terminal. Without a tty every read fails at once, so a
# loop that does not stop on EOF would spin at 100% CPU. CLI paths are unaffected.
_require_tty() {
    [[ -t 0 ]] && return 0
    printf '%b%s%b\n' "$RED" "$T_ERR_NO_TTY" "$NC" >&2
    exit 1
}

# Take the terminal over: alternate screen, hidden cursor, and the handlers that
# give it back on every way out (quit, Ctrl-C, TERM, a crash, Ctrl-Z).
_tui_enter() {
    _tui_caps
    _MN_TUI=1
    get_terminal_size
    _tui_screen
    trap 'cleanup' INT TERM
    trap '_tui_restore' EXIT
    trap '_tui_winch' WINCH
    trap '' TSTP
}

# Ctrl-Z: give the terminal back, stop for real, and take it over again on fg.
# The handler is removed first so the re-sent TSTP cannot loop back into it. The
# key reader was interrupted in raw mode: the shell resumes the job with its own
# terminal modes, so the ones in force when the signal came are put back by hand.
_tui_suspend() {
    local modes
    modes=$(stty -g 2>/dev/null)
    _tui_restore
    trap - TSTP
    kill -TSTP $$
    [[ -n "$modes" ]] && stty "$modes" 2>/dev/null
    _tui_screen
    trap '_tui_stop' TSTP
    _MN_RESIZED=1
    LAST_MENU=""
    _tui_redraw
}

# Run a program that owns the terminal (less, an editor, ssh) outside the
# alternate screen. Ctrl-C reaches the whole foreground group: it is ignored by mn
# for the duration, so it only stops the program and never falls into cleanup.
# The exit status of the program is returned.
_run_external() {
    local rc old_int
    if [[ -z "$_MN_TUI" ]]; then
        "$@"
        return
    fi
    old_int=$(trap -p INT)
    _tui_restore
    trap : INT
    trap - TSTP
    "$@"
    rc=$?
    trap '' TSTP
    eval "${old_int:-trap - INT}"
    _tui_screen
    LAST_MENU=""
    return $rc
}

# One-line message on the last screen row, never below the footer. In the TUI it
# stays 1.5 s and the next frame wipes it; from the CLI it goes to stderr.
ui_flash() {
    local msg="${1//[[:cntrl:]]/?}"
    if [[ -z "$_MN_TUI" ]]; then
        printf '%b✗ %s%b\n' "$RED" "$msg" "$NC" >&2
        return 0
    fi
    (( SCREEN_ROWS > 0 )) || get_terminal_size
    (( SCREEN_COLS < 20 )) && SCREEN_COLS=80
    _fit_row "  ✗ $msg" $(( SCREEN_COLS - 2 ))
    printf '\e[%d;1H%b%s%b%s' "$SCREEN_ROWS" "$RED" "$_FIT" "$NC" "$_T_EL"
    sleep 1.5
    LAST_MENU=""
}

cleanup() {
    _tui_restore
    exit 0
}

quit_menu() {
    cleanup
}

# Main loop
main_loop() {
    _require_tty
    _tui_enter

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
    _tui_enter
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
