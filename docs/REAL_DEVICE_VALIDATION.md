## Validation terrain réelle (2 appareils)

Objectif: valider en conditions réelles avant ouverture publique.

### Prérequis

- 1 téléphone passager (app passager installée)
- 1 téléphone chauffeur (app chauffeur installée)
- Comptes actifs et chauffeur approuvé admin
- Variables prod configurées (Stripe, Firebase, DB, JWT)
- Réseau mobile réel (4G/5G) + un test Wi‑Fi

### Cas de test A — Course complète

1. Passager crée une course.
2. Chauffeur reçoit la demande en direct.
3. Chauffeur accepte.
4. Passager voit statut et position chauffeur en temps réel.
5. Chauffeur passe `DRIVER_EN_ROUTE` -> `ARRIVED` -> `IN_PROGRESS` -> `COMPLETED`.
6. Passager voit l'écran de fin.

Attendu:

- Pas de blocage d'écran
- Statuts cohérents sur les 2 appareils
- Reprise correcte si app fermée puis rouverte (course active)

### Cas de test B — Paiement Stripe live

1. Passager recharge wallet via Stripe Payment Sheet.
2. Vérifier webhook Stripe reçu (`payment_intent.succeeded`).
3. Vérifier crédit wallet unique (pas de double crédit).
4. Finaliser une course payée carte/wallet.
5. Envoyer un pourboire.

Attendu:

- Solde passager/chauffeur exact
- Transactions créées une seule fois
- `tipAmount` enregistré sur la course

### Cas de test C — Notifications push FCM

Tester 3 états:

- Foreground
- Background
- App killée

Événements à vérifier:

- Course acceptée
- Chauffeur arrivé
- Course terminée
- Pourboire reçu (chauffeur)

### Cas de test D — Téléphone et support

1. Depuis passager: appeler le chauffeur.
2. Depuis écran support: appel et email support.

Attendu:

- Ouverture de l'application téléphone/mail
- Numéros/emails corrects

### Go / No-Go

Go si:

- 0 bug critique bloquant
- Paiement + push + GPS temps réel validés sur 2 appareils
- Logs backend sans erreurs 5xx récurrentes
