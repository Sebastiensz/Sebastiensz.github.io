require([
  "esri/Map",
  "esri/views/MapView",
  "esri/layers/FeatureLayer",
  "esri/layers/support/LabelClass",
  "esri/widgets/Locate",
  "esri/widgets/Search",
  "esri/tasks/Locator"
],
  function (
    Map,
    MapView,
    FeatureLayer,
    LabelClass,
    Locate,
    Search,
    Locator
  ) {

    // Échelle en dessous de laquelle on bascule des agrégats vers les stations une à une
    var SEUIL_POINTS = 200000;
    // Filtre neutre (ObjectId est bien le champ identifiant du service "carburants")
    var EXPR_TOUS = "ObjectId IS NOT NULL";
    // Dernier relevé réellement présent dans le service (dataLastEditDate = 2022-10-08).
    // Les données ne sont plus alimentées : on affiche la date au lieu de promettre du temps réel.
    var DATE_DONNEES = "08/10/2022";

    var errorBanner = document.getElementById("errorBanner");
    var filterNotice = document.getElementById("filterNotice");
    var loading = document.getElementById("loading");

    function afficherNotice(noeud, message) {
      if (!noeud) { return; }
      noeud.textContent = message;
      noeud.hidden = false;
    }

    function masquerNotice(noeud) {
      if (!noeud) { return; }
      noeud.hidden = true;
    }

    function masquerChargement() {
      if (loading) { loading.hidden = true; }
    }

    // Une couche en échec ne doit pas rester silencieuse : sans message,
    // l'utilisateur ne voit qu'une carte vide sans en connaître la raison.
    function signalerEchecCouche(couche, erreur) {
      var nom = (couche.url || "").split("/services/")[1] || "couche";
      var detail = (erreur && erreur.message) ? erreur.message : "erreur inconnue";
      afficherNotice(errorBanner, "Données indisponibles (" + nom + ") : " + detail);
    }

    var map = new Map({
      basemap: "gray-vector"
    });

    var view = new MapView({
      container: "viewDiv",
      map: map,
      center: [1.2365058, 46.0743763],
      scale: 9000000,
      constraints: {
        maxZoom: 15,
        minZoom: 5
      }
    });

    // Emprise approximative de la France métropolitaine, en mètres Web Mercator
    var FRANCE_LARGEUR_M = 1660000;
    var FRANCE_HAUTEUR_M = 1600000;

    // Cadrage initial calculé d'après la taille réelle du conteneur : l'échelle
    // fixe de 9 000 000, calibrée pour un grand écran, coupait tout l'est du
    // pays (Marseille, Strasbourg, la Corse) sur un mobile en portrait.
    function cadrerFrance() {
      if (!view.width || !view.height || !view.scale) { return; }
      var resolution = Math.max(FRANCE_LARGEUR_M / view.width, FRANCE_HAUTEUR_M / view.height);
      var echelleVoulue = resolution * 96 / 0.0254;
      // Les niveaux de zoom du fond de plan vont du simple au double : on déduit
      // le niveau visé de l'état courant de la vue, sans présumer du tuilage.
      var zoomVoulu = Math.floor(view.zoom - Math.log(echelleVoulue / view.scale) / Math.LN2);
      zoomVoulu = Math.max(2, Math.min(15, zoomVoulu));
      // Sur un écran étroit, la France entière n'entre pas dans le niveau 5 :
      // on desserre la borne de dézoom juste ce qu'il faut.
      if (view.constraints.minZoom > zoomVoulu) {
        view.constraints.minZoom = zoomVoulu;
      }
      view.zoom = zoomVoulu;
    }

    var featureLayer = new FeatureLayer({
      url: "https://services.arcgis.com/d3voDfTFbHOCRwVR/arcgis/rest/services/carburants/FeatureServer/0",
      outFields: ["*"],
      title: '',
      // Masquée au démarrage : à l'échelle de la France on affiche les agrégats.
      // L'état est ensuite piloté explicitement par majEtatEchelle().
      visible: false
    });

    // Displays two values returned from Arcade expressions
    // in a table within the popup when a feature is clicked
    featureLayer.popupTemplate = {
      title: "Station-service — relevé du " + DATE_DONNEES,
      content: [{
        type: "fields",
        fieldInfos: [{
          fieldName: "expression/adresse"
        }, {
          fieldName: "expression/ville"
        }, {
          fieldName: "expression/automate"
        }, {
          fieldName: "expression/gazole"
        }, {
          fieldName: "expression/sp95"
        }, {
          fieldName: "expression/sp98"
        }, {
          fieldName: "expression/e10"
        }, {
          fieldName: "expression/e85"
        }]
      },
      {
        type: "text",
        text: "Données open data figées au " + DATE_DONNEES + ", non mises à jour — démonstration cartographique.<br>" +
          "Source : <a href=\"https://www.prix-carburants.gouv.fr/rubrique/opendata\" target=\"_blank\" rel=\"noopener noreferrer\">prix-carburants.gouv.fr (open data)</a>"
      }],
      expressionInfos: [{
        name: "adresse",
        title: "Adresse",
        expression: "Proper($feature.Adresse, 'everyword')"
      }, {
        name: "ville",
        title: "Ville",
        expression: "Proper($feature.Ville, 'everyword')"
      }, {
        name: "automate",
        title: "24h/24h",
        expression: "$feature.Automate24_24"
      }, {
        name: "gazole",
        title: "Gazole",
        expression: "IIf($feature.Gazole != 99999, $feature.Gazole + ' €', 'Non communiqué');"
      }, {
        name: "sp95",
        title: "Sans Plomb 95%",
        expression: "IIf($feature.SP95 != 99999, $feature.SP95 + ' €', 'Non communiqué');"
      }, {
        name: "sp98",
        title: "Sans Plomb 98%",
        expression: "IIf($feature.SP98 != 99999, $feature.SP98 + ' €', 'Non communiqué');"
      }, {
        name: "e10",
        title: "E10",
        expression: "IIf($feature.E10 != 99999, $feature.E10 + ' €', 'Non communiqué');"
      }, {
        name: "e85",
        title: "E85",
        expression: "IIf($feature.E85 != 99999, $feature.E85 + ' €', 'Non communiqué');"
      }]
      // Pas de ligne GPLC : le champ vaut 99999 (non communiqué) sur la
      // totalité des 9 921 stations du service, la ligne était toujours vide.
    };

    var agregation = new FeatureLayer({
      url: "https://services.arcgis.com/d3voDfTFbHOCRwVR/arcgis/rest/services/carburants_reg/FeatureServer/0",
      outFields: ["POINT_COUNT"],
      title: '',
      visible: true
    });

    // Attention : le service publié s'appelle bien "carburatns_dep" (faute de frappe
    // côté publication). "carburants_dep" n'existe pas et renvoie {"error":400} :
    // ne pas « corriger » cette URL. Elle porte l'agrégation départementale
    // affichée entre les échelles 3 849 897 et 200 001.
    var agregationdep = new FeatureLayer({
      url: "https://services.arcgis.com/d3voDfTFbHOCRwVR/arcgis/rest/services/carburatns_dep/FeatureServer/0",
      outFields: ["POINT_COUNT"],
      title: '',
      visible: true,
      definitionExpression: "POINT_COUNT > 0"
    });

    const statesLabelClass = new LabelClass({
      labelExpressionInfo: { expression: "$feature.POINT_COUNT" },
      symbol: {
        type: "text",
        color: "white",
        haloSize: 1,
        haloColor: "black"
      }
    });

    agregation.labelingInfo = [statesLabelClass];
    agregation.labelsVisible = true

    agregationdep.labelingInfo = [statesLabelClass];
    agregationdep.labelsVisible = true

    map.add(agregation);
    map.add(agregationdep);
    map.add(featureLayer);

    [agregation, agregationdep, featureLayer].forEach(function (couche) {
      couche.when(null, function (erreur) {
        signalerEchecCouche(couche, erreur);
      });
    });

    var locateWidget = new Locate({
      view: view
    });

    // Add the locate widget to the top left corner of the view
    view.ui.add(locateWidget, {
      position: "top-left"
    });


    var searchWidget = new Search({
      view: view,
      allPlaceholder: "Recherche par ville",
      locationEnabled: true,
      includeDefaultSources: false
    });

    // Géocodeur exposé via le proxy d'une organisation ArcGIS Online tierce
    // (utility.arcgis.com/usrsvcs/servers/<orgId>/...) : il peut être re-sécurisé
    // sans préavis, auquel cas la recherche cesserait de répondre.
    const sources = [
      {
        locator: new Locator({ url: "https://utility.arcgis.com/usrsvcs/servers/60a8871933e44a249ca71bb13c2d823d/rest/services/World/GeocodeServer" }),
        singleLineFieldName: "SingleLine",
        name: "Géocodage sur la France",
        placeholder: "Rechercher",
        maxResults: 3,
        maxSuggestions: 6,
        suggestionsEnabled: false,
        minSuggestCharacters: 0
      }];

    searchWidget.sources = sources;
    searchWidget.defaultSources = sources;
    searchWidget.searchAllEnabled = false;

    // Adds the search widget below other elements in
    // the top left corner of the view
    view.ui.add(searchWidget, {
      position: "top-right",
      index: 2
    });

    var typeC = document.createElement("select");
    typeC.className = "custom-select text-dark is-hidden";
    typeC.setAttribute("aria-label", "Type de carburant");
    typeC.onchange = function () {
      setVisibilityFilter(this)
    };
    var all = document.createElement("option");
    var allText = document.createTextNode("Tous");
    all.appendChild(allText);
    all.value = "all";
    typeC.appendChild(all);

    var gazoil = document.createElement("option");
    var gazoilText = document.createTextNode("Gazole");
    gazoil.appendChild(gazoilText);
    gazoil.value = "Gazole";
    typeC.appendChild(gazoil);

    var sans95 = document.createElement("option");
    var sans95Text = document.createTextNode("SP 95");
    sans95.appendChild(sans95Text);
    sans95.value = "SP95";
    typeC.appendChild(sans95);

    var sans98 = document.createElement("option");
    var sans98Text = document.createTextNode("SP 98");
    sans98.appendChild(sans98Text);
    sans98.value = "SP98";
    typeC.appendChild(sans98);

    var edix = document.createElement("option");
    var edixText = document.createTextNode("E10");
    edix.appendChild(edixText);
    edix.value = "E10";
    typeC.appendChild(edix);

    var eqc = document.createElement("option");
    var eqcText = document.createTextNode("E85");
    eqc.appendChild(eqcText);
    eqc.value = "E85";
    typeC.appendChild(eqc);

    // Pas d'option GPLc : le filtre "GPLc != 99999" ne ramenait aucune station
    // et vidait donc systématiquement la carte sans le moindre message.

    view.ui.add(typeC, "bottom-right");


    var autom = document.createElement("BUTTON");
    var automText = document.createTextNode("24h/24h");
    autom.appendChild(automText);
    autom.className = "btn bg-white text-dark is-hidden";
    autom.value = "Automate24_24";
    autom.setAttribute("aria-label", "Afficher uniquement les stations ouvertes 24h/24");
    autom.onclick = function () {
      defExpression(this); return false;
    };
    view.ui.add(autom, "bottom-right");

    var clearFilter = document.createElement("BUTTON");
    var clearFilterText = document.createTextNode("Effacer");
    clearFilter.appendChild(clearFilterText);
    clearFilter.className = "btn bg-white text-dark is-hidden";
    clearFilter.value = "clear";
    clearFilter.setAttribute("aria-label", "Effacer les filtres");
    clearFilter.onclick = function () {
      defExpression(this); return false;
    };
    view.ui.add(clearFilter, "bottom-right");

    // display:none plutôt que visibility:hidden : les contrôles hors plage
    // d'échelle sortent aussi de l'ordre de tabulation.
    function setControlesVisibles(visibles) {
      [typeC, autom, clearFilter].forEach(function (noeud) {
        if (visibles) {
          noeud.classList.remove("is-hidden");
        } else {
          noeud.classList.add("is-hidden");
        }
      });
    }

    // Applique un filtre et prévient si le résultat est vide, plutôt que de
    // laisser l'utilisateur devant une carte muette
    function appliquerExpression(expression) {
      if (featureLayer.definitionExpression !== expression) {
        featureLayer.definitionExpression = expression;
      }
      featureLayer.queryFeatureCount({ where: expression }).then(function (nb) {
        if (nb === 0) {
          afficherNotice(filterNotice, "Aucune station ne correspond à ce filtre.");
        } else {
          masquerNotice(filterNotice);
        }
      }, function () {
        masquerNotice(filterNotice);
      });
    }

    function setVisibilityFilter(event) {
      if (event.value == "all") {
        appliquerExpression(EXPR_TOUS)
      }
      else {
        let champsFl = event.value
        appliquerExpression(champsFl + " != 99999")
      }

    }

    function defExpression(btn) {
      if (btn.value == "Automate24_24") {
        appliquerExpression("Automate24_24 = 'Oui'")
      }
      else {
        typeC.value = "all";
        appliquerExpression(EXPR_TOUS)
      }
    };

    // État posé explicitement (et pas seulement au premier changement d'échelle) :
    // appelé au démarrage depuis view.when() puis à chaque variation d'échelle.
    function majEtatEchelle(scale) {
      var afficherPoints = scale <= SEUIL_POINTS;
      featureLayer.visible = afficherPoints;
      setControlesVisibles(afficherPoints);
      if (!afficherPoints) {
        // Le filtre repasse à neutre : le sélecteur doit suivre, sinon il
        // annonce un carburant qui n'est plus appliqué à la couche.
        if (featureLayer.definitionExpression !== EXPR_TOUS) {
          featureLayer.definitionExpression = EXPR_TOUS;
        }
        typeC.value = "all";
        masquerNotice(filterNotice);
      }
    }

    view.watch("scale", function (newValue) {
      majEtatEchelle(newValue);
    });

    view.when(function () {
      cadrerFrance();
      majEtatEchelle(view.scale);
      view.whenLayerView(agregation).then(masquerChargement, masquerChargement);
    }, function (erreur) {
      masquerChargement();
      afficherNotice(errorBanner, "La carte n'a pas pu être initialisée : " +
        ((erreur && erreur.message) ? erreur.message : "erreur inconnue"));
    });

    // Filet de sécurité : l'indicateur de chargement ne doit jamais rester bloqué
    setTimeout(masquerChargement, 20000);
  });
