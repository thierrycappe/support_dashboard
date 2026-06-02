# Changelog

## [0.3.0] - 2026-06-02

### Nouvelles fonctionnalités

- Résolution des jetons d'ingestion par variable d'environnement dédiée à chaque application source (`SUPPORT_TOWER_INGEST_TOKEN_<SLUG>`, p. ex. `SUPPORT_TOWER_INGEST_TOKEN_PICHON_BI_FEEDBACK`). Chaque jeton est désormais indépendamment rotatif.
- La carte JSON `SUPPORT_TOWER_INGEST_TOKENS_JSON` reste prise en charge comme repli pendant la migration ; à supprimer une fois toutes les applications migrées.

## [0.2.0] - 2026-05-12

### Nouvelles fonctionnalités

- Ajout d'un indicateur "Stale sync" sur les tickets ouverts dont la dernière synchronisation date de plus de 48 heures (visible sur le tableau de bord et la page détail).
- Ajout d'une synchronisation périodique (cron Vercel toutes les 30 minutes) qui interroge les applications sources configurées dans `SUPPORT_TOWER_SOURCE_APP_PULL_JSON` et met à jour les tickets via le pipeline d'ingestion existant.
- Ajout d'un bouton "Refresh from source" sur la page détail d'un ticket pour forcer la mise à jour depuis l'application source à la demande.

### Corrections de bugs

- Les tickets clôturés sur Casal-track restaient affichés en "In progress" sur Control Tower lorsque Casal-track n'émettait pas la transition de clôture. Le pull périodique et le bouton manuel permettent désormais de récupérer l'état réel.
