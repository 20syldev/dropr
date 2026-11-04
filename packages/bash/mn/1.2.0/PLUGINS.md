# Creating a plugin for mn

A mn plugin is a single Bash file (`mn.sh`) installed in `~/.config/mn/plugins/<name>/mn.sh`.
mn loads it automatically at startup.

---

## Minimal template

Copy this file, replace `mypkg` with your plugin name, and adapt the actions.

```bash
# ─── Metadata ─────────────────────────────────────────────────────────
# Displayed by mn plugin info / mn plugin list

PLUGIN_mypkg_VERSION="1.0.0"
PLUGIN_mypkg_DESCRIPTION="Short description"
PLUGIN_mypkg_AUTHOR="your-username"
PLUGIN_mypkg_REQUIRES="mypkg"           # required binary — mn skips the plugin if absent
PLUGIN_mypkg_INSTALL_CMD="curl -fsSL https://example.com/install.sh | sh"

# ─── Menu registration ────────────────────────────────────────────────
# Registers the plugin in mn's main menu

MOD_mypkg_TYPE="menu"                        # "menu" = free menu | "crud" = CRUD engine
MOD_mypkg_MENU_LABEL="MYPKG - My tool"       # shown in the main menu
MOD_mypkg_TITLE="MYPKG"                      # shown at the top of the sub-menu
MOD_mypkg_CLI_ARGS="mypkg|mp"                # mn mypkg or mn mp for direct access
MOD_mypkg_PRIORITY=55                        # menu order (conn=10 … config=80)

# ─── Menu ─────────────────────────────────────────────────────────────
# show_<name>_menu() — mandatory convention

show_mypkg_menu() {
    CURRENT_MENU="mypkg"
    USE_PAGINATION=false
    MENU_ITEMS=("Run" "Status")
    MENU_ACTIONS=("_mypkg_run" "_mypkg_status")
}

# ─── Actions ──────────────────────────────────────────────────────────

_mypkg_run() {
    show_cursor; clear_screen
    draw_header "MYPKG - RUN"
    mypkg run
    echo -e "\n${DIM}$T_PRESS_KEY${NC}"
    read -n 1 -s; hide_cursor
    show_mypkg_menu
}

_mypkg_status() {
    show_cursor; clear_screen
    draw_header "MYPKG - STATUS"
    mypkg status
    echo -e "\n${DIM}$T_PRESS_KEY${NC}"
    read -n 1 -s; hide_cursor
    show_mypkg_menu
}

# ─── Registration ─────────────────────────────────────────────────────
# Always last — adds the plugin to the active module list

ALL_MODULES="${ALL_MODULES:+$ALL_MODULES }mypkg"
```

---

## Installation

```bash
mn plugin install mypkg /path/to/mn.sh          # local file (dev/test)
mn plugin install mypkg                          # from configured CDN ({MN_CDN}/mypkg@latest/mn.sh)
mn plugin install mypkg https://example.com/...  # custom URL
```

The CDN is configurable via `mn config` → `[C]` (default: `https://dropr.sylvain.sh/bash`).

To uninstall: `mn plugin remove mypkg`

---

## Available API

Everything is accessible from `mn.sh` — the file is sourced into the mn process.

### UI

| Function | Description |
|---|---|
| `draw_header "$title"` | Styled header |
| `select_option "$prompt" "${options[@]}"` | Arrow selector → result in `$_SELECT_VALUE` |
| `toggle_switch "$state" "$on" "$off"` | On/off toggle → returns 0 or 1 |
| `confirm_dialog` | Confirmation dialog → returns 0 (yes) or 1 (no) |
| `clear_screen` | Clear the terminal |
| `hide_cursor` / `show_cursor` | Cursor visibility |
| `spinner_start "$msg"` / `spinner_stop` | Loading spinner |

### Colors and styles

```bash
$RED $GREEN $BLUE $CYAN $YELLOW $MAGENTA $WHITE $GRAY
$BOLD $DIM $RESET $REVERSE $NC
```

### Data (`::`-delimited files)

```bash
dat_parse "$line"               # split a line → array $_DAT_FIELDS
dat_read "$file" "$key"         # read entry by key → $_DAT_FIELDS, $_DAT_LINE
dat_join "$f1" "$f2" "$f3"      # join values with ::: (rc 1 if a value contains :::)
dat_append "$file" "$line"      # append, guaranteeing the trailing newline first
dat_delete_entry "$file" "$key" # delete an entry (literal key match, atomic)
dat_safe_value "$v"             # rc 1 if the value would corrupt the record
dat_arity "$file" 7             # count of records whose field count differs
dat_ensure_header "$file" "$h"  # guarantee the schema comment on line 1
```

Always write through `dat_append`, never `echo >> "$file"`: a file left without a
trailing newline merges the next record into the last one.

### Display helpers

ANSI-aware and UTF-8-aware. Each writes a global and forks nothing — `printf %-Ns`
pads in **bytes** and counts escape sequences, so it cannot be used on menu rows.

```bash
_vislen "$s"          # → $_VISLEN   visible width, ANSI stripped
_pad    "$s" 12       # → $_PAD      right-padded to 12 visible columns
_trunc  "$s" 20       # → $_TRUNC    truncated to 20 columns with an ellipsis
```

Inside a menu row use **additive** colours only (`$C_CYAN`, `$C_GRAY`, `$C_WHITE`,
… and `$FG_RESET`). A `\033[0m` reset — which is what `$NC` and `$CYAN` carry —
also clears the reverse video of the selection bar.

### Global variables

```bash
$MN_DIR     # ~/.config/mn
$MN_EDITOR  # configured editor
$MN_LANG    # active language
$DATA_DIR   # ~/.config/mn/data
```

---

## Generic CRUD engine (optional)

If your plugin manages tabular data, use mn's CRUD engine with no extra code:

```bash
MOD_mypkg_TYPE="crud"
MOD_mypkg_FILE="$DATA_DIR/mypkg.dat"
MOD_mypkg_FIELDS="name value desc"
MOD_mypkg_PAGINATION="true"
MOD_mypkg_MENU_FORMAT_FN="_mypkg_format"
MOD_mypkg_ENTRY_ACTION="_mypkg_run"
# see modules/alias.sh for a complete example

show_mypkg_menu() { generic_show_menu "mypkg"; }
```

### Optional engine hooks

All optional: an undeclared property is an empty string and the engine keeps its
default behaviour. See `modules/connexions.sh` for a module that uses all of them.

| Property | When it runs | Contract |
| -------- | ------------ | -------- |
| `MENU_PREPARE_FN` | in the **parent shell**, before the menu is built | May reorder or filter `_MENU_LINES`, set `_MENU_STATUS` (a status line replacing the pagination line) and `_MENU_HIDE_ADD`, and compute globals that `MENU_FORMAT_FN` reads back from its subshell |
| `HEADER_FN` | on every `draw_menu` | Prints one non-selectable line under the title (a column header) |
| `FOOTER_FN` | on every `draw_menu` | Prints the footer instead of the default one. Must print **exactly two lines** |
| `KEYS_FN` | on any key the engine does not handle | Receives the key. Return 0 when consumed, 1 to let the engine keep looking |
| `NORMALIZE_FN` | once before writing | Receives every field, prints the normalised list **one field per line**. The only hook that can rewrite a field from another field's value |
| `CLI_FN` | `mn <verb> <args…>` | Receives the extra arguments. Without it they are ignored |
| `DAT_HEADER` | after every write | Schema comment guaranteed on line 1 of the `.dat` |

Per field, `MOD_mypkg_FIELD_VALIDATE_FN_<field>` is called on add **and** edit:
return 0 when valid, or 1 with the error message on stdout. The wizard re-asks
the field with what was typed instead of losing the whole entry.

`MENU_FORMAT_FN` runs in a command substitution, so it cannot write globals —
that is what `MENU_PREPARE_FN` is for.
