#!/bin/bash

# mn installer
# Usage: curl -fsSL https://dropr.sylvain.sh/bash/mn@latest/install.sh | sh

set -e

# MN_INSTALL_CDN installs from another source (a mirror, or file:// for tests).
# Same rule as `mn update`: the installer runs what it downloads, so https or file only.
CDN="${MN_INSTALL_CDN:-https://dropr.sylvain.sh/bash}"
CDN="${CDN%/}"
MN_DIR="$HOME/.config/mn"

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[1;94m'
YELLOW='\033[1;33m'
CYAN='\033[1;36m'
NC='\033[0m'

case "$CDN" in
    https://*|file://*) ;;
    *)
        printf "${RED}The source must use https:// (or file://): %s${NC}\n" "$CDN"
        exit 1
        ;;
esac

# Private working directory: never a fixed /tmp path another user could plant.
# Every file created in it is listed in "all" first, so the cleanup removes
# exactly those files (no glob, no recursion) and then the directory.
TMPD=$(mktemp -d) || { printf "${RED}Cannot create a temporary directory${NC}\n"; exit 1; }
_track() {
    printf '%s\n' "$1" >> "$TMPD/all"
}
_cleanup() {
    # A picker hides the cursor: give it back however the script ends (Ctrl-C too).
    # Straight to the terminal, the stdout tee may already be gone.
    { printf '\033[?25h' > /dev/tty; } 2>/dev/null || true
    [ -n "${TMPD:-}" ] && [ -d "$TMPD" ] || return 0
    if [ -f "$TMPD/all" ]; then
        while IFS= read -r _t; do
            rm -f -- "$_t"
        done < "$TMPD/all"
    fi
    rm -f -- "$TMPD/all"
    rmdir "$TMPD" 2>/dev/null || true
}
trap _cleanup EXIT
trap 'exit 1' INT TERM HUP

# The editor command is pasted as shell text into the generated repo aliases:
# no shell metacharacter and no quote. Same rule as `mn config`.
_editor_ok() {
    case "$1" in
        *\;*|*\|*|*\&*|*\$*|*\`*|*\<*|*\>*|*\(*|*\)*|*\\*|*\"*|*\'*) return 1 ;;
    esac
    return 0
}

# ─── Bash-only: logging + interactive pickers ─────────────────────────
# eval protects bash syntax from being parsed by dash/sh at load time.
# Functions defined here are called conditionally further down.

if [ -n "$BASH_VERSION" ]; then
    eval "$(cat <<'BASH_EVAL'
        MN_LOG=$(mktemp --suffix=.log 2>/dev/null || mktemp)
        exec > >(tee >(sed 's/\x1b\[[0-9;?]*[A-Za-z]//g' >> "$MN_LOG")) 2>&1

        _setup_select() {
            local -a _opts=("$@")
            local _count=${#_opts[@]} _sel=${_SETUP_DEFAULT:-0} _key _i
            [[ $_sel -ge 0 && $_sel -lt $_count ]] || _sel=0

            printf '\033[?25l'
            for (( _i=0; _i<_count; _i++ )); do
                [[ $_i -eq $_sel ]] \
                    && printf '  \033[7m %s \033[0m\n' "${_opts[$_i]}" \
                    || printf '    %s\n' "${_opts[$_i]}"
            done

            while true; do
                read -rsn1 _key < /dev/tty
                if [[ "$_key" == $'\x1b' ]]; then
                    # A lone Escape times out (rc > 128): no key, not a failure under set -e
                    read -rsn2 -t 0.1 _key < /dev/tty || _key=""
                    case "$_key" in
                        '[A') _sel=$(( _sel - 1 )); [[ $_sel -lt 0 ]] && _sel=$(( _count - 1 )) ;;
                        '[B') _sel=$(( _sel + 1 )); [[ $_sel -ge _count ]] && _sel=0 ;;
                    esac
                else
                    case "$_key" in
                        k) _sel=$(( _sel - 1 )); [[ $_sel -lt 0 ]] && _sel=$(( _count - 1 )) ;;
                        j) _sel=$(( _sel + 1 )); [[ $_sel -ge _count ]] && _sel=0 ;;
                        ''|$'\n') break ;;
                    esac
                fi
                for (( _i=0; _i<_count; _i++ )); do printf '\033[A'; done
                for (( _i=0; _i<_count; _i++ )); do
                    printf '\033[K'
                    [[ $_i -eq $_sel ]] \
                        && printf '  \033[7m %s \033[0m\n' "${_opts[$_i]}" \
                        || printf '    %s\n' "${_opts[$_i]}"
                done
            done

            printf '\033[?25h'
            _SETUP_CHOICE=$_sel
        }

        _pick_lang() {
            local -a _labels=() _codes=()
            while IFS=: read -r _code _name; do
                _codes+=("$_code")
                _labels+=("$_name")
            done < "$TMPD/lang_codes"
            local _n=0 _c
            _SETUP_DEFAULT=0
            for _c in "${_codes[@]}"; do
                [[ "$_c" == "$_OLD_LANG" ]] && _SETUP_DEFAULT=$_n
                _n=$(( _n + 1 ))
            done
            printf "${BLUE}Language / Langue:${NC}\n"
            _setup_select "${_labels[@]}"
            LANG_SETTING="${_codes[$_SETUP_CHOICE]}"
            printf "\n"
        }

        _pick_editor() {
            local -a _vals=("vi" "vim" "nano" "zed" "code -n" "__custom__")
            local -a _labels=("vi" "vim" "nano" "zed" "Visual Studio Code" "${T_CONFIG_EDITOR_CUSTOM:-Custom}")
            local _n=0 _v _old_custom=""
            _SETUP_DEFAULT=0
            # A reinstall starts on the current editor; one that is not listed is "custom"
            if [[ -n "$_OLD_EDITOR" ]]; then
                _SETUP_DEFAULT=$(( ${#_vals[@]} - 1 ))
                _old_custom="$_OLD_EDITOR"
                for _v in "${_vals[@]}"; do
                    if [[ "$_v" == "$_OLD_EDITOR" ]]; then _SETUP_DEFAULT=$_n; _old_custom=""; fi
                    _n=$(( _n + 1 ))
                done
            fi
            printf "${BLUE}${T_CONFIG_EDITOR_TITLE:-Editor}:${NC}\n"
            _setup_select "${_labels[@]}"
            EDITOR_SETTING="${_vals[$_SETUP_CHOICE]}"
            EDITOR_LABEL="${_labels[$_SETUP_CHOICE]}"
            if [[ "$EDITOR_SETTING" == "__custom__" ]]; then
                while true; do
                    if [[ -n "$_old_custom" ]]; then
                        printf "${CYAN}%s [%s]:${NC} " "${T_CONFIG_EDITOR_CUSTOM:-Custom}" "$_old_custom"
                    else
                        printf "${CYAN}${T_CONFIG_EDITOR_CUSTOM:-Custom}:${NC} "
                    fi
                    read -r EDITOR_SETTING < /dev/tty
                    [[ -z "$EDITOR_SETTING" ]] && EDITOR_SETTING="$_old_custom"
                    _editor_ok "$EDITOR_SETTING" && break
                    printf "${RED}✗ %s${NC}\n" "${T_CONFIG_EDITOR_CHARS:-character not allowed in an editor command}"
                done
                EDITOR_LABEL="$EDITOR_SETTING"
            fi
            printf "\n"
        }
BASH_EVAL
)"
    _INTERACTIVE=true
fi

# ─── Local repo detection ────────────────────────────────────────────

# Local mode only when this very file is run from a checkout (`sh install.sh`,
# `./install.sh`). Piped from curl, $0 is the shell and the current directory
# says nothing. A checkout that IS the install directory is never "local".
LOCAL_REPO=""
if [ -f "$0" ] && [ "${0##*/}" = install.sh ]; then
    SCRIPT_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd -P)" || SCRIPT_DIR=""
    if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/mn" ] && [ -f "$SCRIPT_DIR/manifest" ] && [ -d "$SCRIPT_DIR/lib" ]; then
        INSTALLED_DIR="$(cd "$MN_DIR" 2>/dev/null && pwd -P)" || INSTALLED_DIR=""
        if [ "$SCRIPT_DIR" != "$INSTALLED_DIR" ]; then
            LOCAL_REPO="$SCRIPT_DIR"
        fi
    fi
fi

# ─── Fetch version ────────────────────────────────────────────────────

if [ -n "$LOCAL_REPO" ]; then
    VERSION="$(cat "$LOCAL_REPO/VERSION" 2>/dev/null || true)"
else
    VERSION="$(curl -fsSL --connect-timeout 10 --max-time 60 "${CDN}/mn@latest" 2>/dev/null | grep -o '"version": *"[^"]*"' | head -1 | cut -d'"' -f4)"
fi
# The value becomes part of URLs and of the VERSION file: a plain version only
if ! printf '%s' "$VERSION" | grep -Eq '^[0-9]+(\.[0-9]+){0,2}(-[A-Za-z0-9.]+)?$'; then
    printf "${RED}Failed to fetch version${NC}\n"
    exit 1
fi

if [ -n "$LOCAL_REPO" ]; then
    printf "${BLUE}mn %s installer${NC} ${YELLOW}(local)${NC}\n\n" "$VERSION"
else
    printf "${BLUE}mn %s installer${NC}\n\n" "$VERSION"
fi

# ─── Download everything first ───────────────────────────────────────
# Nothing under $MN_DIR is touched until every file is here and non-empty. A
# failure lists the files and stops: no half installed tree, no "Done!".

# Copy from the local repo or download from the CDN: _fetch RELATIVE_PATH DEST
_fetch() {
    if [ -n "$LOCAL_REPO" ]; then
        cp "$LOCAL_REPO/$1" "$2" 2>/dev/null
    else
        curl -fsSL --connect-timeout 10 --max-time 60 "${CDN}/mn@${VERSION}/$1" -o "$2" 2>/dev/null
    fi
}

# Anything bash will run must at least parse
_syntax_ok() {
    case "$1" in
        mn|*.sh|*.bash) ;;
        *) return 0 ;;
    esac
    command -v bash >/dev/null 2>&1 || return 0
    bash -n "$2" 2>/dev/null
}

: > "$TMPD/map"
: > "$TMPD/failed"
_track "$TMPD/map"
_track "$TMPD/failed"
_N=0

# _stage RELATIVE_PATH [DEST]: fetch into the private directory and record it
_stage() {
    _N=$((_N + 1))
    _dest="${2:-$TMPD/f$_N}"
    _track "$_dest"
    if _fetch "$1" "$_dest" && [ -s "$_dest" ] && _syntax_ok "$1" "$_dest"; then
        printf '%s %s\n' "$_dest" "$1" >> "$TMPD/map"
        printf "${GREEN}%s ready${NC}\n" "$1"
    else
        printf '%s\n' "$1" >> "$TMPD/failed"
        printf "${RED}✗ %s${NC}\n" "$1"
    fi
}

if [ -n "$LOCAL_REPO" ]; then
    printf "${BLUE}Installing from local repo...${NC}\n"
else
    printf "${BLUE}Downloading mn...${NC}\n"
fi

# Language index: the codes become file names, so two letters only
_track "$TMPD/lang_index"
_track "$TMPD/lang_codes"
_fetch lang/index "$TMPD/lang_index" || true
grep -E '^[a-z]{2}:' "$TMPD/lang_index" > "$TMPD/lang_codes" 2>/dev/null || true
if [ ! -s "$TMPD/lang_codes" ]; then
    printf "fr:Français\nen:English\n" > "$TMPD/lang_codes"
fi

if [ -n "$LOCAL_REPO" ]; then
    MANIFEST=$(cat "$LOCAL_REPO/manifest" 2>/dev/null || true)
else
    MANIFEST=$(curl -fsSL --connect-timeout 10 --max-time 60 "${CDN}/mn@${VERSION}/manifest" 2>/dev/null || true)
fi
if [ -z "$MANIFEST" ]; then
    # No manifest served: built-in list, kept in sync with ./manifest
    MANIFEST="mn
completions/mn.bash
completions/_mn
lib/core.sh
lib/crud.sh
lib/dat.sh
lib/module.sh
lib/plugin.sh
lib/ui.sh
lib/update.sh
modules/alias.sh
modules/config.sh
modules/connexions.sh
modules/docs.sh
modules/funcs.sh
modules/repos.sh"
fi

_stage mn
while IFS= read -r _file; do
    case "$_file" in
        ''|mn|VERSION) continue ;;
    esac
    # No absolute path, no "..", nothing but plain path characters
    case "$_file" in
        /*|*..*) printf '%s\n' "$_file" >> "$TMPD/failed"; continue ;;
    esac
    if ! printf '%s' "$_file" | grep -Eq '^[A-Za-z0-9_./-]+$'; then
        printf '%s\n' "$_file" >> "$TMPD/failed"
        continue
    fi
    _stage "$_file"
done <<EOF
$MANIFEST
EOF

while IFS=: read -r _code _name; do
    [ -z "$_code" ] && continue
    _stage "lang/${_code}.sh" "$TMPD/lang_${_code}"
done < "$TMPD/lang_codes"

if [ -s "$TMPD/failed" ]; then
    printf "\n${RED}Download incomplete, nothing was installed. Missing or invalid:${NC}\n"
    while IFS= read -r _file; do
        printf "  ${RED}✗${NC} %s\n" "$_file"
    done < "$TMPD/failed"
    exit 1
fi
printf "\n"

# ─── Current settings ────────────────────────────────────────────────

# A reinstall offers what is already configured as the default answer, so
# pressing Enter through the prompts keeps the settings instead of resetting them.
_OLD_LANG=""; _OLD_EDITOR=""; _OLD_REPOS=""
[ -f "$MN_DIR/.lang" ] && _OLD_LANG=$(head -n 1 "$MN_DIR/.lang" 2>/dev/null || true)
[ -f "$MN_DIR/.editor" ] && _OLD_EDITOR=$(head -n 1 "$MN_DIR/.editor" 2>/dev/null || true)
[ -f "$MN_DIR/.repos" ] && _OLD_REPOS=$(head -n 1 "$MN_DIR/.repos" 2>/dev/null || true)
# The language code is matched against the index: two letters only
case "$_OLD_LANG" in
    [a-z][a-z]) ;;
    *) _OLD_LANG="" ;;
esac

# ─── Language / Langue ───────────────────────────────────────────────

if [ "${_INTERACTIVE:-}" = true ]; then
    _pick_lang
else
    printf "${BLUE}Language / Langue:${NC}\n"
    _i=1
    while IFS=: read -r _code _name; do
        printf "  %s) %s\n" "$_i" "$_name"
        _i=$(( _i + 1 ))
    done < "$TMPD/lang_codes"
    _LANG_DEFAULT=1
    if [ -n "$_OLD_LANG" ]; then
        _LANG_DEFAULT=$(cut -d: -f1 "$TMPD/lang_codes" | grep -nx "$_OLD_LANG" | head -n 1 | cut -d: -f1)
        [ -n "$_LANG_DEFAULT" ] || _LANG_DEFAULT=1
    fi
    printf "${CYAN}Choice [%s]:${NC} " "$_LANG_DEFAULT"
    read -r _LANG_CHOICE < /dev/tty
    # The answer goes into sed: digits only
    case "$_LANG_CHOICE" in
        ''|*[!0-9]*) _LANG_CHOICE="$_LANG_DEFAULT" ;;
    esac
    LANG_SETTING=$(sed -n "${_LANG_CHOICE}p" "$TMPD/lang_codes" | cut -d: -f1)
    [ -z "$LANG_SETTING" ] && LANG_SETTING="en"
    printf "\n"
fi

# ─── Source language for subsequent prompts ───────────────────────────

# The language file is already staged and checked
if [ -f "$TMPD/lang_${LANG_SETTING}" ]; then
    . "$TMPD/lang_${LANG_SETTING}"
fi

# ─── Editor ──────────────────────────────────────────────────────────

if [ "${_INTERACTIVE:-}" = true ]; then
    _pick_editor
else
    printf "${BLUE}${T_CONFIG_EDITOR_TITLE:-Editor}:${NC}\n"
    printf "  1) vi\n  2) vim\n  3) nano\n  4) zed\n  5) Visual Studio Code\n  6) ${T_CONFIG_EDITOR_CUSTOM:-Custom}\n"
    _EDITOR_DEFAULT=1
    _OLD_CUSTOM=""
    case "$_OLD_EDITOR" in
        '')        ;;
        vi)        _EDITOR_DEFAULT=1 ;;
        vim)       _EDITOR_DEFAULT=2 ;;
        nano)      _EDITOR_DEFAULT=3 ;;
        zed)       _EDITOR_DEFAULT=4 ;;
        'code -n') _EDITOR_DEFAULT=5 ;;
        *)         _EDITOR_DEFAULT=6; _OLD_CUSTOM="$_OLD_EDITOR" ;;
    esac
    printf "${CYAN}Choice [%s]:${NC} " "$_EDITOR_DEFAULT"
    read -r _EDITOR_CHOICE < /dev/tty
    [ -z "$_EDITOR_CHOICE" ] && _EDITOR_CHOICE="$_EDITOR_DEFAULT"
    case "$_EDITOR_CHOICE" in
        1) EDITOR_SETTING="vi";     EDITOR_LABEL="vi" ;;
        2) EDITOR_SETTING="vim";    EDITOR_LABEL="vim" ;;
        3) EDITOR_SETTING="nano";   EDITOR_LABEL="nano" ;;
        4) EDITOR_SETTING="zed";    EDITOR_LABEL="zed" ;;
        5) EDITOR_SETTING="code -n"; EDITOR_LABEL="Visual Studio Code" ;;
        6)
            while true; do
                if [ -n "$_OLD_CUSTOM" ]; then
                    printf "${CYAN}%s [%s]:${NC} " "${T_CONFIG_EDITOR_CUSTOM:-Custom}" "$_OLD_CUSTOM"
                else
                    printf "${CYAN}${T_CONFIG_EDITOR_CUSTOM:-Custom}:${NC} "
                fi
                read -r EDITOR_SETTING < /dev/tty
                [ -z "$EDITOR_SETTING" ] && EDITOR_SETTING="$_OLD_CUSTOM"
                _editor_ok "$EDITOR_SETTING" && break
                printf "${RED}✗ %s${NC}\n" "${T_CONFIG_EDITOR_CHARS:-character not allowed in an editor command}"
            done
            EDITOR_LABEL="$EDITOR_SETTING"
            ;;
        *) EDITOR_SETTING="vi"; EDITOR_LABEL="vi" ;;
    esac
    printf "\n"
fi

# ─── Repos root ──────────────────────────────────────────────────────

# Root under which a bare repo name is expanded. Asked, never assumed: the
# package must not ship one person's directory layout as a default.
REPOS_ROOT_SETTING="~"
[ -n "$_OLD_REPOS" ] && REPOS_ROOT_SETTING="$_OLD_REPOS"
printf "${BLUE}${T_CONFIG_REPOS_TITLE:-Repos folder}:${NC}\n"
printf "${T_CONFIG_REPOS_HINT:-Root under which a bare repo name is resolved.}\n"
# Same rule as `mn config`: /abs, ~ or ~/x. A relative folder would move with the
# current directory and ~user is never expanded, so both are asked again.
while true; do
    printf "${CYAN}%s [%s]:${NC} " "${T_CONFIG_REPOS_NEW:-Folder}" "$REPOS_ROOT_SETTING"
    read -r _REPOS_CHOICE < /dev/tty
    [ -n "${_REPOS_CHOICE:-}" ] || break
    _REPOS_CHOICE="${_REPOS_CHOICE%/}"
    # Only a leading ~ or $HOME is expanded, and never evaluated: spaces and
    # shell syntax in a folder name stay exactly as typed
    _p='~/'; _q='$HOME/'; _r='${HOME}/'
    case "$_REPOS_CHOICE" in
        '~')          _REPOS_EXPANDED="$HOME" ;;
        '~/'*)        _REPOS_EXPANDED="$HOME/${_REPOS_CHOICE#"$_p"}" ;;
        '$HOME')      _REPOS_EXPANDED="$HOME" ;;
        '$HOME/'*)    _REPOS_EXPANDED="$HOME/${_REPOS_CHOICE#"$_q"}" ;;
        '${HOME}')    _REPOS_EXPANDED="$HOME" ;;
        '${HOME}/'*)  _REPOS_EXPANDED="$HOME/${_REPOS_CHOICE#"$_r"}" ;;
        *)            _REPOS_EXPANDED="$_REPOS_CHOICE" ;;
    esac
    case "$_REPOS_EXPANDED" in
        /*) ;;
        *)
            printf "${RED}✗ %s${NC}\n" "${T_CONFIG_REPOS_ABSOLUTE:-absolute path required (starts with / or ~)}"
            continue
            ;;
    esac
    case "$_REPOS_EXPANDED" in
        "$HOME")   REPOS_ROOT_SETTING="~" ;;
        "$HOME"/*) REPOS_ROOT_SETTING="~${_REPOS_EXPANDED#"$HOME"}" ;;
        *)         REPOS_ROOT_SETTING="$_REPOS_CHOICE" ;;
    esac
    if [ ! -d "$_REPOS_EXPANDED" ]; then
        printf "${YELLOW}%s %s${NC}\n" "${T_CONFIG_REPOS_MISSING:-This folder does not exist.}" "$_REPOS_EXPANDED"
    fi
    break
done
printf "\n"

# ─── Create directories ───────────────────────────────────────────────

mkdir -p "$MN_DIR/lib" "$MN_DIR/modules" "$MN_DIR/data" "$MN_DIR/docs" "$MN_DIR/lang" "$MN_DIR/plugins"
printf "${BLUE}Config directory:${NC} %s\n" "$MN_DIR"

# ─── Install files ───────────────────────────────────────────────────

# Copy next to the target, then rename: the file gets a new inode, so an mn that
# is running keeps reading the old one instead of a half-written file.
_install_file() {
    _d=$(dirname "$2")
    if [ "$_d" != . ]; then
        mkdir -p "$MN_DIR/$_d" || return 1
    fi
    cp "$1" "$MN_DIR/$2.new" || return 1
    if [ "$2" = mn ]; then
        chmod +x "$MN_DIR/$2.new" || return 1
    fi
    mv -f "$MN_DIR/$2.new" "$MN_DIR/$2"
}

while IFS=' ' read -r _dest _rel; do
    if _install_file "$_dest" "$_rel"; then
        printf "${GREEN}%s installed${NC}\n" "$_rel"
    else
        printf "${RED}✗ %s${NC}\n" "$_rel"
        printf "${RED}Install failed, VERSION left untouched: run the installer again.${NC}\n"
        exit 1
    fi
done < "$TMPD/map"

printf '%s\n' "$MANIFEST" > "$MN_DIR/manifest.new" && mv -f "$MN_DIR/manifest.new" "$MN_DIR/manifest"
# VERSION last: until it changes, a failed run can simply be repeated
printf '%s\n' "$VERSION" > "$MN_DIR/VERSION.new" && mv -f "$MN_DIR/VERSION.new" "$MN_DIR/VERSION"

# ─── Language setting ─────────────────────────────────────────────────

echo "$LANG_SETTING" > "$MN_DIR/.lang"
printf "${GREEN}Language set to: %s${NC}\n" "$LANG_SETTING"

echo "$EDITOR_SETTING" > "$MN_DIR/.editor"
printf "${GREEN}Editor set to: %s${NC}\n" "${EDITOR_LABEL:-$EDITOR_SETTING}"

echo "$REPOS_ROOT_SETTING" > "$MN_DIR/.repos"
printf "${GREEN}Repos folder set to: %s${NC}\n" "$REPOS_ROOT_SETTING"

# ─── Init data files ──────────────────────────────────────────────────

for dat in aliases connexions functions repos; do
    [ ! -f "$MN_DIR/data/${dat}.dat" ] && touch "$MN_DIR/data/${dat}.dat"
done

# ─── Shell files ─────────────────────────────────────────────────────

# Generate ~/.bash_aliases and ~/.bash_functions (inside mn's marked block). A name
# that cannot be written safely is only a warning: the install itself is done.
if ! bash -c '. "$HOME/.config/mn/lib/core.sh"; regenerate_bash_files'; then
    printf "${YELLOW}Some shell files were not fully generated, see above${NC}\n"
fi

# ─── Install completions ─────────────────────────────────────────────

if [ -f "$MN_DIR/completions/mn.bash" ]; then
    if [ -w "/usr/share/bash-completion/completions" ]; then
        BASH_COMP_DIR="/usr/share/bash-completion/completions"
    else
        BASH_COMP_DIR="$HOME/.local/share/bash-completion/completions"
        mkdir -p "$BASH_COMP_DIR"
    fi
    cp "$MN_DIR/completions/mn.bash" "$BASH_COMP_DIR/mn"
    printf "${GREEN}bash completion installed${NC}\n"
fi

if [ -f "$MN_DIR/completions/_mn" ]; then
    if [ -w "/usr/share/zsh/vendor-completions" ]; then
        ZSH_COMP_DIR="/usr/share/zsh/vendor-completions"
    else
        ZSH_COMP_DIR="$HOME/.local/share/zsh/site-functions"
        mkdir -p "$ZSH_COMP_DIR"
    fi
    cp "$MN_DIR/completions/_mn" "$ZSH_COMP_DIR/_mn"
    printf "${GREEN}zsh completion installed${NC}\n"
fi

# ─── Install directory ───────────────────────────────────────────────

if [ -w "/usr/local/bin" ]; then
    INSTALL_DIR="/usr/local/bin"
elif [ -w "$HOME/.local/bin" ]; then
    INSTALL_DIR="$HOME/.local/bin"
    mkdir -p "$INSTALL_DIR"
else
    INSTALL_DIR="$HOME/bin"
    mkdir -p "$INSTALL_DIR"
fi

printf "${BLUE}Install directory:${NC} %s\n" "$INSTALL_DIR"

ln -sf "$MN_DIR/mn" "$INSTALL_DIR/mn"
printf "${GREEN}mn installed${NC}\n"

# ─── PATH ────────────────────────────────────────────────────────────

case ":$PATH:" in
    *":$INSTALL_DIR:"*) ;;
    *)
        SHELL_CONFIG=""
        if [ -n "${ZSH_VERSION:-}" ]; then
            SHELL_CONFIG="$HOME/.zshrc"
        elif [ -f "$HOME/.bashrc" ]; then
            SHELL_CONFIG="$HOME/.bashrc"
        elif [ -f "$HOME/.bash_profile" ]; then
            SHELL_CONFIG="$HOME/.bash_profile"
        elif [ -f "$HOME/.profile" ]; then
            SHELL_CONFIG="$HOME/.profile"
        fi

        if [ -n "$SHELL_CONFIG" ]; then
            printf "\n# Added by mn installer\nexport PATH=\"%s:\$PATH\"\n" "$INSTALL_DIR" >> "$SHELL_CONFIG"
            printf "${YELLOW}PATH updated in %s — reload your shell${NC}\n" "$SHELL_CONFIG"
        else
            printf "${YELLOW}Add to your shell config: export PATH=\"%s:\$PATH\"${NC}\n" "$INSTALL_DIR"
        fi
        ;;
esac

# ─── Shell integration (bash) ────────────────────────────────────────

# The aliases and the mn() wrapper live in ~/.bash_aliases: make sure bash reads
# it. Distros that already source it (Debian, Ubuntu) are left alone; elsewhere
# one marked block is added, even when ~/.bashrc does not exist yet.
if ! grep -q 'bash_aliases' "$HOME/.bashrc" 2>/dev/null; then
    printf '\n# >>> mn >>>\n[ -f ~/.bash_aliases ] && . ~/.bash_aliases\n# <<< mn <<<\n' >> "$HOME/.bashrc"
    printf "${YELLOW}~/.bashrc now loads ~/.bash_aliases — reload your shell${NC}\n"
fi

# ─── Done ────────────────────────────────────────────────────────────

[ -n "${MN_LOG:-}" ] && printf "${GREEN}Log:${NC} %s\n" "$MN_LOG"
printf "\n${GREEN}Done!${NC} Run: ${CYAN}mn${NC}\n"
