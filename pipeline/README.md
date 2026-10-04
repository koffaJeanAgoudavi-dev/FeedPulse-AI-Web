# Pipeline FeedPulse AI

Le workflow `Update FeedPulse AI feed` s’exécute toutes les six heures et peut aussi être lancé manuellement.

## Activer Gemini

Dans le dépôt GitHub public `FeedPulse-AI-Web` :

1. Ouvrir **Settings → Secrets and variables → Actions**.
2. Créer un secret nommé `GEMINI_API_KEY`.
3. Coller la clé créée dans Google AI Studio.
4. Ouvrir **Actions → Update FeedPulse AI feed → Run workflow**.

Le workflow utilise `gemini-3.8-flash` et écrit le résultat dans `site/feed.json`. La clé reste dans GitHub Actions et n’est jamais incluse dans l’application mobile.

## Test local sans clé

```bash
node pipeline/update-feed.mjs --dry-run
```

Le mode simulation vérifie la collecte RSS, la normalisation, la déduplication et le schéma, mais ne produit pas de traduction française de qualité. Il ne doit pas remplacer une exécution Gemini en production.
