<div align="center">
  <a href="https://cdn.sylvain.sh"><img src="https://cdn.sylvain.sh/favicon.ico" alt="Logo" width="25%" height="auto"/></a>

  # CDN Personnel - Scripts et paquets
  [![Version](https://custom-icon-badges.demolab.com/badge/Version%20:-v3.1.9-6479ee?logo=cdn.sylvain.sh&labelColor=23272A)](https://github.com/20syldev/cdn/releases/latest)
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
