# Pipeline FeedPulse AI

Le workflow `Update FeedPulse AI feed` s’exécute toutes les douze heures et peut aussi être lancé manuellement.

## Activer Gemini

Dans le dépôt GitHub public `FeedPulse-AI-Web` :

1. Ouvrir **Settings → Secrets and variables → Actions**.
2. Créer un secret nommé `GEMINI_API_KEY`.
3. Coller la clé créée dans Google AI Studio.
4. Ouvrir **Actions → Update FeedPulse AI feed → Run workflow**.

Le workflow utilise `gemini-3.5-flash-lite` et écrit le résultat dans `site/feed.json`. La clé reste dans GitHub Actions et n’est jamais incluse dans l’application mobile.

Le pipeline est incrémental : `site/feed-state.json` mémorise les URLs déjà traitées. Un article déjà présent dans ce fichier ou dans le feed n’est plus envoyé à Gemini. S’il n’y a aucun nouvel article, aucun appel Gemini n’est effectué.

## Traitement par lots

Les articles sont envoyés à Gemini par lots de 10 (`BATCH_SIZE=10`) au lieu d’un appel par article. Avec 20 nouveaux articles maximum, le workflow effectue au maximum 2 appels Gemini. Chaque réponse doit contenir exactement un briefing par identifiant d’article ; les URLs et IDs sont contrôlés avant publication.

Le lot est volontairement fixé à 10 pour rester dans les limites de contexte et limiter les erreurs de quota. Il peut être augmenté jusqu’à 20 avec la variable `BATCH_SIZE`, mais 10 est le réglage recommandé pour le quota gratuit.

Les descriptions envoyées sont limitées à 1 800 caractères. Les erreurs temporaires `429`, `500`, `502`, `503` et `504` sont retentées jusqu’à trois fois, en respectant l’en-tête `Retry-After` quand il existe. Un délai de 8 secondes sépare les lots. Si tous les lots échouent, le workflow conserve le dernier flux valide au lieu de publier un flux vide.

## Test local sans clé

```bash
node pipeline/update-feed.mjs --dry-run
```

Le mode simulation vérifie la collecte RSS, la normalisation, la déduplication et le schéma, mais ne produit pas de traduction française de qualité. Il ne doit pas remplacer une exécution Gemini en production.
