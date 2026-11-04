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

## Prerequisites

- `bash` (>= 4.0)
- `curl` (for installation)
- Internet connection