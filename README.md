# sqs-lab

Pipeline de commandes asynchrone avec **AWS SQS**, **TypeScript** et **PostgreSQL**.

Projet réalisé dans le cadre d'un TP : découpler la réception d'une commande de son traitement, et gérer correctement les échecs (retries, idempotence, dead-letter queue, redrive).

```
POST /orders → API (producer) → SQS orders-queue → Worker (consumer) → PostgreSQL
                                       │ maxReceiveCount = 3
                                       ▼
                                  orders-dlq
```

## Ce que démontre le projet

- **Producer / consumer** avec le SDK AWS v3 (`@aws-sdk/client-sqs`).
- **Long polling** (20 s) pour limiter les requêtes vides et donc les coûts.
- **Visibility timeout** : un message non supprimé réapparaît après 30 s.
- **Suppression sélective** : seuls les messages traités avec succès sont supprimés d'un lot.
- **Idempotence** face à la livraison *at-least-once* : table `processed_messages` + transaction (marquage et effet métier ensemble, rollback en cas d'échec).
- **Dead-letter queue** : un message déplacé en DLQ après 3 réceptions échouées.
- **Redrive natif** (`StartMessageMoveTask`) pour rejouer la DLQ une fois la cause corrigée.
- **Arrêt propre** du worker (`SIGINT` / `SIGTERM`) : le lot en cours est terminé avant de quitter.
- **Logs structurés** (`pino`) : `orderId`, `messageId`, `receiveCount`, `durationMs`, `outcome`.
- **Moindre privilège IAM** : l'utilisateur de test n'a accès qu'aux queues `orders-*`.

## Stack

TypeScript · Fastify · `@aws-sdk/client-sqs` · PostgreSQL (`pg`) · `zod` · `pino` · Vitest

## Structure

```
sqs-lab/
├── docker-compose.yml        # PostgreSQL
├── infra/
│   ├── create-queues.ts      # crée orders-dlq puis orders-queue (+ RedrivePolicy)
│   └── destroy-queues.ts     # supprime les deux queues
├── src/
│   ├── config.ts             # région, noms/URLs des queues, base de données
│   ├── sqs.ts                # client SQS partagé
│   ├── db.ts                 # pool PostgreSQL + création des tables
│   ├── api/server.ts         # producer : POST /orders
│   └── worker/
│       ├── worker.ts         # boucle de consommation (long polling)
│       └── handler.ts        # logique métier idempotente
├── scripts/redrive-dlq.ts    # rejoue les messages de la DLQ
└── tests/handler.test.ts     # tests Vitest du handler
```

## Prérequis

- Node.js 20+
- Docker (pour PostgreSQL)
- Un compte AWS et la CLI AWS v2, avec un profil dédié (`aws configure --profile sqs-lab`)

## Installation

```bash
npm install
cp .env.example .env
docker compose up -d        # démarre PostgreSQL
npm run infra:up            # crée les queues et affiche leurs URLs
```

Copiez les deux URLs affichées (`ORDERS_QUEUE_URL`, `ORDERS_DLQ_URL`) dans le fichier `.env`.

### Variables d'environnement

| Variable | Description |
|---|---|
| `AWS_PROFILE` | profil AWS CLI utilisé (ex. `sqs-lab`) |
| `AWS_REGION` | région AWS (ex. `eu-west-3`) |
| `DATABASE_URL` | connexion PostgreSQL (ex. `postgres://postgres:postgres@localhost:5432/orders`) |
| `ORDERS_QUEUE_URL` | URL de `orders-queue` (sortie de `infra:up`) |
| `ORDERS_DLQ_URL` | URL de `orders-dlq` (sortie de `infra:up`) |

Aucun secret ne doit être commité : `.env` est dans le `.gitignore`.

## Utilisation

Dans deux terminaux :

```bash
npm run api       # API sur http://localhost:3000
npm run worker    # consommateur SQS
```

Créer une commande :

```bash
curl -X POST http://localhost:3000/orders \
  -H 'content-type: application/json' \
  -d '{"customerId":"c1","amount":42.5}'
# → 202 {"orderId":"..."}
```

La commande est insérée en `PENDING`, puis le worker la passe en `DONE`.

Pour la démonstration, le handler simule un traitement de 1 s avec **30 % d'échec aléatoire**, et échoue systématiquement pour une commande dont le `customerId` vaut `FAIL`. Après 3 réceptions échouées, le message arrive dans `orders-dlq`.

### Rejouer la dead-letter queue

Une fois la cause de l'échec corrigée :

```bash
npm run redrive
```

Le script lance `StartMessageMoveTask` depuis la DLQ vers la queue d'origine et suit l'avancement avec `ListMessageMoveTasks`.

> Ne rejouez pas une DLQ sans avoir corrigé la cause : les messages échoueraient à nouveau et retourneraient en DLQ.

## Tests

```bash
docker compose up -d
npm test
```

Les tests (Vitest, sur une vraie base PostgreSQL) vérifient que :
1. appeler le handler deux fois avec le même message n'applique l'effet qu'une seule fois ;
2. un échec lève une erreur et annule la transaction (donc le message ne sera pas supprimé).

## Coûts et nettoyage

Le free tier SQS couvre 1 M de requêtes par mois, mais chaque envoi, réception (même vide) et suppression compte. Ne laissez pas un worker tourner sans surveillance.

À la fin :

```bash
npm run infra:down      # supprime orders-queue et orders-dlq
docker compose down
```

Supprimez aussi l'utilisateur IAM de test s'il n'est plus utile.

## Limites connues

- Si l'insertion en base réussit mais que l'envoi SQS échoue, la commande reste `PENDING` sans message. Une approche de type **outbox pattern** corrigerait ce cas (non implémentée ici).
- Le traitement métier (paiement, stock, notification) est simulé.
