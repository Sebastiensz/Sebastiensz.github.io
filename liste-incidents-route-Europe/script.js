// ÉTAT DE LA SOURCE DE DONNÉES (constat du 2026-09-12)
// Le jeu de données ArcGIS Open Data utilisé par cette carte (item
// f35c1b885e1043bc8482e3cfe43819d7) a été supprimé par son fournisseur :
// l'URL répond 400 « Item does not exist or is inaccessible ».
// Aucune source publique équivalente n'a pu être identifiée pour l'Europe
// (le World Traffic Service d'Esri, qui porte le même schéma de champs,
// plafonne ses requêtes à 10 entités et exige une clé d'API).
// La carte reste donc navigable mais ne peut afficher aucun incident :
// l'échec est signalé explicitement à l'utilisateur (voir signalerDonneesIndisponibles).

//Filet de sécurité : si l'API ArcGIS elle-même ne se charge pas, le code ci-dessous
//ne s'exécute jamais. On évite alors de laisser tourner l'indicateur d'attente à l'infini.
window.setTimeout(function() {
    const loading = document.getElementById("loading");
    if (loading && !loading.hidden) {
        loading.innerText = "La carte n'a pas pu être chargée. Vérifiez votre connexion, puis rechargez la page.";
    }
}, 30000);

require([
    "esri/Map",
    "esri/views/MapView",
    "esri/layers/GeoJSONLayer",
    "esri/widgets/Legend",
    "esri/widgets/Expand",
    "esri/widgets/Home",
    "esri/widgets/Fullscreen",
    "esri/widgets/BasemapGallery",
], function(Map, MapView, GeoJSONLayer, Legend, Expand, Home, Fullscreen, BasemapGallery) {

    var map = new Map({
        basemap: "topo-vector"
    });

    // Création de la map centrée sur lyon
    var view = new MapView({
        container: "viewDiv",
        map: map,
        center: [4.8654488, 45.747671],
        zoom: 5
    });

    var other = {
        type: "simple-marker",
        color: "black",
        size: "8px", // pixels
    };

    // Severity symbols
    var critical = {
        type: "simple-marker",
        color: "red",
        size: "20px", // pixels
    };

    var major = {
        type: "simple-marker",
        color: "orange",
        size: "16px", // pixels
    };

    var low_impact = {
        type: "simple-marker",
        color: "yellow",
        size: "12px", // pixels
    };

    var minor = {
        type: "simple-marker",
        color: "white",
        size: "8px", // pixels
    };

    var SeverityServiceRenderer = {
        type: "unique-value",
        field: "severity",
        defaultSymbol: other,
        uniqueValueInfos: [{

                value: "critical",
                symbol: critical
            },
            {
                value: "major",
                symbol: major

            }, {
                value: "low_impact",
                symbol: low_impact
            }, {
                value: "minor",
                symbol: minor
            }
        ]
    };

    //Create pop-up variable
    var popup = {
        "title": "{incidenttype}", //incidenttype est une propriété de la couche GeoJSON
        "content": "<br>{start_localtime}<br>{fulldescription}"
    };

    // Créer une couche avec les données des incidents de la route
    var traffic_incident = new GeoJSONLayer({
        url: "https://opendata.arcgis.com/datasets/f35c1b885e1043bc8482e3cfe43819d7_20.geojson",
        renderer: SeverityServiceRenderer,
        popupTemplate: popup
    });

    //Création d'une légende
    var legend = new Legend({
        view: view,
        layerInfos: [{
            layer: traffic_incident,
            title: "Sévérité"
        }]
    });

    //Ajout du titre à gauche
    const titleDiv = document.getElementById("titleDiv");
    view.ui.add(titleDiv, "top-left");

    //Affichage de la légende
    view.ui.add(
        new Expand({
            view: view,
            content: legend,
            expandTooltip: "Légende"
        }),
        "top-left"
    );

    //Ajout de la basemap
    var basemapGallery = new BasemapGallery({
        view: view,
        source: {
            portal: {
                url: "https://www.arcgis.com",
                useVectorBasemaps: true // Load vector tile basemaps
            }
        }
    });
    view.ui.add(
        new Expand({
            view: view,
            content: basemapGallery,
            expandTooltip: "Fonds de carte"
        }),
        "top-left"
    );

    //Affichage d'un bouton home
    view.ui.add(
        new Home({
            view: view
        }),
        "top-left"
    );

    //Affichage d'un bouton plein ecran
    view.ui.add(
        new Fullscreen({
            view: view,
        }),
        "bottom-right"
    );

    // On ajoute la couche à la vue existante
    map.add(traffic_incident, 0);

    //Ajout du champ filtre
    const formDiv = document.getElementById("formDiv");
    view.ui.add(
        new Expand({
            view: view,
            content: formDiv,
            expandIconClass: "esri-icon-layer-list",
            expandTooltip: "Filtres des incidents",
            //Sur petit écran le panneau s'ouvre en modal et recouvre la carte :
            //on ne le déplie d'office que sur les écrans larges
            expanded: window.matchMedia("(min-width: 768px)").matches
        }),
        "top-right"
    );

    const filter = document.getElementById("filter");
    const filterType = document.getElementById("filter-type");
    const filterDate = document.getElementById("filter-date");
    const toggleButton = document.getElementById("cluster");
    const loadingDiv = document.getElementById("loading");
    const dataErrorDiv = document.getElementById("dataError");

    //Masque l'indicateur d'attente
    function masquerChargement() {
        loadingDiv.hidden = true;
    }

    //Affiche un message d'alerte visible par-dessus la carte
    function afficherAlerte(message) {
        masquerChargement();
        dataErrorDiv.innerHTML = message;
        dataErrorDiv.hidden = false;
    }

    //Signale que la couche d'incidents n'a pas pu être chargée et neutralise
    //les commandes qui n'ont plus d'objet, au lieu de laisser une carte vide
    //et des filtres qui font illusion
    function signalerDonneesIndisponibles() {
        afficherAlerte(
            "<strong>Données indisponibles.</strong> Le jeu de données source " +
            "(ArcGIS Open Data, item f35c1b885e1043bc8482e3cfe43819d7) a été " +
            "supprimé par son fournisseur : aucun incident ne peut être affiché. " +
            "La carte reste navigable."
        );
        filterType.disabled = true;
        filterDate.disabled = true;
        toggleButton.disabled = true;
        filter.title = "Filtres indisponibles : aucune donnée chargée";
        toggleButton.title = "Regroupement indisponible : aucune donnée chargée";
    }

    //Script pour les filtres
    function activerFiltres(layerView) {
        filter.addEventListener("change", function(event) {

            // Filtre les incidents par type
            const conditionType = "incidenttype = '" + filterType.value + "'";
            const whereClauseType = filterType.value ? conditionType : "";

            // Filtre les incidents par année de début. Le GeoJSONLayer type
            // start_utctime en texte (dates ISO 8601) : la comparaison est donc
            // lexicographique, ce qui respecte l'ordre chronologique de l'ISO 8601.
            // Un littéral SQL DATE lèverait ici une erreur « SQL Invalid Date ».
            // Borne haute exclusive pour ne perdre aucune seconde de l'année.
            const anneeSuivante = Number(filterDate.value) + 1;
            const conditionDate = `start_utctime >= '${filterDate.value}-01-01' AND start_utctime < '${anneeSuivante}-01-01'`;
            const whereClauseDate = filterDate.value ? conditionDate : "";

            // Les deux filtres sont indépendants : on n'assemble que ceux qui sont renseignés
            const clauses = [whereClauseType, whereClauseDate].filter(Boolean);
            layerView.filter = clauses.length ? { where: clauses.join(" AND ") } : null;

            view.popup.close();

        });
    }

    //On masque l'indicateur d'attente dès que la carte est prête
    view.when(masquerChargement, function() {
        afficherAlerte("<strong>Carte indisponible.</strong> L'initialisation de la vue cartographique a échoué.");
    });

    //Chargement explicite de la couche : sans cela l'échec resterait silencieux
    //côté utilisateur (seule la console du navigateur en garderait la trace)
    traffic_incident.load().then(function() {
        return view.whenLayerView(traffic_incident);
    }).then(activerFiltres).catch(signalerDonneesIndisponibles);

    //Bouton de regroupement
    const clusterConfig = {
        type: "cluster",
        clusterRadius: "100px",
        popupTemplate: {
            content: "Ce regroupement représente {cluster_count} incidents de la route."
        }
    };

    toggleButton.addEventListener("click", function() {
        let fr = traffic_incident.featureReduction;
        const regroupementActif = !(fr && fr.type === "cluster");
        traffic_incident.featureReduction = regroupementActif ? clusterConfig : null;
        toggleButton.innerText =
            regroupementActif ? "Désactiver regroupement" : "Activer regroupement";
        toggleButton.setAttribute("aria-pressed", String(regroupementActif));
    });

    //Déplacer les élements après le titre
    view.ui.components = ["attribution", "compass", "zoom"];

});