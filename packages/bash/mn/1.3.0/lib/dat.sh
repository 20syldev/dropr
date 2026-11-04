#!/bin/bash
# =========================================================
# MN - DAT helpers: manipulation of .dat files
# =========================================================

_DAT_LINE=""

# Parse a ::: line into _DAT_FIELDS. _DAT_LINE keeps the raw record.
dat_parse() {
    local line="$1"
    _DAT_LINE="$1"
    _DAT_FIELDS=()
    while [[ "$line" == *":::"* ]]; do
        _DAT_FIELDS+=("${line%%:::*}")
        line="${line#*:::}"
    done
    _DAT_FIELDS+=("$line")
}

# Resolve the real file behind a symlink. Every temp file and every mv works on
# this path, so a .dat that is a link keeps being a link after a write.
_dat_target() {
    readlink -f -- "$1"
}

# Guards. A module without a FILE (Docs, a plugin menu) reaches these helpers with
# an empty path: awk then reads the tty and hangs, and mktemp "${file}.XXXXXX"
# drops a ".XXXXXX" file in the cwd. Readers need an existing regular file;
# writers only need a path whose directory exists, because the file may be created
# by the very first record of a crud plugin.
_dat_can_read() {
    [[ -n "$1" && -f "$1" ]]
}

_dat_can_write() {
    local dir
    [[ -n "$1" ]] || return 1
    dir="${1%/*}"
    [[ "$1" == */* ]] || dir="."
    [[ -d "${dir:-/}" ]]
}

# Read an entry by its key (field 0). Literal match, no regex, no escape mangling:
# grep "^${key}:::" made `db.example` match a `dbXexample` line, and
# `awk -v k=...` would interpret backslash escapes in the key.
# Both sides are forced to strings: with a bare `$1 == k` awk compares numerically
# when both look like numbers, so the key 1 matched 01 and 1.0.
dat_read() {
    local file="$1" key="$2" line
    _DAT_FIELDS=()
    _DAT_LINE=""
    _dat_can_read "$file" || return 1
    line=$(MN_DAT_KEY="$key" awk -F':::' '
        BEGIN { k = ENVIRON["MN_DAT_KEY"] "" }
        ($1 "") == k { print; exit }' "$file" 2>/dev/null)
    if [[ -z "$line" ]]; then
        _DAT_FIELDS=()
        _DAT_LINE=""
        return 1
    fi
    dat_parse "$line"
    return 0
}

# A value that would corrupt the record layout is refused at write time.
# A trailing ":" is refused too: followed by the ":::" separator it forms "::::",
# which every reader splits one character too early and shifts the next fields.
dat_safe_value() {
    [[ "$1" == *":::"* ]] && return 1
    [[ "$1" == *: ]] && return 1
    [[ "$1" == *$'\t'* ]] && return 1
    [[ "$1" == *$'\n'* ]] && return 1
    return 0
}

# Rebuild a ::: line. Returns 1 when any field carries the separator.
dat_join() {
    local result="" field first=true
    for field in "$@"; do
        dat_safe_value "$field" || return 1
        if $first; then
            result="$field"
            first=false
        else
            result="${result}:::${field}"
        fi
    done
    printf '%s' "$result"
}

# Append a record, guaranteeing the file ends with a newline first.
# This is the write path that merged two records into one when the previous
# write left the file without a trailing newline.
dat_append() {
    local file="$1" line="$2"
    _dat_can_write "$file" || return 1
    if [[ -s "$file" ]] && [[ -n "$(tail -c 1 "$file")" ]]; then
        printf '\n' >> "$file" || return 1
    fi
    printf '%s\n' "$line" >> "$file"
}

# Replace a record in ONE atomic step: drop the old key (empty when adding) and
# append the new line into a single temp file, then move it over the target.
# The old chain (delete, append, sort) ignored every error: a failing write left
# a duplicate key or lost the record while the wizard still said "added".
# Returns 1 on any failure and leaves the original file untouched.
dat_upsert() {
    local file="$1" old_key="$2" line="$3" target tmp del=0
    _dat_can_write "$file" || return 1
    target=$(_dat_target "$file") || return 1
    [[ -n "$target" ]] || return 1
    tmp=$(mktemp "${target}.XXXXXX" 2>/dev/null) || return 1
    [[ -n "$old_key" ]] && del=1
    if [[ -f "$target" ]]; then
        MN_DAT_KEY="$old_key" MN_DAT_DEL="$del" awk -F':::' '
            BEGIN { k = ENVIRON["MN_DAT_KEY"] ""; d = (ENVIRON["MN_DAT_DEL"] == "1") }
            !(d && ($1 "") == k)' "$target" > "$tmp" 2>/dev/null || { rm -f "$tmp"; return 1; }
    fi
    printf '%s\n' "$line" >> "$tmp" 2>/dev/null || { rm -f "$tmp"; return 1; }
    chmod 600 "$tmp" 2>/dev/null
    mv -f "$tmp" "$target" 2>/dev/null || { rm -f "$tmp"; return 1; }
}

# Delete an entry by key. Literal string match, atomic replace on the resolved
# path, 600 preserved. Returns 1 when the file could not be rewritten.
dat_delete_entry() {
    local file="$1" key="$2" target tmp
    _dat_can_read "$file" || return 1
    target=$(_dat_target "$file") || return 1
    tmp=$(mktemp "${target}.XXXXXX" 2>/dev/null) || return 1
    MN_DAT_KEY="$key" awk -F':::' '
        BEGIN { k = ENVIRON["MN_DAT_KEY"] "" }
        ($1 "") != k' "$target" > "$tmp" 2>/dev/null || { rm -f "$tmp"; return 1; }
    chmod 600 "$tmp" 2>/dev/null
    mv -f "$tmp" "$target" 2>/dev/null || { rm -f "$tmp"; return 1; }
}

# Number of records whose field count differs from $2. 0 = the file is sound.
dat_arity() {
    local file="$1" want="$2"
    # Still prints a count, so that an arithmetic use of $(dat_arity ...) holds
    _dat_can_read "$file" || { echo 0; return 1; }
    awk -F':::' -v w="$want" '!/^#/ && NF > 1 && NF != w { n++ } END { print n + 0 }' "$file"
}

# Guarantee the file starts with the schema comment, and only that one
dat_ensure_header() {
    local file="$1" header="$2" target tmp
    _dat_can_read "$file" || return 1
    [[ "$(head -1 "$file" 2>/dev/null)" == "$header" ]] && return 0
    target=$(_dat_target "$file") || return 1
    tmp=$(mktemp "${target}.XXXXXX" 2>/dev/null) || return 1
    printf '%s\n' "$header" > "$tmp" 2>/dev/null || { rm -f "$tmp"; return 1; }
    # grep rc 1 only means "no other line": a real error is rc 2
    grep -v '^# Format:' "$target" >> "$tmp" 2>/dev/null
    (( $? > 1 )) && { rm -f "$tmp"; return 1; }
    chmod 600 "$tmp" 2>/dev/null
    mv -f "$tmp" "$target" 2>/dev/null || { rm -f "$tmp"; return 1; }
}
