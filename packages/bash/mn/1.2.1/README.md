# mn - Personal Dynamic Manual

An interactive terminal menu for managing SSH connections, GitHub repositories, Bash aliases, shell functions, and personal documentation — all in one place.

## Installation

### Via curl (recommended)

```bash
curl -fsSL https://dropr.sylvain.sh/bash/mn@latest/install.sh | sh
```

### Manual installation

```bash
./install.sh
```


## Usage

### Open main menu

```bash
mn
```

### Direct module access

```bash
mn conn        # SSH/Custom connections
mn repos       # GitHub repositories
mn alias       # Bash aliases
mn funcs       # Shell functions
mn docs        # Internal documentation
mn config      # Configuration
mn help        # Help
```

Short aliases are also supported: `mn co` (connexions), `mn r` (repos), `mn a` (alias), `mn f` (funcs), `mn d` (docs), `mn c` (config), `mn h` (help).

### Connect without the TUI

```bash
mn co cm            # connect using any name or alias
mn co cm root       # connect as another user, without editing the entry
mn co -l            # flat, scriptable list
```

## Navigation

| Key        | Action                  |
| ---------- | ----------------------- |
| `↑` / `k`  | Move up                 |
| `↓` / `j`  | Move down               |
| `←` / `→`  | Previous / next page    |
| `Enter`    | Select / execute        |
| `e`        | Edit selected entry     |
| `d`        | Delete selected entry   |
| `v`        | View details            |
| `/`        | Filter the list (connexions) |
| `u` / `U`  | Cycle / pick the connection user |
| `c`        | Send the command line back to the terminal |
| `r`        | Return to main menu     |
| `q`        | Quit                    |

## Features

- **SSH/Custom connections** — aligned columns showing the command actually executed, multiple aliases per host (the shortest becomes the badge), cached IP, incremental filtering with `/`, and a per-connection user chosen at connect time with `u`
- **GitHub repos** — create aliases to local directories and open them in your configured editor, with a configurable root so a bare name expands to `<root>/<name>`
- **Bash aliases** — add, edit, delete aliases with automatic sync to `~/.bash_aliases`
- **Shell functions** — manage Bash functions with sync to `~/.bash_functions`
- **Documentation** — read Markdown files directly in the terminal
- **Configuration** — edit config files and reload your environment on the fly

## File structure

```
~/.config/mn/
├── mn                  # Main entry point
├── lib/
│   ├── core.sh         # Config, colors, utilities
│   ├── crud.sh         # Generic CRUD engine
│   ├── ui.sh           # Menu rendering and input handling
│   ├── module.sh       # Module registry
│   └── dat.sh          # Data file helpers
├── modules/
│   ├── connexions.sh   # SSH module
│   ├── repos.sh        # Repos module
│   ├── alias.sh        # Alias module
│   ├── funcs.sh        # Functions module
│   ├── docs.sh         # Documentation module
│   └── config.sh       # Configuration module
├── data/
│   ├── connexions.dat
│   ├── repos.dat
│   ├── aliases.dat
│   └── functions.dat
└── docs/               # Internal Markdown documentation
```

## Data format

All data is stored in `.dat` files using `:::` as separator. Files are sorted alphabetically and can be edited manually.

**connexions.dat**
```
name:::via:::target:::user:::aliases:::ip:::desc
prod:::ssh:::prod-web-01:::deploy:::web,p1:::192.168.1.10:::Production web server
lab:::xe:::lab.internal::::::lb:::10.0.0.42:::Lab host reached through the xe bastion
```

| field | role |
| ----- | ---- |
| `name` | entry key, shown in the NAME column |
| `via` | the command actually run. Empty or `ssh` means native ssh; anything else is a verb (`xe`) or a template (`telnet {host} 23`). Placeholders: `{host}` `{ip}` `{name}` `{user}` `{user@}` |
| `target` | the exact argument handed to `ssh` or to the verb. Pick the `Host` block name from `~/.ssh/config` when there is one — ssh matches the literal string, never a resolved address |
| `user` | default user. Empty delegates to `ssh_config` or to the remote wrapper |
| `aliases` | comma separated. The shortest of name + aliases becomes the displayed badge |
| `ip` | informational cache, never used to connect |
| `desc` | free text |

**repos.dat**
```
name:::path:::description
myapp:::~/Projects/myapp:::Main application
api:::~/Projects/api:::REST API
```

**aliases.dat**
```
name:::command:::description
c:::clear:::Clear terminal
ll:::ls -lah:::Detailed listing
```

**functions.dat**
```
name:::description[:::shell]
mkcd:::Create directory and move into it:::shell
```

The script itself lives in `~/.local/bin/<name>` (or `/usr/local/bin/<name>`), not in the `.dat`.

## Customization

### Change default editor

Choose at install, or via `mn config` → **Change editor**. Presets: `vi`, `vim`, `nano`, `zed`, `code` or any custom command. Setting stored in `~/.config/mn/.editor`.

### Change the repos folder

`mn config` → **Change the repos folder** (`[P]`). It is the root under which a
*bare* repo name is expanded: with the root set to `~/code`, adding a repo named
`myapp` with an empty path stores `~/code/myapp`. An absolute or `~` path typed
in the *Path* field is always kept as-is, whatever the root.

The default is `~`, so nothing is assumed about how you organise your projects.
The installer asks for it, and the value is stored in `~/.config/mn/.repos`.

### Modify colors

Colors are defined in `~/.config/mn/lib/core.sh`.

### Add internal documentation

Drop a Markdown file into `~/.config/mn/docs/` — it will appear automatically in the `docs` module.

## Shell files and the generated block

`~/.bash_aliases` and `~/.bash_functions` are yours. mn writes only between two
marker lines and keeps every other line verbatim:

```bash
# >>> mn >>>
# Generated by mn. Changes inside this block are overwritten.
alias ll='ls -lah'
...
# <<< mn <<<
```

- The first time mn meets a file without markers, it saves a one-time copy next to it
  (`~/.bash_aliases.mn-bak`, `~/.bash_functions.mn-bak`) and removes only the lines that
  mn 1.1.x generated itself. Your own aliases and lines stay.
- A name that cannot be written safely is skipped and listed on the screen instead of
  corrupting the file. Alias and repo names accept `..`, `...` and numeric names; a function
  name must also be a valid file name. `mn` itself is reserved.
- Do not edit inside the block: the next save regenerates it. Put your own lines above or
  below.
- A command that mn hands back to the terminal (`c` in connexions) goes through a private
  temporary file created by the `mn()` wrapper, never a fixed path in `/tmp`.

## Plugins

A plugin is one `mn.sh` file, see [PLUGINS.md](PLUGINS.md). No official plugin is published
yet, so install from a file or a URL:

```bash
mn plugin install <name> /path/to/mn.sh       # local file
mn plugin install <name> https://example.com/mn.sh   # URL
mn plugin install <name>                       # from the CDN, when the CDN serves it
mn plugin install <name>@1.2                   # a given version from the CDN
mn plugin update <name>
mn plugin remove <name>
```

`<name>` is lowercase letters, digits, `_` and `-`. The version is `latest` (default), `1`,
`1.2` or `1.2.3`, with a single `@`, and only when the plugin comes from the CDN: it cannot be
combined with a URL or a path. `update` takes the same `<name>[@version]`, while `remove` and
`info` take the bare name.

## Migration from 1.1.x

Version 1.3 stores connexions as `name:::via:::target:::user:::aliases:::ip:::desc` (see
[Data format](#data-format)). Rows still in the 1.1 format
(`label:::user@host:::desc:::type:::password:::cmd`) are **not converted**. They are hidden
from the menu, ignored by `mn co` and by the completion, and mn warns about them. Nothing is
deleted.

| 1.1 field | 1.3 field |
| --------- | --------- |
| `label` | `name` |
| `user@host` | `user` and `target` (a bare `host` gives an empty user) |
| `desc` | `desc` |
| type `ssh` | `via` = `ssh` |
| type `custom` and its command | `via` = that command (the host is handed to it as before) |
| `password` | dropped: mn never used it to connect, and it should not stay on disk |

Review the result afterwards: names must start with a letter or a digit, and `ip` and
`aliases` are left empty for you to fill in with `e`. Run this yourself, from a shell:

```bash
cd ~/.config/mn/data
cp connexions.dat connexions.dat.1.1-bak
awk -F':::' 'BEGIN { OFS = ":::" }
    /^#/ || NF < 2 { print; next }
    NF == 7        { print; next }
    {
        host = $2; user = ""
        if (i = index(host, "@")) { user = substr(host, 1, i - 1); host = substr(host, i + 1) }
        via = "ssh"
        if ($4 == "custom" && $6 != "") via = $6
        print $1, via, host, user, "", "", $3
    }' connexions.dat.1.1-bak > connexions.dat.new &&
    mv connexions.dat.new connexions.dat && chmod 600 connexions.dat
mn co -l
```

`connexions.dat.1.1-bak` still holds the old passwords: delete it once you are happy with
the result. Rows that already have 7 fields are copied unchanged, so the command can be
re-run.

## Prerequisites

- `bash` (>= 4.1)
- `curl` (for installation)
- Internet connection