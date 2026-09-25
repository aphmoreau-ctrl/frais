# Rayons frais — Version 1

Appli personnelle de suivi quotidien des rayons frais : tournée guidée, suivis, températures, ruptures (avec scan), journal, bilan du soir, plan, réglages. Fonctionne hors ligne sur iPhone, iPad et ordinateur, synchronisée par Firebase.

Tant que `firebase-config.js` est vide, l'appli tourne en **mode essai** : tout reste sur l'appareil, rien n'est synchronisé.

---

## Étape 1 — Créer le projet Firebase (15 min, une seule fois)

1. Va sur https://console.firebase.google.com et connecte-toi avec un compte Google **personnel**.
2. **Ajouter un projet** → nom : `rayons-frais` → désactive Google Analytics → Créer.
   Utilise un projet séparé de celui d'APH, pour ne jamais mélanger les données.
3. **Authentication** → Commencer → onglet *Méthode de connexion* → **Adresse e-mail/Mot de passe** → Activer → Enregistrer.
4. Toujours dans Authentication → onglet *Utilisateurs* → **Ajouter un utilisateur** : ton e-mail et un mot de passe solide. C'est le seul compte qui pourra se connecter.
5. **Firestore Database** → Créer une base de données → emplacement en **Europe** (par exemple `europe-west9`, Paris) → mode **production** → Créer.
6. Dans Firestore → onglet **Règles** → remplace tout par le contenu du fichier `firestore.rules` → **Publier**.
   Ces règles n'autorisent l'accès qu'à ton compte.
7. Roue dentée → **Paramètres du projet** → *Vos applications* → icône **</>** (Web) → surnom `Frais` → n'active pas Hosting → Enregistrer.
   Firebase affiche un bloc `firebaseConfig = { apiKey: ..., ... }`. Copie ces valeurs dans `firebase-config.js`.

La clé `apiKey` n'est pas un secret : elle identifie le projet. La protection vient de la connexion et des règles de l'étape 6.

## Étape 2 — Mettre l'appli en ligne sur GitHub Pages (10 min)

1. Sur GitHub, crée un nouveau dépôt, par exemple `frais`.
2. Envoie **tous les fichiers de ce dossier** (tous au même niveau, sans dossier).
3. Dépôt → **Settings** → **Pages** → *Deploy from a branch* → branche `main`, dossier `/ (root)` → Save.
4. Après une minute, l'appli est disponible à l'adresse `https://TON-PSEUDO.github.io/frais/`.
5. Retour dans Firebase → **Authentication** → *Paramètres* → **Domaines autorisés** → Ajouter `TON-PSEUDO.github.io`.

Le code est public sur GitHub, mais il ne contient **aucune donnée** : les données sont uniquement dans ton espace Firebase protégé.

## Étape 3 — Installer sur les appareils

- **iPhone et iPad** : ouvre l'adresse dans **Safari** → bouton Partager → **Sur l'écran d'accueil**. Lance l'appli depuis l'icône « Frais ».
- **Ordinateur** : ouvre l'adresse dans Chrome ou Edge → icône d'installation dans la barre d'adresse (ou simple favori).
- Connecte-toi avec l'e-mail et le mot de passe créés à l'étape 1.4, sur chaque appareil.
- Dans **Réglages → Code d'accès**, crée un code à 4 chiffres sur chaque appareil.

## Étape 4 — Avant le 2 novembre

- **Réglages → Rayons** : vérifie les rayons et l'ordre de ta tournée.
- **Réglages → Critères** : ajuste les critères de chaque rayon.
- **Réglages → Meubles froids** : les meubles et leurs seuils, d'après le plan de maîtrise sanitaire du magasin. Complète pendant tes deux premières semaines.
- **Réglages → Routine** : les tâches et les heures de chaque jour.
- **App Rappels de l'iPhone** : crée les rappels aux mêmes heures que la routine.
- **Plus → Raccourcis iPhone** : crée les raccourcis Siri (« rupture », « note frais », « tournée », « bilan »).

## Sauvegarde

Le 1er de chaque mois, l'appli te le rappelle : **Réglages → Données → Télécharger une sauvegarde complète**. Garde le fichier hors de l'appli (ordinateur, disque externe).

## Bon à savoir

- **Hors ligne** : tout s'enregistre sur l'appareil et part au serveur dès que le réseau revient. L'indicateur en haut de l'accueil affiche « synchronisé », « en attente d'envoi » ou « hors ligne ».
- **Photos** : compressées sur l'appareil (environ 150 Ko) avant l'envoi. L'offre gratuite de Firebase suffit pour plusieurs milliers de photos.
- **Scan** : à la première utilisation, l'iPhone demande l'accès à l'appareil photo. Accepte.
- **Suppression** : les éléments supprimés restent 30 jours dans la corbeille, puis sont effacés définitivement.
- **RGPD** : aucun champ ne sert à juger une personne. Les commentaires portent sur des faits.
- **Mise à jour** : quand une nouvelle version est envoyée sur GitHub, ferme et rouvre l'appli (deux fois si besoin) pour la charger.

## Contenu de la V1

Journée (prochaine tâche, routine, alertes, veille, agenda) · Tournée guidée · Suivis · Températures · Ruptures (scan, favoris, contrôle, stats) · Journal (notes, photos, mots-clés, recherche, actions) · Bilan du soir · Historique (observations, évolution, galerie) · Plan · Réglages · Sauvegarde · Code d'accès.

À venir : V2 (fêtes, planning, présents, intérimaires, consignes), V3 (tableau de bord, équipes, actions complètes, rapports), V4 (démarque, prévisions, optimisation), V5 (local, animations, meubles froids).
