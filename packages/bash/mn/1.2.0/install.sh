#!/bin/bash

# mn installer
# Usage: curl -fsSL https://dropr.sylvain.sh/bash/mn@latest/install.sh | sh

set -e

CDN="https://dropr.sylvain.sh/bash"
MN_DIR="$HOME/.config/mn"

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[1;94m'
YELLOW='\033[1;33m'
CYAN='\033[1;36m'
NC='\033[0m'

# ─── Bash-only: logging + interactive pickers ─────────────────────────
# eval protects bash syntax from being parsed by dash/sh at load time.
# Functions defined here are called conditionally further down.

if [ -n "$BASH_VERSION" ]; then
    eval "$(cat <<'BASH_EVAL'
        MN_LOG="/tmp/mn_install_$(date +%Y%m%d_%H%M%S).log"
        exec > >(tee >(sed 's/\x1b\[[0-9;?]*[A-Za-z]//g' >> "$MN_LOG")) 2>&1

        _setup_select() {
            local -a _opts=("$@")
            local _count=${#_opts[@]} _sel=0 _key _i

            printf '\033[?25l'
            for (( _i=0; _i<_count; _i++ )); do
                [[ $_i -eq $_sel ]] \
                    && printf '  \033[7m %s \033[0m\n' "${_opts[$_i]}" \
                    || printf '    %s\n' "${_opts[$_i]}"
            done

            while true; do
                read -rsn1 _key < /dev/tty
                if [[ "$_key" == $'\x1b' ]]; then
                    read -rsn2 -t 0.1 _key < /dev/tty
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
            done < /tmp/mn_lang_index
            printf "${BLUE}Language / Langue:${NC}\n"
            _setup_select "${_labels[@]}"
            LANG_SETTING="${_codes[$_SETUP_CHOICE]}"
            printf "\n"
        }

        _pick_editor() {
            local -a _vals=("vi" "vim" "nano" "zed" "code -n" "__custom__")
            local -a _labels=("vi" "vim" "nano" "zed" "Visual Studio Code" "${T_CONFIG_EDITOR_CUSTOM:-Custom}")
            printf "${BLUE}${T_CONFIG_EDITOR_TITLE:-Editor}:${NC}\n"
            _setup_select "${_labels[@]}"
            EDITOR_SETTING="${_vals[$_SETUP_CHOICE]}"
            EDITOR_LABEL="${_labels[$_SETUP_CHOICE]}"
            if [[ "$EDITOR_SETTING" == "__custom__" ]]; then
                printf "${CYAN}${T_CONFIG_EDITOR_CUSTOM:-Custom}:${NC} "
                read -r EDITOR_SETTING < /dev/tty
                EDITOR_LABEL="$EDITOR_SETTING"
            fi
            printf "\n"
        }
BASH_EVAL
)"
    _INTERACTIVE=true
fi

# ─── Local repo detection ────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd)"
if [ -f "$SCRIPT_DIR/mn" ] && [ -f "$SCRIPT_DIR/manifest" ] && [ -d "$SCRIPT_DIR/lib" ]; then
    LOCAL_REPO="$SCRIPT_DIR"
fi

# ─── Fetch version ────────────────────────────────────────────────────

if [ -n "${LOCAL_REPO:-}" ]; then
    VERSION="$(cat "$LOCAL_REPO/VERSION" 2>/dev/null)"
else
    VERSION="$(curl -fsSL "${CDN}/mn@latest" | grep -o '"version": *"[^"]*"' | head -1 | cut -d'"' -f4)"
fi
if [ -z "$VERSION" ]; then
    printf "${RED}Failed to fetch version${NC}\n"
    exit 1
fi

if [ -n "${LOCAL_REPO:-}" ]; then
    printf "${BLUE}mn %s installer${NC} ${YELLOW}(local)${NC}\n\n" "$VERSION"
else
    printf "${BLUE}mn %s installer${NC}\n\n" "$VERSION"
fi

# ─── Language / Langue ───────────────────────────────────────────────

if [ -n "${LOCAL_REPO:-}" ] && [ -f "$LOCAL_REPO/lang/index" ]; then
    cp "$LOCAL_REPO/lang/index" /tmp/mn_lang_index
else
    curl -fsSL "${CDN}/mn@${VERSION}/lang/index" -o /tmp/mn_lang_index 2>/dev/null || true
fi
if [ ! -s /tmp/mn_lang_index ]; then
    printf "fr:Français\nen:English\n" > /tmp/mn_lang_index
fi

if [ "${_INTERACTIVE:-}" = true ]; then
    _pick_lang
else
    printf "${BLUE}Language / Langue:${NC}\n"
    _i=1
    while IFS=: read -r _code _name; do
        printf "  %s) %s\n" "$_i" "$_name"
        _i=$(( _i + 1 ))
    done < /tmp/mn_lang_index
    printf "${CYAN}Choice [1]:${NC} "
    read -r _LANG_CHOICE < /dev/tty
    [ -z "$_LANG_CHOICE" ] && _LANG_CHOICE=1
    LANG_SETTING=$(sed -n "${_LANG_CHOICE}p" /tmp/mn_lang_index | cut -d: -f1)
    [ -z "$LANG_SETTING" ] && LANG_SETTING="en"
    printf "\n"
fi

# ─── Source language for subsequent prompts ───────────────────────────

if [ -n "${LOCAL_REPO:-}" ] && [ -f "$LOCAL_REPO/lang/${LANG_SETTING}.sh" ]; then
    . "$LOCAL_REPO/lang/${LANG_SETTING}.sh"
else
    curl -fsSL "${CDN}/mn@${VERSION}/lang/${LANG_SETTING}.sh" -o /tmp/mn_lang.sh 2>/dev/null || true
    [ -f /tmp/mn_lang.sh ] && . /tmp/mn_lang.sh
fi

# ─── Editor ──────────────────────────────────────────────────────────

if [ "${_INTERACTIVE:-}" = true ]; then
    _pick_editor
else
    printf "${BLUE}${T_CONFIG_EDITOR_TITLE:-Editor}:${NC}\n"
    printf "  1) vi\n  2) vim\n  3) nano\n  4) zed\n  5) Visual Studio Code\n  6) ${T_CONFIG_EDITOR_CUSTOM:-Custom}\n"
    printf "${CYAN}Choice [1]:${NC} "
    read -r _EDITOR_CHOICE < /dev/tty
    [ -z "$_EDITOR_CHOICE" ] && _EDITOR_CHOICE=1
    case "$_EDITOR_CHOICE" in
        1) EDITOR_SETTING="vi";     EDITOR_LABEL="vi" ;;
        2) EDITOR_SETTING="vim";    EDITOR_LABEL="vim" ;;
        3) EDITOR_SETTING="nano";   EDITOR_LABEL="nano" ;;
        4) EDITOR_SETTING="zed";    EDITOR_LABEL="zed" ;;
        5) EDITOR_SETTING="code -n"; EDITOR_LABEL="Visual Studio Code" ;;
        6)
            printf "${CYAN}${T_CONFIG_EDITOR_CUSTOM:-Custom}:${NC} "
            read -r EDITOR_SETTING < /dev/tty
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
printf "${BLUE}${T_CONFIG_REPOS_TITLE:-Repos folder}:${NC}\n"
printf "${T_CONFIG_REPOS_HINT:-Root under which a bare repo name is resolved.}\n"
printf "${CYAN}${T_CONFIG_REPOS_NEW:-Folder} [~]:${NC} "
read -r _REPOS_CHOICE < /dev/tty
if [ -n "${_REPOS_CHOICE:-}" ]; then
    _REPOS_CHOICE="${_REPOS_CHOICE%/}"
    _REPOS_EXPANDED=$(eval printf '%s' "$_REPOS_CHOICE" 2>/dev/null)
    case "$_REPOS_EXPANDED" in
        "$HOME")   REPOS_ROOT_SETTING="~" ;;
        "$HOME"/*) REPOS_ROOT_SETTING="~${_REPOS_EXPANDED#"$HOME"}" ;;
        *)         REPOS_ROOT_SETTING="$_REPOS_CHOICE" ;;
    esac
fi
printf "\n"

# ─── Create directories ───────────────────────────────────────────────

mkdir -p "$MN_DIR/lib" "$MN_DIR/modules" "$MN_DIR/data" "$MN_DIR/docs" "$MN_DIR/lang" "$MN_DIR/plugins"
printf "${BLUE}Config directory:${NC} %s\n" "$MN_DIR"

# ─── Install files ───────────────────────────────────────────────────

echo "$VERSION" > "$MN_DIR/VERSION"

if [ -n "${LOCAL_REPO:-}" ]; then
    # Copy from local repo
    printf "${BLUE}Installing from local repo...${NC}\n"
    cp "$LOCAL_REPO/mn" "$MN_DIR/mn"
    chmod +x "$MN_DIR/mn"
    printf "${GREEN}mn copied${NC}\n"

    MANIFEST=$(cat "$LOCAL_REPO/manifest" 2>/dev/null || true)
    if [ -n "$MANIFEST" ]; then
        printf '%s\n' "$MANIFEST" > "$MN_DIR/manifest"
        while IFS= read -r file; do
            [ -z "$file" ] && continue
            [ "$file" = "mn" ] && continue
            [ "$file" = "VERSION" ] && continue
            [ ! -f "$LOCAL_REPO/$file" ] && continue
            dir=$(dirname "$file")
            [ "$dir" != "." ] && mkdir -p "$MN_DIR/$dir"
            cp "$LOCAL_REPO/$file" "$MN_DIR/$file"
            printf "${GREEN}${file} copied${NC}\n"
        done <<EOF
$MANIFEST
EOF
    fi

    while IFS=: read -r _code _name; do
        [ -z "$_code" ] && continue
        [ -f "$LOCAL_REPO/lang/${_code}.sh" ] || continue
        cp "$LOCAL_REPO/lang/${_code}.sh" "$MN_DIR/lang/${_code}.sh"
        printf "${GREEN}lang/${_code}.sh copied${NC}\n"
    done < /tmp/mn_lang_index
else
    # Download from CDN
    printf "${BLUE}Downloading mn...${NC}\n"

    if curl -fsSL "${CDN}/mn@${VERSION}/mn" -o "$MN_DIR/mn"; then
        chmod +x "$MN_DIR/mn"
        printf "${GREEN}mn downloaded${NC}\n"
    else
        printf "${RED}Download failed${NC}\n"
        exit 1
    fi

    MANIFEST=$(curl -fsSL "${CDN}/mn@${VERSION}/manifest" 2>/dev/null || true)

    if [ -n "$MANIFEST" ]; then
        echo "$MANIFEST" | while IFS= read -r file; do
            [ -z "$file" ] && continue
            [ "$file" = "mn" ] && continue
            [ "$file" = "VERSION" ] && continue
            dir=$(dirname "$file")
            [ "$dir" != "." ] && mkdir -p "$MN_DIR/$dir"
            if curl -fsSL "${CDN}/mn@${VERSION}/${file}" -o "$MN_DIR/${file}" 2>/dev/null; then
                printf "${GREEN}${file} downloaded${NC}\n"
            fi
        done
        printf '%s\n' "$MANIFEST" > "$MN_DIR/manifest"
    else
        # Fallback: hardcoded file list
        for lib in core crud dat module plugin ui; do
            if curl -fsSL "${CDN}/mn@${VERSION}/lib/${lib}.sh" -o "$MN_DIR/lib/${lib}.sh" 2>/dev/null; then
                printf "${GREEN}lib/${lib}.sh downloaded${NC}\n"
            fi
        done
        for mod in alias config connexions docs funcs repos; do
            if curl -fsSL "${CDN}/mn@${VERSION}/modules/${mod}.sh" -o "$MN_DIR/modules/${mod}.sh" 2>/dev/null; then
                printf "${GREEN}modules/${mod}.sh downloaded${NC}\n"
            fi
        done
    fi

    while IFS=: read -r _code _name; do
        [ -z "$_code" ] && continue
        if curl -fsSL "${CDN}/mn@${VERSION}/lang/${_code}.sh" -o "$MN_DIR/lang/${_code}.sh" 2>/dev/null; then
            printf "${GREEN}lang/${_code}.sh downloaded${NC}\n"
        fi
    done < /tmp/mn_lang_index
fi

rm -f /tmp/mn_lang_index /tmp/mn_lang.sh

# ─── Language setting ─────────────────────────────────────────────────

echo "$LANG_SETTING" > "$MN_DIR/.lang"
printf "${GREEN}Language set to: ${LANG_SETTING}${NC}\n"

echo "$EDITOR_SETTING" > "$MN_DIR/.editor"
printf "${GREEN}Editor set to: ${EDITOR_LABEL:-$EDITOR_SETTING}${NC}\n"

echo "$REPOS_ROOT_SETTING" > "$MN_DIR/.repos"
printf "${GREEN}Repos folder set to: ${REPOS_ROOT_SETTING}${NC}\n"

# ─── Init data files ──────────────────────────────────────────────────

for dat in aliases connexions functions repos; do
    [ ! -f "$MN_DIR/data/${dat}.dat" ] && touch "$MN_DIR/data/${dat}.dat"
done

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

# ─── Done ────────────────────────────────────────────────────────────

[ -n "${MN_LOG:-}" ] && printf "${GREEN}Log:${NC} %s\n" "$MN_LOG"
printf "\n${GREEN}Done!${NC} Run: ${CYAN}mn${NC}\n"
