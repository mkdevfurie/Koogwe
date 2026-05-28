## Déploiement Production (Railway + Render)

Ce document liste les variables nécessaires et l'ordre de déploiement recommandé.

### 1) Variables obligatoires (Railway et Render)

- `NODE_ENV=production`
- `PORT=3000`
- `DATABASE_URL`
- `DIRECT_URL`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `JWT_ACCESS_EXPIRES_IN=15m`
- `JWT_REFRESH_EXPIRES_IN=30d`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `FRONTEND_URLS` (origines autorisées, séparées par virgules)

### 2) Paiements Stripe (obligatoire si cartes/recharge)

- `STRIPE_SECRET_KEY`
- `STRIPE_PUBLISHABLE_KEY`
- `STRIPE_WEBHOOK_SECRET`

Webhook à configurer dans Stripe:

- URL: `https://<votre-domaine>/api/webhooks/stripe`
- Event minimum: `payment_intent.succeeded`

### 3) Notifications push (optionnel mais recommandé prod)

- `FIREBASE_SERVICE_ACCOUNT_JSON` (JSON complet du compte de service Firebase, sur une seule ligne)

### 4) Services tiers

- `RESEND_API_KEY`
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`

### 5) Tarification / métier

- `PLATFORM_COMMISSION_RATE=0.2`
- `PRICING_PICKUP_FEE`
- `PRICING_KM_MOTO`
- `PRICING_KM_ECO`
- `PRICING_KM_CONFORT`
- `PRICING_KM_VAN`
- `PRICING_KM_LUXE`
- `PRICING_MINUTE_RATE`
- `PRICING_MIN_PRICE`
- `DRIVER_SEARCH_RADIUS_KM`
- `OTP_MAX_ATTEMPTS=5`

### 6) Déploiement Railway

1. Configurer toutes les variables ci-dessus.
2. Déployer le code.
3. Vérifier l'exécution de la migration:
   - `npx prisma migrate deploy`
4. Vérifier la santé:
   - `GET /api/health`
5. Vérifier webhook Stripe:
   - test event `payment_intent.succeeded`

### 7) Déploiement Render

Le fichier `render.yaml` est fourni.

Points importants:

- Build command: `npm ci && npx prisma generate && npm run build`
- Start command: `npx prisma migrate deploy && npm run start:prod`
- Health check: `/api/health`

### 8) Checklist de validation post-déploiement

- Inscription + connexion passager/chauffeur
- Création course + acceptation chauffeur
- Position chauffeur en temps réel
- Paiement carte/wallet + recharge Stripe
- Notifications in-app visibles
- Pourboire (`POST /rides/:id/tip`)
- Dashboard admin accessible
