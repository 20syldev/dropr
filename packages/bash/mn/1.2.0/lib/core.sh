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
MN_CDN="https://dropr.sylvain.sh/bash"
[[ -f "$MN_CDN_FILE" ]] && MN_CDN=$(cat "$MN_CDN_FILE")
[[ -z "${MN_CDN// }" ]] && MN_CDN="https://dropr.sylvain.sh/bash"

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

MN_RUN_FILE="/tmp/mn_run_cmd"

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
# Decorate with \x01, stable sort, undecorate. Atomic replace, no lock needed.
sort_dat_file() {
    local file="$1" tmp
    tmp=$(mktemp "${file}.XXXXXX") || return 1
    {
        grep '^#' "$file" 2>/dev/null
        grep -v '^#' "$file" 2>/dev/null \
            | grep -v '^[[:space:]]*$' \
            | awk -F':::' '{ print tolower($1) "\x01" $0 }' \
            | LC_ALL=C sort -s -t$'\x01' -k1,1 \
            | cut -d$'\x01' -f2-
    } > "$tmp"
    chmod 600 "$tmp"
    mv "$tmp" "$file"
}

regenerate_bash_files() {
    local tmp_aliases tmp_functions
    tmp_aliases=$(mktemp)
    tmp_functions=$(mktemp)

    if [[ -f "$ALIAS_FILE" && -s "$ALIAS_FILE" ]]; then
        while IFS= read -r line || [[ -n "$line" ]]; do
            [[ -z "$line" || "$line" =~ ^# ]] && continue
            local name="${line%%:::*}"
            local rest="${line#*:::}"
            local cmd="${rest%%:::*}"
            echo "alias $name='$cmd'" >> "$tmp_aliases"
        done < "$ALIAS_FILE"
    fi

    if [[ -f "$REPOS_FILE" && -s "$REPOS_FILE" ]]; then
        while IFS= read -r line || [[ -n "$line" ]]; do
            [[ -z "$line" || "$line" =~ ^# ]] && continue
            local name="${line%%:::*}"
            local rest="${line#*:::}"
            local path="${rest%%:::*}"
            echo "alias $name='$MN_EDITOR $path && exit;'" >> "$tmp_aliases"
        done < "$REPOS_FILE"
    fi

    sort -f -t'=' -k1,1 "$tmp_aliases" > "$BASH_ALIASES"
    echo "" >> "$BASH_ALIASES"
    echo '[[ -f ~/.bash_functions ]] && source ~/.bash_functions' >> "$BASH_ALIASES"

    printf 'mn() { ~/.config/mn/mn "$@" && source ~/.bash_aliases; if [[ -f %s ]]; then local _mn_cmd; _mn_cmd=$(cat %s); rm -f %s; read -e -r -i "$_mn_cmd" _mn_cmd && history -s "$_mn_cmd" && eval "$_mn_cmd"; fi; }\n' \
        "$MN_RUN_FILE" "$MN_RUN_FILE" "$MN_RUN_FILE" >> "$tmp_functions"
    echo '[[ -f ~/.local/share/bash-completion/completions/mn ]] && source ~/.local/share/bash-completion/completions/mn' >> "$tmp_functions"

    if [[ -f "$FUNCS_FILE" && -s "$FUNCS_FILE" ]]; then
        while IFS= read -r line || [[ -n "$line" ]]; do
            [[ -z "$line" || "$line" =~ ^# ]] && continue
            local name="${line%%:::*}"
            local rest="${line#*:::}"
            local desc="${rest%%:::*}"
            local type="${rest#*:::}"
            if [[ "$type" == "shell" ]]; then
                local script
                script=$(funcs_script_path "$name")
                echo "$name() { source \"$script\" \"\$@\"; }" >> "$tmp_functions"
            fi
        done < "$FUNCS_FILE"
    fi

    sort -f -t'(' -k1,1 "$tmp_functions" > "$BASH_FUNCTIONS"
    rm -f "$tmp_aliases" "$tmp_functions"
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
