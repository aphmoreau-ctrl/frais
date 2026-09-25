// Données de départ, toutes modifiables dans Réglages.
export const RAYONS=[
 {id:'fl',nom:'Fruits et légumes',court:'F&L',couleur:'#4E8A1E'},
 {id:'bo',nom:'Boucherie',court:'Boucherie',couleur:'#B03A36'},
 {id:'tr',nom:'Charcuterie traiteur',court:'Traiteur',couleur:'#C07A12'},
 {id:'cr',nom:'Crèmerie LS frais',court:'Crèmerie',couleur:'#2B76B8'},
 {id:'bl',nom:'Boulangerie pâtisserie',court:'Boulangerie',couleur:'#8B5A2B'}];
export const CRITERES={
 fl:['Remplissage, abondance','Fraîcheur, qualité visuelle','Tri, produits abîmés retirés','Rotation, dates courtes devant','Prix affichés corrects','Promotions en place','Propreté des bacs et sols','Origine et signalétique'],
 bo:['Vitrine pleine et soignée','Fraîcheur, présentation','Attente à la coupe','Prix et étiquetage','Rotation, dates courtes devant','Propreté'],
 tr:['Vitrine pleine et soignée','Fraîcheur, présentation','Attente à la coupe','Prix et étiquetage','Rotation, dates courtes devant','Propreté'],
 cr:['Remplissage','Rotation, dates courtes devant','Prix affichés corrects','Promotions en place','Ruptures visibles','Propreté'],
 bl:['Remplissage','Fraîcheur','Prix affichés corrects','Propreté']};
export const CAUSES=['Commande','Livraison','Mise en rayon','Autre'];
const J=[{id:'t1',t:"Tournée d'ouverture",h:'06:30',go:'tournee'},{id:'t2',t:'Relevé ruptures',h:'11:00',go:'ruptures'},{id:'t3',t:'Relevé ruptures',h:'17:00',go:'ruptures'},{id:'t4',t:'Bilan et photos de fermeture',h:'20:00',go:'bilan'}];
export const ROUTINE={0:[],1:J,2:J,3:J,4:J,5:J,6:J};
export const PLAN=[
 {id:'p1',t:'Terrain : une journée par rayon, routine, outils',du:'2026-11-02',au:'2026-11-15'},
 {id:'p2',t:'État des lieux des fêtes',du:'2026-11-16',au:'2026-11-22'},
 {id:'p3',t:'Suivi des pré-commandes, risques',du:'2026-11-23',au:'2026-12-20'},
 {id:'p4',t:'Rush des fêtes, carnet, démarque',du:'2026-12-21',au:'2027-01-03'},
 {id:'p5',t:'Chiffres de l\'année, tableau de bord',du:'2027-01-04',au:'2027-01-10'},
 {id:'p6',t:'Entretiens chefs de rayon',du:'2027-01-11',au:'2027-01-17'},
 {id:'p7',t:'Analyse : top 20 démarque, 3 actions',du:'2027-01-18',au:'2027-01-24'},
 {id:'p8',t:'Restitution à M. Eude',du:'2027-01-25',au:'2027-01-31'},
 {id:'p9',t:'Pilote fruits et légumes',du:'2027-02-01',au:'2027-02-28'},
 {id:'p10',t:'Bilan du pilote et extension au LS frais',du:'2027-03-01',au:'2027-03-31'},
 {id:'p11',t:'Stands traditionnels, formations, bilan 6 mois',du:'2027-04-01',au:'2027-04-30'},
 {id:'p12',t:'Producteurs locaux, animations',du:'2027-05-01',au:'2027-05-31'},
 {id:'p13',t:'Meubles froids, préparation de l\'été',du:'2027-06-01',au:'2027-06-30'}];
export const AGENDA=[
 ['2026-11-11','Armistice (férié)'],['2026-11-19','Beaujolais nouveau'],['2026-12-19','Début des vacances de Noël'],['2026-12-24','Veille de Noël · retraits'],['2026-12-25','Noël (férié)'],['2026-12-31','Réveillon · retraits'],['2027-01-01','Jour de l\'an (férié)'],['2027-01-03','Épiphanie · galettes'],['2027-02-02','Chandeleur'],['2027-02-14','Saint-Valentin'],['2027-03-28','Pâques'],['2027-03-29','Lundi de Pâques (férié)'],['2027-05-01','Fête du travail (férié)'],['2027-05-06','Ascension (férié)'],['2027-05-08','Victoire 1945 (férié)'],['2027-05-17','Lundi de Pentecôte'],['2027-05-30','Fête des mères'],['2027-06-20','Fête des pères']];
export function defaultConfig(){
 return {rayons:RAYONS,criteres:CRITERES,causes:CAUSES,routine:ROUTINE,ordre:['fl','bo','tr','cr','bl'],
  meubles:[{id:'m1',nom:'Meuble froid F&L',rayon:'fl',max:8},{id:'m2',nom:'Vitrine boucherie',rayon:'bo',max:4},{id:'m3',nom:'Vitrine traiteur',rayon:'tr',max:4},{id:'m4',nom:'Meuble LS crèmerie 1',rayon:'cr',max:4}],
  produits:[],seuilRuptures:3,verrou:5};
}
