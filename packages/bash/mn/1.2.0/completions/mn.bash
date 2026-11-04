# Bash completion for mn
# Source this file or install to ~/.local/share/bash-completion/completions/mn

_mn_conn_handles() {
    local f="$HOME/.config/mn/data/connexions.dat"
    [[ -f "$f" ]] || return
    awk -F':::' '!/^#/ && NF > 1 {
        print $1
        if ($5 != "") { n = split($5, a, ","); for (i = 1; i <= n; i++) print a[i] }
    }' "$f"
}

_mn_conn_users() {
    local f="$HOME/.config/mn/data/connexions.dat"
    { [[ -f "$f" ]] && awk -F':::' '!/^#/ && $4 != "" { print $4 }' "$f"; echo root; echo "$USER"; } \
        | sort -u
}

_mn_complete() {
    local cur prev
    COMPREPLY=()
    cur="${COMP_WORDS[COMP_CWORD]}"
    prev="${COMP_WORDS[COMP_CWORD-1]}"

    if [[ $COMP_CWORD -eq 1 ]]; then
        local words="help update uninstall plugin -v --version"
        local f args
        for f in ~/.config/mn/modules/*.sh ~/.config/mn/plugins/*/mn.sh; do
            [[ -f "$f" ]] || continue
            args=$(grep -oP 'CLI_ARGS="\K[^"]*' "$f" 2>/dev/null | head -1 | tr '|' ' ')
            words="$words $args"
        done
        COMPREPLY=($(compgen -W "$words" -- "$cur"))
        return 0
    fi

    # Connection handles / users, gated on the module's own CLI_ARGS so a rename
    # or a disabled module never leaves a stale hard-coded verb behind
    local conn_args
    conn_args=$(grep -oP 'CLI_ARGS="\K[^"]*' ~/.config/mn/modules/connexions.sh 2>/dev/null | head -1)
    if [[ -n "$conn_args" && "|${conn_args}|" == *"|${COMP_WORDS[1]}|"* ]]; then
        if [[ $COMP_CWORD -eq 2 ]]; then
            COMPREPLY=($(compgen -W "-l $(_mn_conn_handles | tr '\n' ' ')" -- "$cur"))
            return 0
        elif [[ $COMP_CWORD -eq 3 ]]; then
            COMPREPLY=($(compgen -W "$(_mn_conn_users | tr '\n' ' ')" -- "$cur"))
            return 0
        fi
    fi

    if [[ "${COMP_WORDS[1]}" == "plugin" ]]; then
        if [[ $COMP_CWORD -eq 2 ]]; then
            COMPREPLY=($(compgen -W "list install update remove info" -- "$cur"))
            return 0
        elif [[ $COMP_CWORD -eq 3 && ( "$prev" == "remove" || "$prev" == "update" || "$prev" == "info" ) ]]; then
            local plugins="" d
            for d in ~/.config/mn/plugins/*/; do
                [[ -f "${d}mn.sh" ]] && plugins="$plugins $(basename "$d")"
            done
            COMPREPLY=($(compgen -W "$plugins" -- "$cur"))
            return 0
        elif [[ $COMP_CWORD -eq 4 && ( "${COMP_WORDS[2]}" == "install" || "${COMP_WORDS[2]}" == "update" ) ]]; then
            compopt -o filenames
            COMPREPLY=($(compgen -f -- "$cur"))
            return 0
        fi
    fi
}

complete -F _mn_complete mn
