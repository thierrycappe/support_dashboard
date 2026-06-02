# Changelog

## [0.3.1] - 2026-06-02

### Corrections de bugs

- Le cron `sync-source-apps` effectue désormais une synchronisation **complète** (et non plus incrémentale) : tous les tickets ouverts sont réingérés à chaque exécution, ce qui rafraîchit `lastSyncedAt` et fait disparaître l'indicateur « Stale sync » même pour les tickets inchangés depuis plus de 48 h. Auparavant le pull n'allait chercher que les tickets modifiés depuis la dernière synchronisation, si bien qu'un ticket déjà périmé ne se rafraîchissait jamais.

## [0.3.0] - 2026-06-02

### Modifications

- Résolution des jetons d'ingestion par variable d'environnement dédiée à chaque application source (`SUPPORT_TOWER_INGEST_TOKEN_<SLUG>`, p. ex. `SUPPORT_TOWER_INGEST_TOKEN_PICHON_BI_FEEDBACK`). Chaque jeton est désormais indépendamment rotatif et modifiable.
- Suppression de l'ancienne carte JSON unique `SUPPORT_TOWER_INGEST_TOKENS_JSON` et du jeton partagé `SUPPORT_TOWER_INGEST_TOKEN` : la variable par application est désormais le seul mécanisme.

## [0.2.0] - 2026-05-12

### Nouvelles fonctionnalités

- Ajout d'un indicateur "Stale sync" sur les tickets ouverts dont la dernière synchronisation date de plus de 48 heures (visible sur le tableau de bord et la page détail).
- Ajout d'une synchronisation périodique (cron Vercel toutes les 30 minutes) qui interroge les applications sources configurées dans `SUPPORT_TOWER_SOURCE_APP_PULL_JSON` et met à jour les tickets via le pipeline d'ingestion existant.
- Ajout d'un bouton "Refresh from source" sur la page détail d'un ticket pour forcer la mise à jour depuis l'application source à la demande.

### Corrections de bugs

- Les tickets clôturés sur Casal-track restaient affichés en "In progress" sur Control Tower lorsque Casal-track n'émettait pas la transition de clôture. Le pull périodique et le bouton manuel permettent désormais de récupérer l'état réel.
