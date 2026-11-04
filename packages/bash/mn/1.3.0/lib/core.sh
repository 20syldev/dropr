#!/bin/bash
# =========================================================
# MN - Core: configuration, colors, variables, utilities
# =========================================================

# -------------------- CONFIGURATION -------------------- #

MN_DIR="$HOME/.config/mn"
DATA_DIR="$MN_DIR/data"

# Data files
CONNEXIONS_FILE="$DATA_DIR/connexions.dat"
REPOS_FILE="$DATA_DIR/repos.dat"
ALIAS_FILE="$DATA_DIR/aliases.dat"
FUNCS_FILE="$DATA_DIR/functions.dat"

# Bash files
BASH_ALIASES="$HOME/.bash_aliases"
BASH_FUNCTIONS="$HOME/.bash_functions"

# -------------------- LANGUAGE -------------------- #

MN_LANG_FILE="$MN_DIR/.lang"
MN_LANG="fr"
[[ -f "$MN_LANG_FILE" ]] && MN_LANG=$(cat "$MN_LANG_FILE")
[[ ! -f "$MN_DIR/lang/${MN_LANG}.sh" ]] && MN_LANG="fr"
source "$MN_DIR/lang/${MN_LANG}.sh"

# -------------------- EDITOR -------------------- #

MN_EDITOR_FILE="$MN_DIR/.editor"
MN_EDITOR="vi"
[[ -f "$MN_EDITOR_FILE" ]] && MN_EDITOR=$(cat "$MN_EDITOR_FILE")
[[ -z "${MN_EDITOR// }" ]] && MN_EDITOR="vi"

# -------------------- REPOS ROOT -------------------- #

# Root under which a BARE repo name is expanded. No project layout is imposed:
# the default is the home directory, so `myapp` becomes `~/myapp`. Stored in the
# tilde form so the .dat stays portable between machines and users.
MN_REPOS_FILE="$MN_DIR/.repos"
MN_REPOS_ROOT="~"
[[ -f "$MN_REPOS_FILE" ]] && MN_REPOS_ROOT=$(cat "$MN_REPOS_FILE")
[[ -z "${MN_REPOS_ROOT// }" ]] && MN_REPOS_ROOT="~"
MN_REPOS_ROOT="${MN_REPOS_ROOT%/}"
[[ -z "$MN_REPOS_ROOT" ]] && MN_REPOS_ROOT="/"

# -------------------- CDN -------------------- #

MN_CDN_FILE="$MN_DIR/.cdn"
MN_CDN_DEFAULT="https://dropr.sylvain.sh/bash"
MN_CDN="$MN_CDN_DEFAULT"
[[ -f "$MN_CDN_FILE" ]] && MN_CDN=$(cat "$MN_CDN_FILE")
# A trailing slash would build ".../bash//mn@latest", which the CDN rejects
MN_CDN="${MN_CDN%/}"
[[ -z "${MN_CDN// }" ]] && MN_CDN="$MN_CDN_DEFAULT"

# -------------------- FUNCTION SCRIPTS -------------------- #

FUNCS_SYSTEM_DIR="/usr/local/bin"
FUNCS_FALLBACK_DIR="$HOME/.local/bin"

funcs_bin_dir() {
    if [[ -w "$FUNCS_SYSTEM_DIR" ]]; then
        echo "$FUNCS_SYSTEM_DIR"
    else
        echo "$FUNCS_FALLBACK_DIR"
    fi
}

funcs_script_path() {
    local name="$1"
    if [[ -f "$FUNCS_FALLBACK_DIR/$name" ]]; then
        echo "$FUNCS_FALLBACK_DIR/$name"
    elif [[ -f "$FUNCS_SYSTEM_DIR/$name" ]]; then
        echo "$FUNCS_SYSTEM_DIR/$name"
    else
        echo "$(funcs_bin_dir)/$name"
        return 1
    fi
}

# -------------------- COLORS AND STYLES -------------------- #

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
GRAY='\033[0;90m'
NC='\033[0m'

BOLD='\033[1m'
DIM='\033[2m'
UNDERLINE='\033[4m'
BLINK='\033[5m'
REVERSE='\033[7m'
RESET='\033[0m'
FG_RESET=$'\033[39m'

# -------------------- MENU-SAFE COLORS -------------------- #
# Additive SGR only: no "0;" (SGR 0 resets ALL attributes and kills the reverse
# video of the selection bar). These are real escape bytes, not literal text:
# they are consumed by printf '%s' and measured by _vislen, never by echo -e.
C_RED=$'\033[31m'
C_CYAN=$'\033[36m'
C_GREEN=$'\033[32m'
C_YELLOW=$'\033[33m'
C_BLUE=$'\033[34m'
C_MAGENTA=$'\033[35m'
C_GRAY=$'\033[90m'
C_WHITE=$'\033[97m'

BG_BLUE='\033[44m'
BG_CYAN='\033[46m'
BG_BLACK='\033[40m'

# -------------------- GLOBAL VARIABLES -------------------- #

# MENU_ITEMS hold REAL escape bytes, never literal "\033[" text: draw_menu
# prints them with printf '%s' so nothing coming from user data is interpreted.
# Build rows with printf -v and the additive C_* palette above.
CURRENT_MENU="main"
LAST_MENU=""
SELECTED_INDEX=0
MENU_ITEMS=()
MENU_ACTIONS=()
SCREEN_ROWS=0
SCREEN_COLS=0

CURRENT_PAGE=0
ITEMS_PER_PAGE=15
USE_PAGINATION=false

# Private file the mn() shell wrapper creates and passes down. Empty when mn is
# started without the wrapper: nothing is then handed to the shell.
MN_RUN_FILE="${MN_RUN_FILE:-}"
_mn_wrapped() { [[ -n "$MN_RUN_FILE" && -O "$MN_RUN_FILE" && ! -L "$MN_RUN_FILE" ]]; }

# Non-empty while a full-screen session owns the terminal (main_loop, _run_submenu
# and the menu branch of _route_module set it). Helpers that are also reached from
# the CLI (flash messages, cursor handling) test it to stay plain there: no sleep,
# no cursor change, output on stderr. Reset here so an inherited value is ignored.
_MN_TUI=""

# -------------------- UTILITY FUNCTIONS -------------------- #

init_data_files() {
    local old_umask f
    mkdir -p "$DATA_DIR"
    old_umask=$(umask)
    # Data files must never be world-readable, whatever the caller's umask
    umask 077
    for f in "$CONNEXIONS_FILE" "$REPOS_FILE" "$ALIAS_FILE" "$FUNCS_FILE"; do
        [[ ! -f "$f" ]] && touch "$f"
        chmod 600 "$f" 2>/dev/null
    done
    [[ ! -f "$BASH_FUNCTIONS" ]] && touch "$BASH_FUNCTIONS"
    umask "$old_umask"
}

# Page size derived from the terminal height.
# Chrome: title block 3 + column header 1 + status/pagination 2 + footer 2 + margin 1.
_menu_page_size() {
    get_terminal_size
    ITEMS_PER_PAGE=$(( SCREEN_ROWS - 9 ))
    (( ITEMS_PER_PAGE < 5 )) && ITEMS_PER_PAGE=5
}

# Sort a .dat on its LOGICAL first field. The old `sort -f -t':' -k1,1` used a
# ONE-character delimiter on ':::' records: `a:::b:::c` has 7 sort fields, so the
# sort only worked by accident and broke on any label containing a colon.
# Decorate with \x01, stable sort, undecorate. Atomic replace on the resolved path
# (a symlinked .dat stays a symlink), no lock needed.
# A file that holds hand-written comments (anything but the "# Format:" header) is
# left alone: sorting would pile every section comment at the top and drop the
# blank lines. New records simply stay at the end of such a file.
sort_dat_file() {
    local file="$1" target tmp
    _dat_can_read "$file" || return 1
    target=$(_dat_target "$file") || return 1
    if grep '^#' "$target" 2>/dev/null | grep -qv '^# Format:'; then
        return 0
    fi
    tmp=$(mktemp "${target}.XXXXXX" 2>/dev/null) || return 1
    {
        grep '^#' "$target" 2>/dev/null
        grep -v '^#' "$target" 2>/dev/null \
            | grep -v '^[[:space:]]*$' \
            | awk -F':::' '{ print tolower($1) "\x01" $0 }' \
            | LC_ALL=C sort -s -t$'\x01' -k1,1 \
            | cut -d$'\x01' -f2-
    } > "$tmp" 2>/dev/null || { rm -f "$tmp"; return 1; }
    chmod 600 "$tmp" 2>/dev/null
    mv -f "$tmp" "$target" 2>/dev/null || { rm -f "$tmp"; return 1; }
}

# -------------------- SHELL FILES -------------------- #

# mn only ever writes between these two markers; every other line of the user's
# ~/.bash_aliases and ~/.bash_functions is kept verbatim.
_MN_BLOCK_BEGIN="# >>> mn >>>"
_MN_BLOCK_END="# <<< mn <<<"

# Names skipped by the last regenerate_bash_files run
_MN_REGEN_SKIPPED=()

# Alias and repo names. Wide on purpose (`..`, `...` and numeric names are real
# aliases people use) but never a leading "-", and nothing a shell would split.
# Follows the VALIDATE_FN convention: rc 0 when valid, else rc 1 + message on stdout.
_mn_v_alias_name() {
    local name="$1"
    if [[ "$name" == "mn" ]]; then
        printf '%s' "$T_NAME_RESERVED"
        return 1
    fi
    if [[ ! "$name" =~ ^[A-Za-z0-9_.][A-Za-z0-9_.,:@%+-]*$ ]]; then
        printf '%s' "$T_NAME_INVALID"
        return 1
    fi
}

# Function names. Stricter: the name is also a file under ~/.local/bin, so no
# ".", ".." or "/" either. A shell keyword cannot name a function: `select() { ...; }`
# is a syntax error that would make the whole generated block unwritable, and
# `source` would recurse forever through its own `source script "$@"` body.
_mn_v_func_name() {
    local name="$1"
    case "$name" in
        mn|source)
            printf '%s' "$T_NAME_RESERVED"
            return 1
            ;;
        case|coproc|do|done|elif|else|esac|fi|for|function|if|in|select|then|time|until|while)
            printf '%s' "$T_NAME_KEYWORD"
            return 1
            ;;
    esac
    if [[ ! "$name" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]*$ || "$name" == "." || "$name" == ".." ]]; then
        printf '%s' "$T_NAME_INVALID"
        return 1
    fi
}

# True when the configured editor is a GUI editor that detaches from the terminal.
mn_editor_is_gui() {
    case "${MN_EDITOR%% *}" in
        code|code-insiders|codium|zed|subl) return 0 ;;
    esac
    return 1
}

# Expand ONLY a leading ~, $HOME or ${HOME}. Nothing else is ever evaluated.
_mn_expand_path() {
    local p="$1"
    case "$p" in
        "~")           p="$HOME" ;;
        "~/"*)         p="$HOME/${p#"~/"}" ;;
        '$HOME')       p="$HOME" ;;
        '$HOME/'*)     p="$HOME/${p#'$HOME/'}" ;;
        '${HOME}')     p="$HOME" ;;
        '${HOME}/'*)   p="$HOME/${p#'${HOME}/'}" ;;
    esac
    printf '%s\n' "$p"
}

# Quote for the inside of a single-quoted shell string: ' becomes '\''
_mn_squote() {
    printf '%s' "${1//\'/\'\\\'\'}"
}

# Record names (first field) of a .dat, one per line
_mn_dat_names() {
    local line
    [[ -f "$1" ]] || return 0
    while IFS= read -r line || [[ -n "$line" ]]; do
        [[ -z "$line" || "$line" =~ ^# ]] && continue
        printf '%s\n' "${line%%:::*}"
    done < "$1"
}

# True when LINE is one of the lines mn 1.1.x generated itself. Only used the
# first time a file without markers is met, to migrate it. $2 / $3 hold the
# alias and function record names, newline separated.
_mn_legacy_line() {
    local line="$1" alias_names="$2" func_names="$3" n
    case "$line" in
        '[[ -f ~/.bash_functions ]] && source ~/.bash_functions') return 0 ;;
        '[[ -f ~/.local/share/bash-completion/completions/mn ]] && source ~/.local/share/bash-completion/completions/mn') return 0 ;;
        'mn() {'*) return 0 ;;
        'alias '*=*)
            n="${line#alias }"
            n="${n%%=*}"
            [[ $'\n'"$alias_names"$'\n' == *$'\n'"$n"$'\n'* ]] && return 0
            ;;
        *'() { source '*)
            n="${line%%'() { source '*}"
            [[ $'\n'"$func_names"$'\n' == *$'\n'"$n"$'\n'* ]] && return 0
            ;;
    esac
    return 1
}

# Rewrite the mn block of FILE with BODY. Everything outside the markers is kept.
# First contact with a file that has no markers: save a one-time FILE.mn-bak, then
# drop only the lines mn 1.1.x generated (see _mn_legacy_line). The write is atomic
# on the resolved path (a symlinked dotfile stays a symlink) and nothing is
# replaced when the new content does not parse.
_mn_write_block() {
    local file="$1" body="$2" alias_names="$3" func_names="$4"
    local target tmp i b=-1 e=-1 l
    local -a lines=() pre=() post=()

    printf '%s\n' "$body" | bash -n 2>/dev/null || return 1

    target=$(readlink -f -- "$file" 2>/dev/null)
    [[ -z "$target" ]] && target="$file"
    [[ -f "$target" ]] && mapfile -t lines < "$target"

    for (( i = 0; i < ${#lines[@]}; i++ )); do
        if (( b < 0 )) && [[ "${lines[i]}" == "$_MN_BLOCK_BEGIN" ]]; then
            b=$i
        elif (( b >= 0 )) && [[ "${lines[i]}" == "$_MN_BLOCK_END" ]]; then
            e=$i
            break
        fi
    done
    # A start marker without its end: the file was edited by hand, do not guess
    (( b >= 0 && e < 0 )) && return 1

    if (( b >= 0 )); then
        pre=("${lines[@]:0:b}")
        post=("${lines[@]:e+1}")
    else
        if [[ -s "$target" && ! -e "$file.mn-bak" ]]; then
            cp -p -- "$file" "$file.mn-bak" || return 1
        fi
        for l in "${lines[@]}"; do
            _mn_legacy_line "$l" "$alias_names" "$func_names" || pre+=("$l")
        done
        # No negative subscripts here: they need bash 4.3
        while (( ${#pre[@]} )) && [[ -z "${pre[${#pre[@]}-1]//[[:space:]]/}" ]]; do
            unset "pre[${#pre[@]}-1]"
        done
        (( ${#pre[@]} )) && pre+=("")
    fi

    tmp=$(mktemp -- "${target}.XXXXXX" 2>/dev/null) || return 1
    {
        (( ${#pre[@]} )) && printf '%s\n' "${pre[@]}"
        printf '%s\n' "$_MN_BLOCK_BEGIN" "# Generated by mn. Changes inside this block are overwritten."
        [[ -n "$body" ]] && printf '%s\n' "$body"
        printf '%s\n' "$_MN_BLOCK_END"
        (( ${#post[@]} )) && printf '%s\n' "${post[@]}"
        true
    } > "$tmp" 2>/dev/null || { rm -f "$tmp"; return 1; }

    if [[ -e "$target" ]]; then
        chmod --reference="$target" "$tmp" 2>/dev/null
    else
        chmod 644 "$tmp" 2>/dev/null
    fi
    mv -f -- "$tmp" "$target" 2>/dev/null || { rm -f "$tmp"; return 1; }
}

# Regenerate the mn block of ~/.bash_aliases and ~/.bash_functions from the .dat
# files. Names that cannot be written safely are skipped, listed in
# _MN_REGEN_SKIPPED and reported; rc 1 when anything was skipped or not written.
# Only functions of this file may be called from here: the 1.1.2 updater sources
# the new core.sh alone before calling it.
regenerate_bash_files() {
    local line name rest cmd path type script out rc=0
    local alias_lines="" func_lines="" alias_names func_names
    local alias_body func_body

    _MN_REGEN_SKIPPED=()
    alias_names=$(_mn_dat_names "$ALIAS_FILE"; _mn_dat_names "$REPOS_FILE")
    func_names=$(_mn_dat_names "$FUNCS_FILE")

    if [[ -s "$ALIAS_FILE" ]]; then
        while IFS= read -r line || [[ -n "$line" ]]; do
            [[ -z "$line" || "$line" =~ ^# ]] && continue
            name="${line%%:::*}"
            rest="${line#*:::}"
            cmd="${rest%%:::*}"
            if ! _mn_v_alias_name "$name" > /dev/null; then
                _MN_REGEN_SKIPPED+=("$name")
                continue
            fi
            alias_lines+="alias $name='$(_mn_squote "$cmd")'"$'\n'
        done < "$ALIAS_FILE"
    fi

    if [[ -s "$REPOS_FILE" ]]; then
        while IFS= read -r line || [[ -n "$line" ]]; do
            [[ -z "$line" || "$line" =~ ^# ]] && continue
            name="${line%%:::*}"
            rest="${line#*:::}"
            path="${rest%%:::*}"
            if ! _mn_v_alias_name "$name" > /dev/null; then
                _MN_REGEN_SKIPPED+=("$name")
                continue
            fi
            cmd="$MN_EDITOR $(printf '%q' "$(_mn_expand_path "$path")")"
            # A GUI editor detaches: close the terminal like a repo alias always did
            mn_editor_is_gui && cmd+=" && exit"
            alias_lines+="alias $name='$(_mn_squote "$cmd")'"$'\n'
        done < "$REPOS_FILE"
    fi

    # Wrapper first, then the completion, then the sorted user functions
    if [[ -s "$FUNCS_FILE" ]]; then
        while IFS= read -r line || [[ -n "$line" ]]; do
            [[ -z "$line" || "$line" =~ ^# ]] && continue
            name="${line%%:::*}"
            rest="${line#*:::}"
            type="${rest#*:::}"
            [[ "$type" == "shell" ]] || continue
            if ! _mn_v_func_name "$name" > /dev/null; then
                _MN_REGEN_SKIPPED+=("$name")
                continue
            fi
            script=$(funcs_script_path "$name")
            # `function name()` keeps the name from being alias-expanded: a plain
            # `name() {` fails to parse once an alias of the same name is defined
            printf -v out 'function %s() { source %q "$@"; }' "$name" "$script"
            func_lines+="$out"$'\n'
        done < "$FUNCS_FILE"
    fi

    alias_body=$(printf '%s' "$alias_lines" | sort -f -t'=' -k1,1)
    alias_body+=$'\n''[[ -f ~/.bash_functions ]] && source ~/.bash_functions'

    # The command goes through a private file made by mktemp (never a fixed path
    # another user or process could plant), handed to mn in MN_RUN_FILE. It is
    # trusted only when it is non-empty and owned by the current user. When
    # XDG_RUNTIME_DIR is unusable (su without -, WSL) it falls back to TMPDIR
    # and /tmp, and runs mn with no file at all rather than not at all.
    func_body='mn() { local _mn_rf _mn_cmd; _mn_rf=$(mktemp "${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}/mn.XXXXXX" 2>/dev/null || mktemp "${TMPDIR:-/tmp}/mn.XXXXXX" 2>/dev/null || mktemp /tmp/mn.XXXXXX 2>/dev/null); MN_RUN_FILE="$_mn_rf" ~/.config/mn/mn "$@" && source ~/.bash_aliases; if [[ -s $_mn_rf && -O $_mn_rf ]]; then _mn_cmd=$(<"$_mn_rf"); rm -f "$_mn_rf"; read -e -r -i "$_mn_cmd" _mn_cmd && history -s "$_mn_cmd" && eval "$_mn_cmd"; else rm -f "$_mn_rf"; fi; }'
    func_body+=$'\n''[[ -f ~/.local/share/bash-completion/completions/mn ]] && source ~/.local/share/bash-completion/completions/mn'
    if [[ -n "$func_lines" ]]; then
        func_body+=$'\n'$(printf '%s' "$func_lines" | sort -f -t'(' -k1,1)
    fi

    _mn_write_block "$BASH_ALIASES" "$alias_body" "$alias_names" "$func_names" || {
        printf '%s: %s\n' "${T_ERR_WRITE:-cannot write}" "$BASH_ALIASES" >&2
        rc=1
    }
    _mn_write_block "$BASH_FUNCTIONS" "$func_body" "$alias_names" "$func_names" || {
        printf '%s: %s\n' "${T_ERR_WRITE:-cannot write}" "$BASH_FUNCTIONS" >&2
        rc=1
    }

    if (( ${#_MN_REGEN_SKIPPED[@]} )); then
        printf '%s: %s\n' "${T_REGEN_SKIPPED:-Names skipped}" "${_MN_REGEN_SKIPPED[*]}" >&2
        # Inside the TUI the next redraw would wipe the warning at once
        [[ -n "$_MN_TUI" ]] && sleep 2
        rc=1
    fi
    return $rc
}

get_terminal_size() {
    SCREEN_ROWS=$(tput lines)
    SCREEN_COLS=$(tput cols)
}

clear_screen() {
    tput clear
    tput cup 0 0
}

hide_cursor() { tput civis; }
show_cursor() { tput cnorm; }

# -------------------- TUI SCREEN -------------------- #

# Capabilities are read once: a frame is drawn on every key press, and one tput
# fork per line is what made the old menus tear.
_T_CAPS=""
_T_SMCUP=""
_T_RMCUP=""
_T_EL=""
_T_ED=""
_T_CIVIS=""
_T_CNORM=""
_T_REENTER=""
_tui_caps() {
    [[ -n "$_T_CAPS" ]] && return 0
    _T_CAPS=1
    _T_SMCUP=$(tput smcup 2>/dev/null)
    _T_RMCUP=$(tput rmcup 2>/dev/null)
    _T_EL=$(tput el 2>/dev/null)
    _T_ED=$(tput ed 2>/dev/null)
    _T_CIVIS=$(tput civis 2>/dev/null)
    _T_CNORM=$(tput cnorm 2>/dev/null)
    : "${_T_EL:=$'\e[K'}" "${_T_ED:=$'\e[J'}"
    # Entering the alternate screen again must not save the cursor a second time
    # (xterm would then restore the wrong position on exit): 1047 only switches.
    _T_REENTER="$_T_SMCUP"
    [[ "$_T_SMCUP" == *'?1049h'* ]] && _T_REENTER=$'\e[?1047h'
}

# Non-empty while mn owns the alternate screen. _tui_restore is idempotent, so the
# INT/TERM handler, the EXIT trap and an explicit call can all run it.
_MN_ALT=""

# Switch to the alternate screen and hide the cursor.
_tui_screen() {
    _tui_caps
    _MN_ALT=1
    printf '%s%s' "$_T_SMCUP" "$_T_CIVIS"
}

# Give the terminal back as it was: normal screen, visible cursor, nothing cleared.
_tui_restore() {
    [[ -n "$_MN_ALT" ]] || return 0
    _MN_ALT=""
    printf '%s%s' "$_T_RMCUP" "$_T_CNORM"
}

center_text() {
    local text="$1"
    local width="${2:-$SCREEN_COLS}"
    local text_len=${#text}
    local padding=$(( (width - text_len) / 2 ))
    printf "%*s%s%*s" $padding "" "$text" $padding ""
}

spinner_start() {
    local msg="$1"
    local frames="⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
    _SPINNER_PID=""
    (
        local i=0
        while true; do
            echo -ne "\r${CYAN}${frames:i%${#frames}:1}${NC} $msg"
            ((i++))
            sleep 0.08
        done
    ) &
    _SPINNER_PID=$!
}

spinner_stop() {
    [[ -n "$_SPINNER_PID" ]] && kill "$_SPINNER_PID" 2>/dev/null && wait "$_SPINNER_PID" 2>/dev/null
    _SPINNER_PID=""
    printf "\r\033[K"
}
