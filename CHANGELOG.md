# Changelog

## [0.4.0] - 2026-08-12

### Nouvelles fonctionnalités

- Mise en place du modèle à deux niveaux : le responsable métier de chaque
  application filtre les retours, puis transmet au support central uniquement
  les bugs et demandes d'évolution approuvés avec une attribution de triage.
- Ajout de l'inscription administrateur par invitation à usage unique et de
  l'authentification applicative par clés publiques Ed25519. Les connecteurs
  conservent leur clé privée, obtiennent des jetons courts et peuvent renouveler
  leurs clés avec chevauchement contrôlé, pause et révocation.
- Ajout de l'API versionnée `POST /api/v1/escalations` avec identité liée au
  justificatif cryptographique, contrat strict, limite de taille,
  `Idempotency-Key`, détection des conflits et limites de débit persistées.
- Ajout du routage vers l'équipe technique de l'application, de la copie
  centrale pour les urgences et du repli central lorsque l'application ne
  possède aucune cible valide.
- Ajout d'une boîte d'envoi PostgreSQL durable pour les canaux e-mail,
  Pushover et webhook : baux renouvelables, reprise après abandon, tentatives
  chronologiques, délais de nouvelle tentative bornés et action manuelle de
  relance.
- Ajout des vues opérationnelles Escalations, Applications, Livraisons,
  Équipes, Accès et Insights, avec inscription d'application, politiques de
  notification, état textuel des canaux et chronologie de livraison.

### Sécurité

- Chiffrement des configurations de canaux en AES-256-GCM avec trousseau
  versionné; les secrets et configurations déchiffrées ne sont jamais placés
  dans la boîte d'envoi ni les journaux d'audit.
- Protection des assertions contre le rejeu, contrôle transactionnel des
  invitations et limites de débit, erreurs publiques stables avec identifiant
  de corrélation et vérification SSRF des webhooks avec résolution DNS épinglée.
- Minimisation par canal : Pushover ne reçoit jamais l'identité du rapporteur;
  l'e-mail et le webhook ne la reçoivent qu'après activation explicite sur un
  canal authentifié.

### Fiabilité et compatibilité

- L'acceptation, le ticket, la génération d'événement, le résultat de routage,
  les livraisons et l'audit sont désormais validés dans une seule transaction;
  aucun appel à un fournisseur n'a lieu avant le commit.
- L'ancien endpoint bearer et le pull complet restent compatibles, mais passent
  par le même pipeline durable pendant la migration des applications.
- La mise en production des routes transactionnelles exige une
  `DATABASE_URL` PostgreSQL poolée et un `DATABASE_POOL_MAX` compatible avec le
  budget de connexions du fournisseur.

### Interface

- Refonte responsive selon le système « quiet operational ledger » : modes
  clair, sombre et système, tableaux accessibles au clavier, états associés à
  du texte, pagination bornée et messages d'erreur sans détails
  d'infrastructure.

## [0.3.2] - 2026-06-02

### Améliorations

- Documentation du contrat de connecteur : la page « Apps » et `SECURITY.md` décrivent désormais l'endpoint d'export (`GET /api/support-tower/export`, `Authorization: Bearer <SUPPORT_TOWER_EXPORT_TOKEN>`) que les applications sources doivent exposer pour que le tower puisse tirer l'état des tickets et lever l'indicateur « Stale sync ».

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
