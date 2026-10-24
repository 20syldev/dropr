<div align="center">
  <a href="https://cdn.sylvain.sh"><img src="https://cdn.sylvain.sh/favicon.ico" alt="Logo" width="25%" height="auto"/></a>

  # CDN Personnel - Scripts et paquets
  [![Version](https://custom-icon-badges.demolab.com/badge/Version%20:-v3.2.2-6479ee?logo=cdn.sylvain.sh&labelColor=23272A)](https://github.com/20syldev/cdn/releases/latest)
</div>

---

## Qu'est-ce que c'est ?
CDN personnel pour stocker et partager scripts, paquets et autres ressources.
Mis à jour régulièrement, les fichiers sont accessibles à tous.

## Utilisation

### Accéder à un paquet
```
https://cdn.sylvain.sh/<type>/<projet>@<version>
https://cdn.sylvain.sh/bash/gft@latest
https://cdn.sylvain.sh/bash/gft@1.0.0
```
`@latest` et les versions partielles (`@6`, `@6.1`) privilégient la dernière version stable.
Une préversion n'est choisie que si aucune version stable ne correspond, ou avec son numéro exact (`@6.0.0-pre`).

### Télécharger un fichier
```bash
curl -O https://cdn.sylvain.sh/bash/gft@latest/gft
```

### Télécharger un paquet complet (.tar.gz)
Via le navigateur ou `curl` :
```
https://cdn.sylvain.sh/download/bash/gft@1.0.0
```
```bash
curl -O https://cdn.sylvain.sh/bash/gft@1.0.0?download
```

### Vérifier l'intégrité (SHA256)
```bash
curl https://cdn.sylvain.sh/bash/gft@1.0.0?checksums
```

### Rechercher un paquet
```
https://cdn.sylvain.sh/search?q=gft
https://cdn.sylvain.sh/search?q=npm
```

### Autres endpoints
| Route                                    | Description                      |
| ---------------------------------------- | -------------------------------- |
| `/health`                                | État du serveur, version, uptime |
| `/<type>`                                | Liste des projets d'un type      |
| `/<type>/<projet>/changelog`             | Historique des versions          |
| `/<type>/<projet>@<version>?checksums`   | Checksums SHA256                 |
| `/<type>/<projet>@<version>?download`    | Archive .tar.gz                  |
| `/download/<type>/<projet>@<version>`    | Archive .tar.gz (navigateur)     |
| `/search?q=<terme>`                      | Recherche par nom ou type        |

### Paquets dépréciés
Un paquet renommé reste accessible à son ancienne adresse, figé à sa dernière version.
Ses réponses JSON portent un champ `deprecated` (date, message, successeur).
Toutes ses réponses, fichiers et archives compris, portent l'en-tête `Deprecation` (date) et l'en-tête `Link` vers le nouveau paquet.
```
https://cdn.sylvain.sh/npm/api@6.0.0    →    https://cdn.sylvain.sh/npm/moxon@latest
```
