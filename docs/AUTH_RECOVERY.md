# Récupération compte chauffeur / passager

## Symptôme : `401 Email ou mot de passe incorrect` après inscription

Le compte email existe (créé par `send-otp`) mais `verify-otp-and-password` a échoué → **aucun mot de passe enregistré**.

## Procédure utilisateur

1. Ouvrir l'app et choisir **connexion par OTP** (pas email + mot de passe seul).
2. Demander un code sur l'email concerné.
3. Saisir le code OTP et un mot de passe d'**au moins 8 caractères**.
4. Attendre la réponse `200` sur `POST /api/auth/verify-otp-and-password`.
5. Ensuite se connecter avec email + ce même mot de passe.

## Vérifier le déploiement Railway

```bash
curl -s https://VOTRE-URL-RAILWAY/api/health | jq
```

Le champ `gitCommit` doit correspondre au dernier commit déployé sur `main` (ex. après correctif `drivers.service.ts`).

## Compte toujours bloqué (admin)

Via Prisma Studio ou SQL :

- Vérifier `User.email` et `User.hashedPassword` (null = pas de MDP enregistré).
- Option : supprimer la ligne `User` pour refaire une inscription complète (dernier recours).
