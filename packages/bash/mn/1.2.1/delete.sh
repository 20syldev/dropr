#!/bin/bash

# mn uninstaller
# Usage: curl -fsSL https://dropr.sylvain.sh/bash/mn@latest/delete.sh | sh
#
# Under bash: a checklist (nothing ticked, Space toggles, Enter confirms), then
# the exact list of what goes and one last question.
# Under plain sh: one question per part, each showing its exact paths.
# Parts: Core, Configuration, Data, Plugins (same split as `mn uninstall`).

set -e

MN_DIR="$HOME/.config/mn"

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[1;94m'
CYAN='\033[1;36m'
YELLOW='\033[1;33m'
DIM='\033[2m'
NC='\033[0m'

BLOCK_BEGIN="# >>> mn >>>"
BLOCK_END="# <<< mn <<<"

# ─── Bash-only: interactive picker ───────────────────────────────────

if [ -n "$BASH_VERSION" ]; then
    eval "$(cat <<'BASH_EVAL'
        _checkbox_select() {
            local -a _labels=("$@")
            local _count=${#_labels[@]}
            local -a _checked=()
            local _sel=0 _key _k2 _i _mark _v _a

            # Nothing is pre-ticked: a stray Enter removes nothing
            for (( _i=0; _i<_count; _i++ )); do _checked[$_i]=0; done

            # count rows, a blank line, the footer: always count+2 lines
            _chk_draw() {
                for (( _i=0; _i<_count; _i++ )); do
                    _mark=" "; [[ ${_checked[$_i]} -eq 1 ]] && _mark="✓"
                    printf '\033[K'
                    [[ $_i -eq $_sel ]] \
                        && printf '  \033[7m [%s] %s \033[0m\n' "$_mark" "${_labels[$_i]}" \
                        || printf '   [%s] %s\n' "$_mark" "${_labels[$_i]}"
                done
                printf '\033[K\n'
                printf '\033[K  \033[2m%s\033[0m\n' "${T_UNINSTALL_FOOTER:-↑↓ move · space toggle · enter confirm · q cancel}"
            }

            _chk_toggle() {
                _checked[$_sel]=$(( 1 - ${_checked[$_sel]} ))
                if [[ $_sel -eq 0 ]]; then
                    _v=${_checked[0]}
                    for (( _i=1; _i<_count; _i++ )); do _checked[$_i]=$_v; done
                else
                    [[ ${_checked[$_sel]} -eq 0 ]] && _checked[0]=0
                    _a=1
                    for (( _i=1; _i<_count; _i++ )); do
                        [[ ${_checked[$_i]} -eq 0 ]] && _a=0
                    done
                    _checked[0]=$_a
                fi
            }

            trap 'printf "\033[?25h"; exit 130' INT TERM
            printf '\033[?25l'
            _chk_draw

            while true; do
                # End of input or no terminal: cancel, never confirm
                { IFS= read -rsn1 _key < /dev/tty; } 2>/dev/null \
                    || { printf '\033[?25h'; trap - INT TERM; return 1; }
                if [[ "$_key" == $'\x1b' ]]; then
                    if { IFS= read -rsn2 -t 0.1 _k2 < /dev/tty; } 2>/dev/null; then
                        case "$_k2" in
                            '[A') _sel=$(( _sel - 1 )); [[ $_sel -lt 0 ]] && _sel=$(( _count - 1 )) ;;
                            '[B') _sel=$(( _sel + 1 )); [[ $_sel -ge _count ]] && _sel=0 ;;
                        esac
                    else
                        # A lone Escape
                        printf '\033[?25h'; trap - INT TERM; return 1
                    fi
                else
                    case "$_key" in
                        k) _sel=$(( _sel - 1 )); [[ $_sel -lt 0 ]] && _sel=$(( _count - 1 )) ;;
                        j) _sel=$(( _sel + 1 )); [[ $_sel -ge _count ]] && _sel=0 ;;
                        ' ') _chk_toggle ;;
                        a)
                            _v=$(( 1 - ${_checked[0]} ))
                            for (( _i=0; _i<_count; _i++ )); do _checked[$_i]=$_v; done
                            ;;
                        '')
                            printf '\033[?25h'
                            trap - INT TERM
                            _CHK_CORE=${_checked[1]}
                            _CHK_CONFIG=${_checked[2]}
                            _CHK_DATA=${_checked[3]}
                            _CHK_PLUGINS=${_checked[4]}
                            return 0
                            ;;
                        q) printf '\033[?25h'; trap - INT TERM; return 1 ;;
                    esac
                fi

                printf '\033[%dA\r' "$(( _count + 2 ))"
                _chk_draw
            done
        }
BASH_EVAL
)"
    _INTERACTIVE=true
fi

# ─── Load saved language (default: en) ───────────────────────────────

# Only for generic sentences. The part labels and paths below are this script's
# own: the installed lang may be an older release that splits the parts differently.
_MN_LANG="en"
[ -f "$MN_DIR/.lang" ] && _MN_LANG=$(cat "$MN_DIR/.lang")
case "$_MN_LANG" in
    *[!a-z]*) _MN_LANG="en" ;;
esac
if [ -f "$MN_DIR/lang/${_MN_LANG}.sh" ]; then
    . "$MN_DIR/lang/${_MN_LANG}.sh"
fi

printf "${BLUE}mn uninstaller${NC}\n\n"

if [ -z "$HOME" ] || [ ! -d "$MN_DIR" ]; then
    printf "${YELLOW}mn is not installed.${NC}\n"
    exit 0
fi

# ─── Helpers ─────────────────────────────────────────────────────────

_cancel() {
    printf "${BLUE}%s${NC}\n" "${T_CANCELLED:-Cancelled}"
    exit 0
}

# _ask PROMPT DEFAULT(y|n): rc 0 for yes. End of input or no terminal cancels:
# an unanswered question never counts as yes.
_ask() {
    if [ "$2" = y ]; then _hint="Y/n"; else _hint="y/N"; fi
    printf "${CYAN}%s [%s]:${NC} " "$1" "$_hint"
    _ans=""
    if ! { read -r _ans < /dev/tty; } 2>/dev/null; then
        printf "\n"
        _cancel
    fi
    case "$_ans" in
        y|Y|yes|YES|oui|OUI) return 0 ;;
        n|N|no|NO|non|NON) return 1 ;;
    esac
    [ "$2" = y ]
}

# Existing names from "$2..." under "$1", as dir/{a,b} (dir/a for one)
_paths() {
    _pd=$1
    shift
    _pf=""
    for _pn in "$@"; do
        if [ -e "$_pd/$_pn" ] || [ -L "$_pd/$_pn" ]; then
            _pf="${_pf:+$_pf,}$_pn"
        fi
    done
    if [ -n "$_pf" ]; then
        case "$_pf" in
            *,*) _pf="{$_pf}" ;;
        esac
        printf '%s/%s' "$_pd" "$_pf"
    fi
    return 0
}

# True when $1 holds mn's block as one begin line followed by one end line. An end
# marker above the begin (a bad merge, a hand edit) would make the sed range below
# run to the end of the file and eat the user's lines, so such a file is left alone.
_block_ok() {
    awk -v b="$BLOCK_BEGIN" -v e="$BLOCK_END" '
        $0 == b { if (open) bad = 1; open = 1; seen = 1; next }
        $0 == e { if (!open) bad = 1; open = 0 }
        END { exit !(seen && !open && !bad) }
    ' "$1"
}

# What mn left in a shell file: the exact lines that will go, or nothing
_shell_note() {
    _sf=$1
    _note=""
    if grep -qxF '# Added by mn installer' "$_sf"; then
        _note="# Added by mn installer"
    fi
    _both=0
    if _block_ok "$_sf"; then
        _both=1
        _note="${_note:+$_note, }$BLOCK_BEGIN ... $BLOCK_END"
    fi
    # The 1.1 wrapper lived outside any block, only in ~/.bash_functions
    if [ "$_sf" = "$HOME/.bash_functions" ]; then
        if [ "$_both" -eq 1 ]; then
            _left=$(sed '/^# >>> mn >>>$/,/^# <<< mn <<<$/d' "$_sf")
        else
            _left=$(cat "$_sf")
        fi
        if printf '%s\n' "$_left" | grep -q '^mn()'; then
            _note="${_note:+$_note, }mn()"
        fi
    fi
    printf '%s' "$_note"
}

# Print each non-empty line of $1 indented
_lines() {
    while IFS= read -r _l; do
        if [ -n "$_l" ]; then printf '    %s\n' "$_l"; fi
    done <<EOF
$1
EOF
    return 0
}

# ─── What exists, worked out BEFORE anything is removed ──────────────

# Only a link that really resolves to this install is ours
SELF=$(readlink -f "$MN_DIR/mn" 2>/dev/null || true)
LINKS=""
for bin_dir in /usr/local/bin "$HOME/.local/bin" "$HOME/bin"; do
    if [ -L "$bin_dir/mn" ] && [ "$(readlink -f "$bin_dir/mn" 2>/dev/null)" = "$SELF" ]; then
        LINKS="$LINKS$bin_dir/mn
"
    fi
done

SHELL_FILES=""
for rc in "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile" "$HOME/.zshrc" \
          "$HOME/.bash_aliases" "$HOME/.bash_functions"; do
    if [ -f "$rc" ] && [ -n "$(_shell_note "$rc")" ]; then
        SHELL_FILES="$SHELL_FILES$rc
"
    fi
    # Markers in the wrong order or unpaired: the file is left alone, say so
    if [ -f "$rc" ] && { grep -qxF "$BLOCK_BEGIN" "$rc" || grep -qxF "$BLOCK_END" "$rc"; } \
        && ! _block_ok "$rc"; then
        printf "${YELLOW}Left untouched:${NC} %s (mn block markers missing or out of order, edit it by hand)\n" "$rc"
    fi
done

COMPS=""
for comp in /usr/share/bash-completion/completions/mn \
            "$HOME/.local/share/bash-completion/completions/mn" \
            /usr/share/zsh/vendor-completions/_mn \
            "$HOME/.local/share/zsh/site-functions/_mn"; do
    if [ -f "$comp" ]; then
        COMPS="$COMPS$comp
"
    fi
done

# Function scripts are the user's own code: listed, never deleted
SCRIPTS=""
if [ -f "$MN_DIR/data/functions.dat" ]; then
    while IFS= read -r _line || [ -n "$_line" ]; do
        case "$_line" in
            ''|'#'*) continue ;;
        esac
        _name="${_line%%:::*}"
        case "$_name" in
            .|..|-*|*[!A-Za-z0-9_.-]*) continue ;;
        esac
        for _d in "$HOME/.local/bin" /usr/local/bin; do
            if [ -f "$_d/$_name" ]; then
                SCRIPTS="$SCRIPTS$_d/$_name
"
                break
            fi
        done
    done < "$MN_DIR/data/functions.dat"
fi

# Exact paths of one part (language-neutral)
_part_paths() {
    case "$1" in
        core)
            _lines "$(_paths "$MN_DIR" lib modules completions lang mn VERSION manifest)"
            _lines "$LINKS"
            _lines "$COMPS"
            while IFS= read -r _f; do
                if [ -n "$_f" ]; then
                    printf '    %s  %b(%s)%b\n' "$_f" "$DIM" "$(_shell_note "$_f")" "$NC"
                fi
            done <<EOF
$SHELL_FILES
EOF
            ;;
        config)
            _cp=$(_paths "$MN_DIR" .lang .editor .cdn .repos)
            printf '    %s\n' "${_cp:-$MN_DIR/.lang}"
            ;;
        data)
            _lines "$(_paths "$MN_DIR" data docs)"
            ;;
        plugins)
            printf '    %s\n' "$MN_DIR/plugins"
            ;;
    esac
    return 0
}

_part_title() {
    case "$1" in
        core)    printf 'Core' ;;
        config)  printf 'Configuration' ;;
        data)    printf 'Data' ;;
        plugins) printf 'Plugins' ;;
    esac
}

# ─── Choose what to remove ───────────────────────────────────────────

printf "${RED}%s${NC}\n\n" "${T_UNINSTALL_SELECT:-What do you want to remove?}"

_CHK_CORE=0; _CHK_CONFIG=0; _CHK_DATA=0; _CHK_PLUGINS=0

if [ "${_INTERACTIVE:-}" = true ]; then
    if ! _checkbox_select \
        "${T_UNINSTALL_ALL:-Everything}" \
        "$(_part_title core)" \
        "$(_part_title config)" \
        "$(_part_title data)" \
        "$(_part_title plugins)"; then
        _cancel
    fi

    if [ "$_CHK_CORE" -eq 0 ] && [ "$_CHK_CONFIG" -eq 0 ] && \
       [ "$_CHK_DATA" -eq 0 ] && [ "$_CHK_PLUGINS" -eq 0 ]; then
        printf "\n${YELLOW}%s${NC}\n" "${T_UNINSTALL_NOTHING:-Nothing is ticked: uninstall cancelled.}"
        exit 0
    fi

    # The exact list, then one last question (No by default)
    printf "\n%s\n" "${T_UNINSTALL_SUMMARY:-Will be removed:}"
    for part in core config data plugins; do
        eval "_on=\$_CHK_$(printf '%s' "$part" | tr 'a-z' 'A-Z')"
        if [ "$_on" -eq 1 ]; then
            printf "\n  ${CYAN}%s${NC}\n" "$(_part_title "$part")"
            _part_paths "$part"
        fi
    done
    if [ -n "$SCRIPTS" ]; then
        printf "\n${DIM}%s${NC}\n" "${T_UNINSTALL_KEPT:-Kept (function scripts, remove them yourself):}"
        _lines "$SCRIPTS"
    fi
    printf "\n"
    _ask "${T_CONFIG_UNINSTALL_CONFIRM:-Remove the selected items?}" n || _cancel
else
    # Plain sh: one question per part, with its exact paths.
    # Core and Configuration default to yes, Data and Plugins to no.
    for part in core config data plugins; do
        printf "${CYAN}%s${NC}\n" "$(_part_title "$part")"
        _part_paths "$part"
        case "$part" in
            core|config) _def=y ;;
            *)           _def=n ;;
        esac
        _on=0
        if _ask "$(_part_title "$part")?" "$_def"; then _on=1; fi
        case "$part" in
            core)    _CHK_CORE=$_on ;;
            config)  _CHK_CONFIG=$_on ;;
            data)    _CHK_DATA=$_on ;;
            plugins) _CHK_PLUGINS=$_on ;;
        esac
        printf "\n"
    done
    if [ "$_CHK_CORE" -eq 0 ] && [ "$_CHK_CONFIG" -eq 0 ] && \
       [ "$_CHK_DATA" -eq 0 ] && [ "$_CHK_PLUGINS" -eq 0 ]; then
        _cancel
    fi
    if [ -n "$SCRIPTS" ]; then
        printf "${DIM}%s${NC}\n" "${T_UNINSTALL_KEPT:-Kept (function scripts, remove them yourself):}"
        _lines "$SCRIPTS"
        printf "\n"
    fi
fi

printf "\n"

# ─── Selective removal ───────────────────────────────────────────────

# Core: links, installer lines, mn's own block, completions, program files
if [ "$_CHK_CORE" -eq 1 ]; then
    while IFS= read -r _l; do
        if [ -n "$_l" ]; then
            if rm -f "$_l" 2>/dev/null; then
                printf "${GREEN}Removed symlink:${NC} %s\n" "$_l"
            else
                printf "${YELLOW}Skipped:${NC} %s (permission denied)\n" "$_l"
            fi
        fi
    done <<EOF
$LINKS
EOF

    while IFS= read -r _f; do
        [ -n "$_f" ] || continue
        # The two lines the installer wrote for the PATH, nothing else
        if grep -qxF '# Added by mn installer' "$_f"; then
            sed -i --follow-symlinks '/^# Added by mn installer$/{N;d}' "$_f"
        fi
        # mn's own block, only when begin and end are both there and in that order
        if _block_ok "$_f"; then
            sed -i --follow-symlinks '/^# >>> mn >>>$/,/^# <<< mn <<<$/d' "$_f"
        fi
        printf "${GREEN}Cleaned:${NC} %s\n" "$_f"
    done <<EOF
$SHELL_FILES
EOF
    # Legacy 1.1 wrapper, written outside any block
    if [ -f "$HOME/.bash_functions" ] && grep -q '^mn()' "$HOME/.bash_functions"; then
        sed -i --follow-symlinks '/^mn()/d' "$HOME/.bash_functions"
        printf "${GREEN}Removed mn function from:${NC} ~/.bash_functions\n"
    fi

    while IFS= read -r _l; do
        if [ -n "$_l" ]; then
            rm -f "$_l" 2>/dev/null || true
            printf "${GREEN}Removed:${NC} %s\n" "$_l"
        fi
    done <<EOF
$COMPS
EOF

    rm -rf "$MN_DIR/lib" "$MN_DIR/modules" "$MN_DIR/completions" "$MN_DIR/lang"
    rm -f  "$MN_DIR/mn" "$MN_DIR/VERSION" "$MN_DIR/manifest"
    printf "${GREEN}%s${NC}\n" "${T_UNINSTALL_REMOVED_CORE:-Core removed.}"
fi

# Configuration: the dotfiles only (lang/ belongs to Core, mn needs it to run)
if [ "$_CHK_CONFIG" -eq 1 ]; then
    rm -f "$MN_DIR/.lang" "$MN_DIR/.editor" "$MN_DIR/.cdn" "$MN_DIR/.repos"
    printf "${GREEN}%s${NC}\n" "${T_UNINSTALL_REMOVED_CONFIG:-Configuration removed.}"
fi

# Data: records and the user's docs
if [ "$_CHK_DATA" -eq 1 ]; then
    rm -rf "$MN_DIR/data" "$MN_DIR/docs"
    printf "${GREEN}%s${NC}\n" "${T_UNINSTALL_REMOVED_DATA:-Data removed.}"
fi

# Plugins
if [ "$_CHK_PLUGINS" -eq 1 ]; then
    rm -rf "$MN_DIR/plugins"
    printf "${GREEN}%s${NC}\n" "${T_UNINSTALL_REMOVED_PLUGINS:-Plugins removed.}"
fi

# Remove the parent dir if everything was selected, but only when it is empty:
# anything else in it was never listed above, so it stays
if [ "$_CHK_CORE" -eq 1 ] && [ "$_CHK_CONFIG" -eq 1 ] && \
   [ "$_CHK_DATA" -eq 1 ] && [ "$_CHK_PLUGINS" -eq 1 ]; then
    if rmdir "$MN_DIR" 2>/dev/null; then
        printf "${GREEN}Removed:${NC} %s\n" "$MN_DIR"
    else
        printf "${YELLOW}%s${NC} %s\n" "${T_UNINSTALL_NOT_EMPTY:-Not empty, kept:}" "$MN_DIR"
    fi
fi

# ─── Done ────────────────────────────────────────────────────────────

if [ "$_CHK_CORE" -eq 1 ]; then
    printf "\n${GREEN}%s${NC}\n" "${T_CONFIG_UNINSTALL_DONE:-mn has been uninstalled. Reload your shell.}"
fi
