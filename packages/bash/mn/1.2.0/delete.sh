#!/bin/bash

# mn uninstaller
# Usage: curl -fsSL https://dropr.sylvain.sh/bash/mn@latest/delete.sh | sh

set -e

MN_DIR="$HOME/.config/mn"

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[1;94m'
CYAN='\033[1;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

# ─── Bash-only: interactive picker ───────────────────────────────────

if [ -n "$BASH_VERSION" ]; then
    eval "$(cat <<'BASH_EVAL'
        _checkbox_select() {
            local -a _labels=("$@")
            local _count=${#_labels[@]}
            local _confirm_idx=$_count
            local -a _checked=()
            local _sel=0 _key _i _mark

            # Defaults: index 0 = "all" (off), index 1 = "core" (on), rest off
            for (( _i=0; _i<_count; _i++ )); do _checked[$_i]=0; done
            _checked[1]=1

            _chk_draw() {
                for (( _i=0; _i<_count; _i++ )); do
                    _mark=" "; [[ ${_checked[$_i]} -eq 1 ]] && _mark="✓"
                    printf '\033[K'
                    [[ $_i -eq $_sel ]] \
                        && printf '  \033[7m [%s] %s \033[0m\n' "$_mark" "${_labels[$_i]}" \
                        || printf '    [%s] %s\n' "$_mark" "${_labels[$_i]}"
                done
                printf '\033[K'
                if [[ $_sel -eq $_confirm_idx ]]; then
                    printf '  \033[7m  \xe2\x96\xb8 %s \xe2\x97\x82  \033[0m\n' "${T_CONFIRM:-Confirmer}"
                else
                    printf '    \033[2m[ %s ]\033[0m\n' "${T_CONFIRM:-Confirmer}"
                fi
                printf '\033[K\n  %s\n' "${T_UNINSTALL_FOOTER:-↑↓/jk: move  space/enter: toggle  q: cancel}"
            }

            _chk_toggle() {
                _checked[$_sel]=$(( 1 - ${_checked[$_sel]} ))
                if [[ $_sel -eq 0 ]]; then
                    local _v=${_checked[0]}
                    for (( _i=1; _i<_count; _i++ )); do _checked[$_i]=$_v; done
                else
                    [[ ${_checked[$_sel]} -eq 0 ]] && _checked[0]=0
                    local _a=1
                    for (( _i=1; _i<_count; _i++ )); do
                        [[ ${_checked[$_i]} -eq 0 ]] && _a=0
                    done
                    _checked[0]=$_a
                fi
            }

            printf '\033[?25l'
            _chk_draw

            while true; do
                read -rsn1 _key < /dev/tty
                if [[ "$_key" == $'\x1b' ]]; then
                    read -rsn2 -t 0.1 _key < /dev/tty
                    case "$_key" in
                        '[A') _sel=$(( _sel - 1 )); [[ $_sel -lt 0 ]] && _sel=$_confirm_idx ;;
                        '[B') _sel=$(( _sel + 1 )); [[ $_sel -gt $_confirm_idx ]] && _sel=0 ;;
                        '[C'|'[D') ;;
                    esac
                else
                    case "$_key" in
                        k) _sel=$(( _sel - 1 )); [[ $_sel -lt 0 ]] && _sel=$_confirm_idx ;;
                        j) _sel=$(( _sel + 1 )); [[ $_sel -gt $_confirm_idx ]] && _sel=0 ;;
                        ' '|''|$'\n')
                            if [[ $_sel -eq $_confirm_idx ]]; then
                                printf '\033[?25h'
                                _CHK_CORE=${_checked[1]}
                                _CHK_CONFIG=${_checked[2]}
                                _CHK_DATA=${_checked[3]}
                                _CHK_PLUGINS=${_checked[4]}
                                return 0
                            else
                                _chk_toggle
                            fi
                            ;;
                        a)
                            local _new_val=$(( 1 - ${_checked[0]} ))
                            for (( _i=0; _i<_count; _i++ )); do _checked[$_i]=$_new_val; done
                            ;;
                        q) printf '\033[?25h'; return 1 ;;
                    esac
                fi

                for (( _i=0; _i<_count+3; _i++ )); do printf '\033[A'; done
                printf '\033[G'
                _chk_draw
            done
        }
BASH_EVAL
)"
    _INTERACTIVE=true
fi

# ─── Load saved language (default: en) ───────────────────────────────

_MN_LANG="en"
[ -f "$MN_DIR/.lang" ] && _MN_LANG=$(cat "$MN_DIR/.lang")
[ -f "$MN_DIR/lang/${_MN_LANG}.sh" ] && . "$MN_DIR/lang/${_MN_LANG}.sh"

printf "${BLUE}mn uninstaller${NC}\n\n"

if [ ! -d "$MN_DIR" ]; then
    printf "${YELLOW}mn is not installed.${NC}\n"
    exit 0
fi

# ─── Checkbox menu ───────────────────────────────────────────────────

printf "${RED}${T_UNINSTALL_SELECT:-What do you want to remove?}${NC}\n\n"

if [ "${_INTERACTIVE:-}" = true ]; then
    _checkbox_select \
        "${T_UNINSTALL_ALL:-Remove everything}" \
        "${T_UNINSTALL_CORE:-Core (mn, lib, modules)}" \
        "${T_UNINSTALL_CONFIG:-Configuration (.lang, .editor)}" \
        "${T_UNINSTALL_DATA:-Data (aliases, repos, ...)}" \
        "${T_UNINSTALL_PLUGINS:-Plugins}"

    [ $? -ne 0 ] && printf "${BLUE}${T_CANCEL:-Cancelled.}${NC}\n" && exit 0

    if [ "${_CHK_CORE:-0}" -eq 0 ] && [ "${_CHK_CONFIG:-0}" -eq 0 ] && \
       [ "${_CHK_DATA:-0}" -eq 0 ] && [ "${_CHK_PLUGINS:-0}" -eq 0 ]; then
        printf "${BLUE}${T_CANCEL:-Cancelled.}${NC}\n"
        exit 0
    fi
else
    printf "${CYAN}${T_YES:-Yes} / ${T_NO:-No} [N]:${NC} "
    read -r CONFIRM < /dev/tty
    case "$CONFIRM" in
        y|Y|yes|YES|oui|OUI) _CHK_CORE=1; _CHK_CONFIG=1; _CHK_DATA=1; _CHK_PLUGINS=1 ;;
        *) printf "${BLUE}${T_CANCEL:-Cancelled.}${NC}\n"; exit 0 ;;
    esac
fi

printf "\n"

# ─── Selective removal ───────────────────────────────────────────────

# Core: symlink + shell PATH + lib/ modules/ completions/ docs/ mn VERSION manifest
if [ "${_CHK_CORE:-0}" -eq 1 ]; then
    for bin_dir in /usr/local/bin "$HOME/.local/bin" "$HOME/bin"; do
        if [ -L "$bin_dir/mn" ]; then
            if rm -f "$bin_dir/mn" 2>/dev/null; then
                printf "${GREEN}Removed symlink:${NC} %s/mn\n" "$bin_dir"
            else
                printf "${YELLOW}Skipped:${NC} %s/mn (permission denied)\n" "$bin_dir"
            fi
        fi
    done
    rm -rf "$MN_DIR/lib" "$MN_DIR/modules" "$MN_DIR/completions" "$MN_DIR/docs"
    rm -f  "$MN_DIR/mn" "$MN_DIR/VERSION" "$MN_DIR/manifest"
    printf "${GREEN}${T_UNINSTALL_REMOVED_CORE:-Core removed.}${NC}\n"

    for rc in "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile" "$HOME/.zshrc"; do
        if [ -f "$rc" ] && grep -q "# Added by mn installer" "$rc"; then
            sed -i '/# Added by mn installer/d;/export PATH=.*mn/d' "$rc"
            printf "${GREEN}Cleaned:${NC} %s\n" "$rc"
        fi
    done

    if [ -f "$HOME/.bash_functions" ] && grep -q "mn()" "$HOME/.bash_functions"; then
        sed -i '/^mn()/d' "$HOME/.bash_functions"
        printf "${GREEN}Removed mn function from:${NC} ~/.bash_functions\n"
    fi
fi

# Configuration: .lang .editor .cdn .repos lang/
if [ "${_CHK_CONFIG:-0}" -eq 1 ]; then
    rm -f  "$MN_DIR/.lang" "$MN_DIR/.editor" "$MN_DIR/.cdn" "$MN_DIR/.repos"
    rm -rf "$MN_DIR/lang"
    printf "${GREEN}${T_UNINSTALL_REMOVED_CONFIG:-Configuration removed.}${NC}\n"
fi

# Data: data/*.dat
if [ "${_CHK_DATA:-0}" -eq 1 ]; then
    rm -rf "$MN_DIR/data"
    printf "${GREEN}${T_UNINSTALL_REMOVED_DATA:-Data removed.}${NC}\n"
fi

# Plugins
if [ "${_CHK_PLUGINS:-0}" -eq 1 ]; then
    rm -rf "$MN_DIR/plugins"
    printf "${GREEN}${T_UNINSTALL_REMOVED_PLUGINS:-Plugins removed.}${NC}\n"
fi

# Remove parent dir if everything was selected
if [ "${_CHK_CORE:-0}" -eq 1 ] && [ "${_CHK_CONFIG:-0}" -eq 1 ] && \
   [ "${_CHK_DATA:-0}" -eq 1 ] && [ "${_CHK_PLUGINS:-0}" -eq 1 ]; then
    rm -rf "$MN_DIR"
    printf "${GREEN}Removed:${NC} %s\n" "$MN_DIR"
fi

# ─── Done ────────────────────────────────────────────────────────────

printf "\n${GREEN}${T_CONFIG_UNINSTALL_DONE:-mn has been uninstalled. Reload your shell.}${NC}\n"
