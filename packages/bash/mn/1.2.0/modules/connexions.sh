#!/bin/bash
# =========================================================
# MN - Module: SSH / Custom connections
# =========================================================

# -------------------- SCHEMA -------------------- #

MOD_connexions_FILE="$CONNEXIONS_FILE"
MOD_connexions_TITLE="$T_CONN_TITLE"
MOD_connexions_TITLE_ADD="$T_CONN_TITLE_ADD"
MOD_connexions_NOUN="$T_CONN_NOUN"
MOD_connexions_ADD_LABEL="$T_CONN_ADD_LABEL"
MOD_connexions_FIELDS="name via target user aliases ip desc"
MOD_connexions_PAGINATION="true"
MOD_connexions_REGEN="false"
MOD_connexions_TYPE="crud"
MOD_connexions_MENU_LABEL="$T_MENU_CONNEXIONS"
MOD_connexions_PRIORITY=10
MOD_connexions_CLI_ARGS="connexions|conn|co"
MOD_connexions_DAT_HEADER="# Format: name:::via:::target:::user:::aliases:::ip:::desc"
MOD_connexions_MENU_FORMAT_FN="_connexions_menu_format"
MOD_connexions_ENTRY_ACTION="connexions_connect"

# --- engine hooks, all optional, all generic ---
MOD_connexions_MENU_PREPARE_FN="_connexions_menu_prepare"
MOD_connexions_HEADER_FN="_connexions_header"
MOD_connexions_FOOTER_FN="_connexions_footer"
MOD_connexions_KEYS_FN="_connexions_keys"
MOD_connexions_NORMALIZE_FN="_connexions_normalize"
MOD_connexions_CLI_FN="connexions_cli"
MOD_connexions_VIEW_FN="_connexions_view"

# --- fields ---
MOD_connexions_FIELD_LABEL_name="$T_CONN_F_NAME"
MOD_connexions_FIELD_HINT_name="$T_CONN_H_NAME"
MOD_connexions_FIELD_REQUIRED_name="yes"
MOD_connexions_FIELD_TYPE_name="text"
MOD_connexions_FIELD_VALIDATE_FN_name="_conn_v_name"

MOD_connexions_FIELD_LABEL_via="$T_CONN_F_VIA"
MOD_connexions_FIELD_HINT_via="$T_CONN_H_VIA"
MOD_connexions_FIELD_REQUIRED_via="no"
MOD_connexions_FIELD_TYPE_via="text"
MOD_connexions_FIELD_DEFAULT_FN_via="_conn_d_via"
MOD_connexions_FIELD_VALIDATE_FN_via="_conn_v_via"

MOD_connexions_FIELD_LABEL_target="$T_CONN_F_TARGET"
MOD_connexions_FIELD_HINT_target="$T_CONN_H_TARGET"
MOD_connexions_FIELD_REQUIRED_target="no"
MOD_connexions_FIELD_TYPE_target="text"
MOD_connexions_FIELD_DEFAULT_FN_target="_conn_d_target"
MOD_connexions_FIELD_VALIDATE_FN_target="_conn_v_target"

MOD_connexions_FIELD_LABEL_user="$T_CONN_F_USER"
MOD_connexions_FIELD_HINT_user="$T_CONN_H_USER"
MOD_connexions_FIELD_REQUIRED_user="no"
MOD_connexions_FIELD_TYPE_user="text"
MOD_connexions_FIELD_VALIDATE_FN_user="_conn_v_user"

MOD_connexions_FIELD_LABEL_aliases="$T_CONN_F_ALIASES"
MOD_connexions_FIELD_HINT_aliases="$T_CONN_H_ALIASES"
MOD_connexions_FIELD_REQUIRED_aliases="no"
MOD_connexions_FIELD_TYPE_aliases="text"
MOD_connexions_FIELD_VALIDATE_FN_aliases="_conn_v_aliases"

MOD_connexions_FIELD_LABEL_ip="$T_CONN_F_IP"
MOD_connexions_FIELD_HINT_ip="$T_CONN_H_IP"
MOD_connexions_FIELD_REQUIRED_ip="no"
MOD_connexions_FIELD_TYPE_ip="text"
MOD_connexions_FIELD_DEFAULT_FN_ip="_conn_d_ip"

MOD_connexions_FIELD_LABEL_desc="$T_CONN_F_DESC"
MOD_connexions_FIELD_REQUIRED_desc="no"
MOD_connexions_FIELD_TYPE_desc="text"

# -------------------- LAYOUT -------------------- #

# Menu-safe additive colours: no "0;" reset, which would kill the reverse video
# of the selection bar. Real escape bytes, measured by _vislen as zero-width.
C_ALIAS=$'\033[36m'
C_NAME=$'\033[97m'
C_META=$'\033[90m'
C_XE=$'\033[33m'
C_SSH=$'\033[34m'
C_OTHER=$'\033[35m'
C_WARN=$'\033[33m'

_CONN_WA=0; _CONN_WN=0; _CONN_WI=0; _CONN_WV=0; _CONN_WU=0; _CONN_WD=0
_CONN_MODE="full"
_CONN_HDR=""
_CONN_COUNT=0
_CONN_FILTER=""
_CONN_EXACT=0
_CONN_OVERRIDE_KEY=""
_CONN_OVERRIDE_USER=""
_CONN_BADGE=""

# Shortest handle of name + aliases, ties broken alphabetically.
# Empty when the name itself is the shortest. Result in _CONN_BADGE, no fork.
# NOTE: `best` is assigned on its own line — in a single `local a=$1 b=$a`, every
# right-hand side is expanded before any assignment happens, so `b` would be empty.
_conn_badge() {
    local name="$1" csv="$2" a
    local best="$name"
    local IFS=','
    for a in $csv; do
        [[ -z "$a" ]] && continue
        if (( ${#a} < ${#best} )) || { (( ${#a} == ${#best} )) && [[ "$a" < "$best" ]]; }; then
            best="$a"
        fi
    done
    [[ "$best" == "$name" ]] && best=""
    _CONN_BADGE="$best"
}

# The verb actually executed: first word of `via`, "ssh" when empty.
_conn_verb() {
    local v="${1:-ssh}"
    v="${v%% *}"
    printf '%s' "${v:-ssh}"
}

# Freeze the column widths on the FULL set. Never recompute on a filtered subset:
# the columns would dance at every keystroke.
_conn_widths() {
    local line via user ip
    _CONN_WA=${#T_CONN_C_ALIAS}
    _CONN_WN=${#T_CONN_C_NAME}
    _CONN_WI=${#T_CONN_C_IP}
    _CONN_WV=${#T_CONN_C_VIA}
    _CONN_WU=${#T_CONN_C_USER}

    for line in "${_MENU_LINES[@]}"; do
        dat_parse "$line"
        via=$(_conn_verb "${_DAT_FIELDS[1]}")
        user="${_DAT_FIELDS[3]:--}"
        ip="${_DAT_FIELDS[5]:--}"
        _conn_badge "${_DAT_FIELDS[0]}" "${_DAT_FIELDS[4]}"
        _vislen "$_CONN_BADGE";       (( _VISLEN > _CONN_WA )) && _CONN_WA=$_VISLEN
        _vislen "${_DAT_FIELDS[0]}";  (( _VISLEN > _CONN_WN )) && _CONN_WN=$_VISLEN
        _vislen "$ip";                (( _VISLEN > _CONN_WI )) && _CONN_WI=$_VISLEN
        _vislen "$via";               (( _VISLEN > _CONN_WV )) && _CONN_WV=$_VISLEN
        _vislen "$user";              (( _VISLEN > _CONN_WU )) && _CONN_WU=$_VISLEN
    done

    # Hard caps: one long FQDN must not eat the screen
    (( _CONN_WA > 10 )) && _CONN_WA=10
    (( _CONN_WN > 22 )) && _CONN_WN=22
    (( _CONN_WI > 15 )) && _CONN_WI=15
    (( _CONN_WV >  8 )) && _CONN_WV=8
    (( _CONN_WU > 12 )) && _CONN_WU=12

    # 4 = 2 leading spaces + 1 trailing space of the selection bar + 1 margin
    local base=$(( 4 + _CONN_WA + 2 + _CONN_WN + 2 + _CONN_WV + 2 ))
    _CONN_MODE="full"
    _CONN_WD=$(( SCREEN_COLS - base - (_CONN_WI + 2) - (_CONN_WU + 2) ))
    if (( _CONN_WD < 16 )); then
        _CONN_MODE="noip"
        _CONN_WD=$(( SCREEN_COLS - base - (_CONN_WU + 2) ))
    fi
    if (( _CONN_WD < 16 )); then
        _CONN_MODE="nouser"
        _CONN_WD=$(( SCREEN_COLS - base ))
    fi
    if (( _CONN_WD < 8 )); then
        _CONN_MODE="mini"
        _CONN_WD=0
    fi
}

# Column header line, rebuilt whenever the widths change
_conn_header_build() {
    local h=""
    _pad "$T_CONN_C_ALIAS" "$_CONN_WA"; h+="$_PAD  "
    _pad "$T_CONN_C_NAME"  "$_CONN_WN"; h+="$_PAD  "
    if [[ "$_CONN_MODE" == "full" ]]; then
        _pad "$T_CONN_C_IP" "$_CONN_WI"; h+="$_PAD  "
    fi
    _pad "$T_CONN_C_VIA" "$_CONN_WV"; h+="$_PAD"
    if [[ "$_CONN_MODE" == "full" || "$_CONN_MODE" == "noip" ]]; then
        h+="  "
        _pad "$T_CONN_C_USER" "$_CONN_WU"; h+="$_PAD"
    fi
    [[ "$_CONN_MODE" != "mini" ]] && h+="  $T_CONN_C_DESC"
    _CONN_HDR="$h"
}

# PASS 1 — runs in the PARENT shell, right before the menu build loop.
_connexions_menu_prepare() {
    local line hay
    local -a kept=()

    get_terminal_size
    _conn_widths
    _conn_header_build
    _CONN_COUNT=${#_MENU_LINES[@]}

    if [[ -z "$_CONN_FILTER" ]]; then
        _MENU_STATUS=""
        return 0
    fi

    # While filtering, the "[+] Add" row is hidden: it matches nothing and would
    # falsify the count. This is also what makes _MENU_LINES[i] == MENU_ITEMS[i],
    # the invariant _conn_focus relies on.
    _MENU_HIDE_ADD="true"
    for line in "${_MENU_LINES[@]}"; do
        hay="${line,,}"
        [[ "$hay" == *"$_CONN_FILTER"* ]] && kept+=("$line")
    done
    _MENU_LINES=("${kept[@]}")

    if (( ${#_MENU_LINES[@]} == 0 )); then
        printf -v _MENU_STATUS '%b  /%s▌  %s%b' "$DIM" "$_CONN_FILTER" "$T_CONN_NO_RESULT" "$NC"
    else
        printf -v _MENU_STATUS '%b  /%s▌  %d %s%b' \
            "$DIM" "$_CONN_FILTER" "${#_MENU_LINES[@]}" "$T_CONN_RESULTS" "$NC"
    fi
    return 0
}

# Column header, drawn by draw_menu under the title. Never selectable.
_connexions_header() {
    printf '%s%s%s' "$C_META" "$_CONN_HDR" "$FG_RESET"
}

# PASS 2 — render one row. Runs in a subshell: reads the layout globals, writes none.
_connexions_menu_format() {
    dat_parse "$1"
    local name="${_DAT_FIELDS[0]}"
    local user="${_DAT_FIELDS[3]}"
    local ip="${_DAT_FIELDS[5]:--}"
    local desc="${_DAT_FIELDS[6]}"
    local via ucol="" out vcol

    via=$(_conn_verb "${_DAT_FIELDS[1]}")
    case "$via" in
        ssh) vcol="$C_SSH" ;;
        xe)  vcol="$C_XE" ;;
        *)   vcol="$C_OTHER" ;;
    esac

    # A volatile override is bound to the KEY, never to the cursor position
    if [[ -n "$_CONN_OVERRIDE_KEY" && "$_CONN_OVERRIDE_KEY" == "$name" ]]; then
        user="$_CONN_OVERRIDE_USER"
        ucol="$C_WARN"
    fi
    [[ -z "$user" ]] && user="-"

    # draw_menu still renders items with echo -e: strip backslashes so a hand-edited
    # description can never inject \n or \t into the layout.
    desc="${desc//\\/ }"

    _conn_badge "$name" "${_DAT_FIELDS[4]}"
    _trunc "$_CONN_BADGE" "$_CONN_WA"; _pad "$_TRUNC" "$_CONN_WA"
    out="${C_ALIAS}${_PAD}${FG_RESET}  "
    _trunc "$name" "$_CONN_WN"; _pad "$_TRUNC" "$_CONN_WN"
    out+="${C_NAME}${_PAD}${FG_RESET}  "
    if [[ "$_CONN_MODE" == "full" ]]; then
        _trunc "$ip" "$_CONN_WI"; _pad "$_TRUNC" "$_CONN_WI"
        out+="${C_META}${_PAD}${FG_RESET}  "
    fi
    _trunc "$via" "$_CONN_WV"; _pad "$_TRUNC" "$_CONN_WV"
    out+="${vcol}${_PAD}${FG_RESET}"
    if [[ "$_CONN_MODE" == "full" || "$_CONN_MODE" == "noip" ]]; then
        _trunc "$user" "$_CONN_WU"; _pad "$_TRUNC" "$_CONN_WU"
        out+="  ${ucol}${_PAD}${FG_RESET}"
    fi
    if [[ "$_CONN_MODE" != "mini" ]]; then
        _trunc "$desc" "$_CONN_WD"
        out+="  ${C_META}${_TRUNC}${FG_RESET}"
    fi
    printf '%s' "$out"
}

# -------------------- CONNECTION -------------------- #

# Applied on write AND before exec: the .dat may have been hand-edited.
CONN_NAME_RE='^[A-Za-z0-9._-]+$'
CONN_TARGET_RE='^[A-Za-z0-9][A-Za-z0-9._:-]*$'
CONN_USER_RE='^[A-Za-z0-9._-]+$'
CONN_VERB_RE='^[A-Za-z0-9_][A-Za-z0-9_./-]*$'
CONN_ALIASES_RE='^[A-Za-z0-9._,-]*$'

_CONN_NAME=""; _CONN_LINE=""; _CONN_VIA=""; _CONN_TARGET=""
_CONN_USER=""; _CONN_IP=""
_CONN_ARGV=(); _CONN_SHELL=0; _CONN_ERR=""

# Load one entry into the _CONN_* globals and apply the volatile override.
# dat_read writes the shared _DAT_FIELDS: copy immediately, any nested dat_read
# would clobber it.
_conn_load() {
    local name="$1"
    dat_read "$CONNEXIONS_FILE" "$name" || return 1
    _CONN_NAME="$name"
    _CONN_LINE="$_DAT_LINE"
    _CONN_VIA="${_DAT_FIELDS[1]}"
    _CONN_TARGET="${_DAT_FIELDS[2]}"
    _CONN_USER="${_DAT_FIELDS[3]}"
    _CONN_IP="${_DAT_FIELDS[5]}"
    [[ -z "$_CONN_TARGET" ]] && _CONN_TARGET="$_CONN_NAME"
    [[ "$_CONN_OVERRIDE_KEY" == "$name" ]] && _CONN_USER="$_CONN_OVERRIDE_USER"
    return 0
}

# Can this entry carry a per-connection user?
_conn_can_user() {
    local via="$1"
    [[ -z "$via" || "$via" == "ssh" ]] && return 0   # ssh always can, through -l
    [[ "$via" != *"{"*"}"* ]] && return 0            # bare verb: user@ is prepended
    [[ "$via" == *"{user"* ]] && return 0            # template with a user slot
    return 1                                        # telnet {host} 23 -> refuse, never guess
}

# Build _CONN_ARGV from the _CONN_* globals. Stored data is never re-parsed by a
# shell: only the verb reaches the -ic script text, and it is validated first.
_conn_build_argv() {
    local via="$_CONN_VIA" target="$_CONN_TARGET" user="$_CONN_USER"
    local at="" w
    local -a words=()
    _CONN_ARGV=()
    _CONN_SHELL=0
    _CONN_ERR=""

    if [[ ! "$target" =~ $CONN_TARGET_RE ]]; then
        _CONN_ERR="$T_CONN_ERR_TARGET: $target"
        return 1
    fi
    if [[ -n "$user" && ! "$user" =~ $CONN_USER_RE ]]; then
        _CONN_ERR="$T_CONN_ERR_USER: $user"
        return 1
    fi
    [[ -n "$user" ]] && at="${user}@"

    if [[ -z "$via" || "$via" == "ssh" ]]; then
        _CONN_ARGV=(ssh)
        [[ -n "$user" ]] && _CONN_ARGV+=(-l "$user")
        _CONN_ARGV+=("$target")
        return 0
    fi

    # Split the TEMPLATE (author-controlled) with read -ra. Never `for w in $via`:
    # an unquoted for globs a X* or ? in the template against the current directory.
    IFS=' ' read -ra words <<< "$via"
    for w in "${words[@]}"; do
        w="${w//\{user@\}/$at}"
        w="${w//\{user\}/$user}"
        w="${w//\{host\}/$target}"
        w="${w//\{ip\}/$_CONN_IP}"
        w="${w//\{name\}/$_CONN_NAME}"
        [[ -z "$w" ]] && continue        # {user@} collapsed to nothing
        _CONN_ARGV+=("$w")
    done
    # A bare verb ("xe") gets the target appended. A template with placeholders is
    # taken literally: kubectl exec -it {name} -- bash must NOT gain a trailing host.
    [[ "$via" != *"{"*"}"* ]] && _CONN_ARGV+=("${at}${target}")

    if [[ ! "${_CONN_ARGV[0]}" =~ $CONN_VERB_RE ]]; then
        _CONN_ERR="$T_CONN_ERR_VIA: ${_CONN_ARGV[0]}"
        return 1
    fi
    # type -P, not command -v: command -v also finds shell functions and builtins,
    # and exec on one of those exits 127 and kills mn.
    type -P "${_CONN_ARGV[0]}" >/dev/null 2>&1 || _CONN_SHELL=1
    return 0
}

# Copy-pasteable form of _CONN_ARGV
_conn_pretty() {
    local w out="${_CONN_ARGV[0]}"
    for w in "${_CONN_ARGV[@]:1}"; do
        if [[ "$w" =~ ^[A-Za-z0-9_@%+=:,./-]+$ ]]; then
            out+=" $w"
        else
            out+=" $(printf '%q' "$w")"
        fi
    done
    printf '%s' "$out"
}

# Inline error, then back to the menu
_conn_flash() {
    show_cursor
    printf '\n  %b✗ %s%b\n' "$RED" "$1" "$NC"
    sleep 2
    hide_cursor
    LAST_MENU=""
}

# Entry action: resolve, build the argv, hand the terminal over.
# Never returns on success — exec replaces the process.
connexions_connect() {
    local name="$1"

    if ! _conn_load "$name"; then
        _conn_flash "$T_CONN_UNKNOWN: $name"
        return 1
    fi
    if ! _conn_build_argv; then
        _conn_flash "$_CONN_ERR"
        return 1
    fi

    # main_loop installed 'trap cleanup INT TERM EXIT': drop it before exec,
    # otherwise Ctrl-C during the handshake falls into cleanup (clear + exit 0).
    trap - INT TERM EXIT
    show_cursor
    clear
    # No spinner, no sleep: nothing was happening during that second anyway.
    printf '  %s→%s %s\n\n' "$C_META" "$FG_RESET" "$(_conn_pretty)"

    if (( _CONN_SHELL )); then
        # The verb is an interactive alias, not a binary: only an interactive shell
        # expands it, and only on a literal first word. The verb therefore goes into
        # the script text (already validated against CONN_VERB_RE); every argument
        # travels as a positional parameter and is never re-parsed by any shell.
        exec bash -ic "${_CONN_ARGV[0]} \"\$@\"" mn "${_CONN_ARGV[@]:1}"
    fi
    exec "${_CONN_ARGV[@]}"
}

# -------------------- USER OVERRIDE -------------------- #

_CONN_RING=()

# Candidate users for one entry: its own default first (possibly empty, meaning
# "let ssh_config or the remote wrapper decide"), then root, $USER, then every
# user already present in the file. Deduplicated, order preserved, capped at 12
# (select_option redraws with tput cuu1 and corrupts past the terminal height).
_conn_ring() {
    local own="$1" u seen
    _CONN_RING=("$own")
    seen=$'\x01'"${own}"$'\x01'
    for u in root "$USER"; do
        [[ "$seen" == *$'\x01'"${u}"$'\x01'* ]] && continue
        seen+="${u}"$'\x01'
        _CONN_RING+=("$u")
    done
    while IFS= read -r u; do
        [[ -z "$u" ]] && continue
        [[ "$seen" == *$'\x01'"${u}"$'\x01'* ]] && continue
        seen+="${u}"$'\x01'
        _CONN_RING+=("$u")
        (( ${#_CONN_RING[@]} >= 12 )) && break
    done < <(awk -F':::' '!/^#/ && NF > 1 && $4 != "" { print $4 }' "$CONNEXIONS_FILE" | sort -u)
}

# [u] cycle the user of the selected row in place. Volatile: nothing is written,
# nothing is rebuilt — only the affected row is re-rendered.
_conn_cycle_user() {
    local name="$1"

    dat_read "$CONNEXIONS_FILE" "$name" || return 0
    local own="${_DAT_FIELDS[3]}"
    local via="${_DAT_FIELDS[1]}"
    local line="$_DAT_LINE"

    if ! _conn_can_user "$via"; then
        _conn_flash "$T_CONN_USER_UNSUPPORTED"
        return 0
    fi

    _conn_ring "$own"
    local cur="$own"
    [[ "$_CONN_OVERRIDE_KEY" == "$name" ]] && cur="$_CONN_OVERRIDE_USER"

    local i next=0
    for (( i=0; i<${#_CONN_RING[@]}; i++ )); do
        if [[ "${_CONN_RING[$i]}" == "$cur" ]]; then
            next=$(( (i + 1) % ${#_CONN_RING[@]} ))
            break
        fi
    done

    if [[ "${_CONN_RING[$next]}" == "$own" ]]; then
        _CONN_OVERRIDE_KEY=""
        _CONN_OVERRIDE_USER=""
    else
        _CONN_OVERRIDE_KEY="$name"
        _CONN_OVERRIDE_USER="${_CONN_RING[$next]}"
    fi

    MENU_ITEMS[$SELECTED_INDEX]=$(_connexions_menu_format "$line")
    return 0
}

# [U] pick a user from the full list, with a free-input escape hatch, then connect.
_conn_pick_user() {
    local name="$1"
    dat_read "$CONNEXIONS_FILE" "$name" || return 0
    local own="${_DAT_FIELDS[3]}"
    local via="${_DAT_FIELDS[1]}"

    if ! _conn_can_user "$via"; then
        clear_screen
        draw_header "$T_CONN_AS_USER $name"
        echo -e "  ${YELLOW}⚠ $T_CONN_USER_UNSUPPORTED${NC}"
        echo -e "\n${DIM}$T_PRESS_KEY${NC}"
        read -rn 1 -s
        hide_cursor
        generic_show_menu "connexions" "$name"
        LAST_MENU=""
        return 0
    fi

    clear_screen
    draw_header "$T_CONN_AS_USER $name"

    _conn_ring "$own"
    local -a opts=("-:::$T_CONN_USER_DEFAULT")
    local u i=1 idx=0
    for u in "${_CONN_RING[@]}"; do
        [[ -z "$u" ]] && continue
        opts+=("${u}:::${u}")
        [[ "$u" == "$own" ]] && idx=$i
        (( i++ ))
    done
    opts+=("+:::$T_CONN_USER_OTHER")

    _SELECT_INDEX=$idx
    if select_option "" "${opts[@]}"; then
        local choice="$_SELECT_VALUE"
        if [[ "$choice" == "+" ]]; then
            show_cursor
            read -e -r -i "${own:-$USER}" -p "$(_form_prompt "$T_CONN_F_USER" "")" choice
            hide_cursor
        fi
        [[ "$choice" == "-" ]] && choice=""
        if [[ -n "$choice" && ! "$choice" =~ $CONN_USER_RE ]]; then
            _conn_flash "$T_CONN_ERR_USER: $choice"
        else
            _CONN_OVERRIDE_KEY="$name"
            _CONN_OVERRIDE_USER="$choice"
            connexions_connect "$name"          # execs on success, never returns
        fi
    fi

    _CONN_OVERRIDE_KEY=""
    _CONN_OVERRIDE_USER=""
    hide_cursor
    generic_show_menu "connexions" "$name"
    LAST_MENU=""
    return 0
}

# [c] hand the rendered command line to the parent shell. The mn() wrapper
# pre-fills it with read -e, so it is editable and lands in the bash history.
_conn_cmdline() {
    local name="$1"
    _conn_load "$name" || return 0
    if ! _conn_build_argv; then
        _conn_flash "$_CONN_ERR"
        return 0
    fi
    # install.sh never calls regenerate_bash_files: on a fresh install the mn()
    # wrapper does not exist yet and MN_RUN_FILE would be silently ignored.
    if ! grep -q 'mn_run_cmd' "$BASH_FUNCTIONS" 2>/dev/null; then
        _conn_flash "$T_CONN_NO_WRAPPER"
        generic_show_menu "connexions" "$name"
        return 0
    fi
    printf '%s\n' "$(_conn_pretty)" > "$MN_RUN_FILE"
    cleanup
}

# -------------------- VALIDATION -------------------- #
# Convention: rc 0 = valid; rc 1 = invalid, message on stdout.

_conn_v_name() {
    [[ "$1" =~ $CONN_NAME_RE ]] && return 0
    printf '%s' "$T_CONN_ERR_NAME"
    return 1
}

_conn_v_target() {
    [[ -z "$1" ]] && return 0
    if [[ "$1" == *"@"* ]]; then
        printf '%s' "$T_CONN_ERR_TARGET_USER"
        return 1
    fi
    [[ "$1" =~ $CONN_TARGET_RE ]] && return 0
    printf '%s' "$T_CONN_ERR_TARGET"
    return 1
}

_conn_v_user() {
    [[ -z "$1" || "$1" =~ $CONN_USER_RE ]] && return 0
    printf '%s' "$T_CONN_ERR_USER"
    return 1
}

_conn_v_aliases() {
    [[ "${1,,}" =~ $CONN_ALIASES_RE ]] && return 0
    printf '%s' "$T_CONN_ERR_ALIASES"
    return 1
}

_conn_v_via() {
    [[ -z "$1" ]] && return 0
    local verb="${1%% *}"
    [[ "$verb" =~ $CONN_VERB_RE ]] && return 0
    printf '%s' "$T_CONN_ERR_VIA"
    return 1
}

# -------------------- DEFAULTS -------------------- #

# Most frequent via already in the file. One fork, not five.
_conn_d_via() {
    local v
    v=$(awk -F':::' '
        !/^#/ && NF > 1 { c[$2 == "" ? "ssh" : $2]++ }
        END { b = "ssh"; m = 0; for (k in c) if (c[k] > m) { m = c[k]; b = k } print b }
    ' "$CONNEXIONS_FILE" 2>/dev/null)
    printf '%s' "${v:-ssh}"
}

# Target defaults to the entry name ($1 = name, already captured)
_conn_d_target() { printf '%s' "$1"; }

# getent suggestion, offered as the pre-filled default and NEVER applied silently.
# Args come from the wizard in field order: $1=name $2=via $3=target.
# Guards: ssh transports only (a custom verb resolves in the bastion namespace),
# 1 s timeout (getent hangs for seconds on an unreachable resolver), and the
# bare-label / public-root discriminator that neutralises a TLD wildcard answer.
_conn_d_ip() {
    local name="$1" via="$2" target="$3"
    [[ -n "$via" && "$via" != "ssh" ]] && return 0
    local q="${target:-$name}" line addr canon
    [[ "$q" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] && { printf '%s' "$q"; return 0; }
    line=$(timeout 1 getent ahostsv4 "$q" 2>/dev/null | awk '$2 == "STREAM" { print $1" "$3; exit }')
    [[ -z "$line" ]] && return 0
    addr="${line%% *}"
    canon="${line##* }"
    case "$addr" in 0.0.0.0|127.*) return 0 ;; esac
    # A bare label whose canonical name equals the query means no search domain was
    # applied: the answer came from the public DNS root, not from the LAN.
    [[ "$q" != *.* && "$canon" == "$q" ]] && return 0
    printf '%s' "$addr"
}

# -------------------- NORMALISATION -------------------- #

# Runs once before writing, in the parent, through its stdout. Receives every
# field and prints the normalised list, one field per line.
_connexions_normalize() {
    local name="$1" via="$2" target="$3" user="$4" aliases="$5" ip="$6" desc="$7"
    local a out="" seen

    [[ -z "$target" ]] && target="$name"
    # A pasted user@host is split HERE: target must stay the exact ssh Host token
    if [[ "$target" == *"@"* ]]; then
        [[ -z "$user" ]] && user="${target%@*}"
        target="${target##*@}"
    fi
    [[ -z "$via" ]] && via="ssh"

    # Aliases: lowercase, spaces stripped, deduplicated, the name itself removed
    aliases="${aliases,,}"
    aliases="${aliases// /}"
    seen=","
    local IFS=','
    for a in $aliases; do
        [[ -z "$a" || "$a" == "${name,,}" ]] && continue
        [[ "$seen" == *",${a},"* ]] && continue
        seen+="${a},"
        out="${out:+$out,}$a"
    done
    unset IFS

    # Backslashes would be interpreted by draw_menu's echo -e
    desc="${desc//\\/ }"

    printf '%s\n' "$name" "$via" "$target" "$user" "$out" "$ip" "$desc"
}

# -------------------- FILTER -------------------- #

# Place the cursor on the best match. Does NOT reorder the list.
# Score: 3 exact handle, 2 handle/name prefix, 0 substring anywhere.
# Relies on _MENU_LINES[i] == MENU_ITEMS[i], true because the add row is hidden
# while a filter is active.
_conn_focus() {
    local i sc best=0 bestsc=-1 name aliases
    local f="$_CONN_FILTER"
    _CONN_EXACT=0
    [[ -z "$f" ]] && return 0
    for (( i=0; i<${#_MENU_LINES[@]}; i++ )); do
        dat_parse "${_MENU_LINES[$i]}"
        name="${_DAT_FIELDS[0],,}"
        aliases=",${_DAT_FIELDS[4],,},"
        sc=0
        # The needle is quoted inside the pattern: an unquoted *$f* would treat a
        # typed '*' as a glob and match everything.
        [[ "$name" == "$f"* || "$aliases" == *",$f"* ]] && sc=2
        [[ "$name" == "$f" || "$aliases" == *",$f,"* ]] && sc=3
        if (( sc > bestsc )); then
            bestsc=$sc
            best=$i
        fi
    done
    (( bestsc == 3 )) && _CONN_EXACT=1
    SELECTED_INDEX=$best
    _menu_sync_page
}

# Move the cursor without rebuilding the menu
_conn_move() {
    local n=${#MENU_ACTIONS[@]}
    (( n == 0 )) && return 0
    SELECTED_INDEX=$(( (SELECTED_INDEX + $1 + n) % n ))
    _menu_sync_page
}

# Incremental filter. Keeps its own single-character reader: read -e cannot
# coexist with a TUI redrawn from tput cup 0 0.
_connexions_filter() {
    local ch rest title changed=1 keep=""
    _CONN_FILTER=""
    title=$(mod_prop "connexions" "TITLE")

    while true; do
        if (( changed )); then
            generic_show_menu "connexions"
            _conn_focus
            changed=0
        fi
        LAST_MENU=""
        draw_menu "$title"

        read -rsn1 ch || break
        case "$ch" in
            $'\x7f'|$'\x08')                     # DEL and BS: terminals differ, handle both
                _CONN_FILTER="${_CONN_FILTER%?}"
                changed=1
                ;;
            $'\x15')                             # Ctrl-U
                _CONN_FILTER=""
                changed=1
                ;;
            $'\033')
                # Same pattern as handle_input: a bare ESC times out to an empty read
                read -rsn2 -t 0.1 rest
                case "$rest" in
                    '[A') _conn_move -1 ;;
                    '[B') _conn_move 1 ;;
                    '')   _CONN_FILTER=""; changed=1; break ;;
                esac
                ;;
            ''|$'\n')
                if (( ${#MENU_ACTIONS[@]} == 1 || _CONN_EXACT )); then
                    _CONN_FILTER=""
                    execute_action           # connects (execs) — never returns on success
                fi
                break
                ;;
            [[:print:]])                         # control characters are ignored
                _CONN_FILTER+="${ch,,}"
                changed=1
                ;;
        esac
    done

    # Restore the full list but keep the cursor where the filter left it, so
    # [/] composes with [u], [U], [c], [e], [d] and [v].
    keep=$(_menu_current_key) || keep=""
    _CONN_FILTER=""
    _CONN_EXACT=0
    generic_show_menu "connexions" "$keep"
    LAST_MENU=""
    return 0
}

# -------------------- KEYS -------------------- #

# Module key map, called from the *) branch of handle_input.
# rc 0 = key consumed, rc 1 = let the engine keep looking (hotkeys plan).
_connexions_keys() {
    local key="$1" name
    case "$key" in
        /)
            _connexions_filter
            return 0
            ;;
        u)
            name=$(_menu_current_key) || return 0
            _conn_cycle_user "$name"
            return 0
            ;;
        U)
            name=$(_menu_current_key) || return 0
            _conn_pick_user "$name"
            return 0
            ;;
        c|C)
            name=$(_menu_current_key) || return 0
            _conn_cmdline "$name"
            return 0
            ;;
    esac
    return 1
}

# -------------------- CLI -------------------- #

_CONN_KEY=""
_CONN_CAND=()

# Resolve a handle. rc 0 = found (_CONN_KEY), 1 = none, 2 = ambiguous (_CONN_CAND).
# $2 = "exact" restricts to name / alias equality (no prefix).
# awk reads the needle through ENVIRON, never through -v: `awk -v k='a\tb'`
# interprets backslash escapes and would silently mutate the key.
_conn_resolve() {
    local q="${1,,}" hit
    _CONN_KEY=""
    _CONN_CAND=()

    hit=$(MN_Q="$q" awk -F':::' '
        BEGIN { q = ENVIRON["MN_Q"] }
        /^#/ { next }
        NF > 1 {
            if (tolower($1) == q) { print $1; exit }
            n = split(tolower($5), a, ",")
            for (i = 1; i <= n; i++) if (a[i] == q) { print $1; exit }
        }' "$CONNEXIONS_FILE")
    [[ -n "$hit" ]] && { _CONN_KEY="$hit"; return 0; }
    [[ "${2:-}" == "exact" ]] && return 1

    mapfile -t _CONN_CAND < <(MN_Q="$q" awk -F':::' '
        BEGIN { q = ENVIRON["MN_Q"] }
        /^#/ { next }
        NF > 1 {
            if (index(tolower($1), q) == 1) { print $1; next }
            n = split(tolower($5), a, ",")
            for (i = 1; i <= n; i++) if (index(a[i], q) == 1) { print $1; next }
        }' "$CONNEXIONS_FILE")

    case ${#_CONN_CAND[@]} in
        1) _CONN_KEY="${_CONN_CAND[0]}"; return 0 ;;
        0) return 1 ;;
        *) return 2 ;;
    esac
}

# mn conn [<handle> [<user>]] | mn conn -l
connexions_cli() {
    case "${1:-}" in
        -l|--list)
            awk -F':::' '!/^#/ && NF > 1 {
                printf "%-12s %-24s %-9s %s\n", $1, $3, $4, $5
            }' "$CONNEXIONS_FILE"
            return 0
            ;;
    esac

    _conn_resolve "$1"
    case $? in
        1)
            printf '%b%s: %s%b\n' "$RED" "$T_CONN_UNKNOWN" "$1" "$NC"
            printf '%bmn conn -l%b — %s\n' "$CYAN" "$NC" "$T_CONN_CLI_HINT"
            return 1
            ;;
        2)
            printf '%b%s: %s%b\n' "$YELLOW" "$T_CONN_AMBIGUOUS" "$1" "$NC"
            printf '  %s\n' "${_CONN_CAND[@]}"
            return 1
            ;;
    esac

    if [[ -n "${2:-}" ]]; then
        if [[ ! "$2" =~ $CONN_USER_RE ]]; then
            printf '%b%s: %s%b\n' "$RED" "$T_CONN_ERR_USER" "$2" "$NC"
            return 1
        fi
        _CONN_OVERRIDE_KEY="$_CONN_KEY"
        _CONN_OVERRIDE_USER="$2"
    fi
    connexions_connect "$_CONN_KEY"
}

# -------------------- FOOTER AND VIEW -------------------- #

# Footer: the exact command line of the selected entry, then the key hints.
# Exactly two lines, like the default footer.
_connexions_footer() {
    local key
    if key=$(_menu_current_key) && _conn_load "$key"; then
        local row
        if _conn_build_argv; then
            printf -v row '%s→%s %s' "$C_GRAY" "$FG_RESET" "$(_conn_pretty)"
        else
            printf -v row '%b✗ %s%b' "$RED" "$_CONN_ERR" "$NC"
        fi
        _fit_row "$row" $(( SCREEN_COLS - 4 ))
        printf '  %s\n' "$_FIT"
    else
        printf '\n'
    fi
    local hint row
    [[ -n "$_CONN_FILTER" ]] && hint="$T_CONN_FILTER_FOOTER" || hint="$T_CONN_FOOTER"
    printf -v row '%b  %s%b' "$DIM" "$hint" "$NC"
    _fit_row "$row" $(( SCREEN_COLS - 2 ))
    printf '%s\n' "$_FIT"
}

# _pad, not printf %-Ns: a label with an accent would break the alignment
_conn_row_view() {
    _pad "$1" "$3"
    printf '  %b%s%b %s\n' "$WHITE" "$_PAD" "$NC" "$2"
}

# [v] full detail: every alias, and the exact command line
_connexions_view() {
    local name="$1" w=14
    clear_screen
    draw_header "CONNEXIONS: $name"
    if dat_read "$CONNEXIONS_FILE" "$name"; then
        local -a f=("${_DAT_FIELDS[@]}")
        _conn_row_view "$T_CONN_F_NAME"    "${f[0]}"                        "$w"
        _conn_row_view "$T_CONN_F_VIA"     "${f[1]:-ssh}"                   "$w"
        _conn_row_view "$T_CONN_F_TARGET"  "${f[2]:-${f[0]}}"               "$w"
        _conn_row_view "$T_CONN_F_USER"    "${f[3]:-$T_CONN_USER_DEFAULT}"  "$w"
        _conn_row_view "$T_CONN_F_ALIASES" "${f[4]//,/, }"                  "$w"
        _conn_row_view "$T_CONN_F_IP"      "${f[5]:--}"                     "$w"
        _conn_row_view "$T_CONN_F_DESC"    "${f[6]}"                        "$w"
        if _conn_load "$name" && _conn_build_argv; then
            printf '\n  %s→%s %s\n' "$C_GRAY" "$FG_RESET" "$(_conn_pretty)"
        fi
    fi
    echo -e "\n${DIM}$T_PRESS_KEY${NC}"
    read -rn 1 -s
    hide_cursor
    LAST_MENU=""
}

# -------------------- WRAPPER -------------------- #

show_connexions_menu() { generic_show_menu "connexions"; }

# Register the module
ALL_MODULES="${ALL_MODULES:+$ALL_MODULES }connexions"
