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

# Read an entry by its key (field 0). Literal match, no regex, no escape mangling:
# grep "^${key}:::" made `db.example` match a `dbXexample` line, and
# `awk -v k=...` would interpret backslash escapes in the key.
dat_read() {
    local file="$1" key="$2" line
    line=$(MN_DAT_KEY="$key" awk -F':::' '
        BEGIN { k = ENVIRON["MN_DAT_KEY"] }
        $1 == k { print; exit }' "$file" 2>/dev/null)
    if [[ -z "$line" ]]; then
        _DAT_FIELDS=()
        _DAT_LINE=""
        return 1
    fi
    dat_parse "$line"
    return 0
}

# A value that would corrupt the record layout is refused at write time
dat_safe_value() {
    [[ "$1" == *":::"* ]] && return 1
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
    if [[ -s "$file" ]] && [[ -n "$(tail -c 1 "$file")" ]]; then
        printf '\n' >> "$file"
    fi
    printf '%s\n' "$line" >> "$file"
}

# Delete an entry by key. Literal match, atomic replace, 600 preserved.
dat_delete_entry() {
    local file="$1" key="$2" tmp
    tmp=$(mktemp "${file}.XXXXXX") || return 1
    MN_DAT_KEY="$key" awk -F':::' '
        BEGIN { k = ENVIRON["MN_DAT_KEY"] }
        $1 != k' "$file" > "$tmp"
    chmod 600 "$tmp"
    mv "$tmp" "$file"
}

# Number of records whose field count differs from $2. 0 = the file is sound.
dat_arity() {
    local file="$1" want="$2"
    awk -F':::' -v w="$want" '!/^#/ && NF > 1 && NF != w { n++ } END { print n + 0 }' "$file"
}

# Guarantee the file starts with the schema comment, and only that one
dat_ensure_header() {
    local file="$1" header="$2" tmp
    [[ "$(head -1 "$file" 2>/dev/null)" == "$header" ]] && return 0
    tmp=$(mktemp "${file}.XXXXXX") || return 1
    {
        printf '%s\n' "$header"
        grep -v '^# Format:' "$file" 2>/dev/null
    } > "$tmp"
    chmod 600 "$tmp"
    mv "$tmp" "$file"
}
