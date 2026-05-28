# Tester Koogwe depuis le Togo (équipe dev)

## Oui, vous pouvez tester au Togo

- Le **GPS réel** du téléphone est utilisé : un chauffeur à Lomé apparaît à Lomé sur la carte (comportement correct).
- Le bug corrigé était l’affichage de **coordonnées Lomé codées en dur** alors que la course était en **Guyane**.

## Mode debug vs production

| | Debug (dev) | Release (prod Guyane) |
|---|-------------|------------------------|
| Recherche d’adresse | `tg,gf,sr,br` | `gf,sr,br` uniquement |
| Carte par défaut si pas de GPS | Cayenne | Cayenne |

## Scénarios de test recommandés

1. **Course locale Togo** : 2 téléphones, GPS activé, chauffeur accepte → le passager voit la voiture bouger vers lui.
2. **Simulation Guyane** : placer manuellement le point sur la carte à Cayenne avant de commander.
3. **Auth** : inscription chauffeur avec mot de passe **≥ 8 caractères** ; connexion OTP si besoin.

## Déploiement

Après chaque pull : `npx prisma migrate deploy` sur Railway, puis rebuild des 2 apps Flutter.
