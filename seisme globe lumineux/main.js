require([
  "esri/Map",
  "esri/views/SceneView",
  "esri/layers/CSVLayer",
  "esri/layers/FeatureLayer",
  "esri/Basemap",
  "esri/core/watchUtils"
], function(Map, SceneView, CSVLayer, FeatureLayer, Basemap, watchUtils) {
  // années disponibles dans ./data (un fichier CSV annuel par année)
  const PREMIERE_ANNEE = 2010;
  const DERNIERE_ANNEE = 2021;
  const ANNEE_PAR_DEFAUT = 2020;
  // délai avant que la rotation automatique ne reprenne après une interaction
  const DELAI_REPRISE_ROTATION = 5000;
  // types d'événements USGS présents dans les données (99,5 % sont des séismes).
  // L'article est porté par la table : « explosion » est féminin, pas les autres.
  const TYPES_EVENEMENT = {
    earthquake: "Un séisme",
    "volcanic eruption": "Un événement volcanique",
    "mining explosion": "Un tir de mine",
    "nuclear explosion": "Un essai nucléaire",
    "rock burst": "Un coup de toit",
    collapse: "Un effondrement",
    "mine collapse": "Un effondrement minier",
    landslide: "Un glissement de terrain",
    explosion: "Une explosion",
    "quarry blast": "Un tir de carrière",
    "ice quake": "Un séisme glaciaire",
    "other event": "Un événement de type indéterminé"
  };
  // doit rester aligné sur la media query de style.css : écran étroit OU écran court
  // (un téléphone en paysage fait 844x390 : large, mais le panneau y mange tout)
  const PETIT_ECRAN = window.matchMedia("(max-width: 768px), (max-height: 500px)").matches;

  const statusElement = document.getElementById("status");
  const titleElement = document.getElementById("page-title");
  const legendIntro = document.getElementById("legend-intro");
  const yearSelect = document.getElementById("year-select");
  const listElement = document.getElementById("earthquake-list");

  let statutEnErreur = false;
  // vue 3D morte : le message est définitif, plus rien ne doit le remplacer ni le masquer
  let vue3dIndisponible = false;

  function afficherStatut(message, estErreur) {
    if (vue3dIndisponible && !estErreur) {
      return;
    }
    statusElement.textContent = message;
    statusElement.classList.toggle("error", !!estErreur);
    statusElement.style.display = "block";
    statutEnErreur = !!estErreur;
  }

  // un message d'erreur reste affiché : il ne doit pas être effacé par un chargement qui réussit
  function masquerStatut() {
    if (!statutEnErreur && !vue3dIndisponible) {
      statusElement.style.display = "none";
    }
  }

  const countryBorders = new FeatureLayer({
    url:
      "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/World_Countries_(Generalized)/FeatureServer/0",
    renderer: {
      type: "simple",
      symbol: {
        type: "polygon-3d",
        symbolLayers: [
          {
            type: "fill",
            outline: {
              color: [255, 99, 71, 0.8],
              size: 1
            }
          }
        ]
      }
    }
  });

  const plateTectonicBorders = new FeatureLayer({
    url:
      "https://services2.arcgis.com/cFEFS0EWrhfDeVw9/arcgis/rest/services/plate_tectonics_boundaries/FeatureServer/0",
    elevationInfo: {
      mode: "on-the-ground"
    },
    renderer: {
      type: "simple",
      symbol: {
        type: "line-3d",
        symbolLayers: [
          {
            type: "line",
            material: { color: [255, 99, 71, 0.7] },
            size: 3
          }
        ]
      }
    }
  });

  const map = new Map({
    ground: {
      opacity: 0
    },
    basemap: new Basemap({
      baseLayers: [countryBorders, plateTectonicBorders]
    })
  });

  // the view associated with the map has a transparent background
  // so that we can apply a CSS shadow filter for the glow
  const view = new SceneView({
    container: "view-container",
    // profil allégé sur mobile : 14 000 sphères 3D coûtent cher en GPU et en batterie
    qualityProfile: PETIT_ECRAN ? "medium" : "high",
    map: map,
    alphaCompositingEnabled: true,
    environment: {
      background: {
        type: "color",
        color: [0, 0, 0, 0]
      },
      starsEnabled: false,
      atmosphereEnabled: false
    },
    ui: {
      components: []
    },
    highlightOptions: {
      color: "white"
    },
    padding: {
      bottom: 200
    },
    popup: {
      collapseEnabled: false,
      dockEnabled: false,
      dockOptions: {
        breakpoint: false
      }
    }
  });

  // le panneau d'explication recouvre le bas de la vue : on recale le globe dessus
  const detailsElement = document.getElementById("details");
  function majPadding() {
    const hauteurMax = Math.round(window.innerHeight * 0.5);
    view.padding = { bottom: Math.min(detailsElement.offsetHeight, hauteurMax) };
  }
  window.addEventListener("resize", majPadding);

  const exaggeratedElevation = {
    mode: "absolute-height",
    featureExpressionInfo: {
      expression: "-$feature.depth * 6"
    },
    unit: "kilometers"
  };

  const realElevation = {
    mode: "absolute-height",
    featureExpressionInfo: {
      expression: "-$feature.depth"
    },
    unit: "kilometers"
  };
  let exaggerated = true;

  // define the earthquakes layer
  function creerCoucheSeismes(annee) {
    return new CSVLayer({
      url: "./data/earthquake_" + annee + ".csv",
      elevationInfo: exaggerated ? exaggeratedElevation : realElevation,
      screenSizePerspectiveEnabled: false,
      renderer: {
        type: "simple",
        symbol: {
          type: "point-3d",
          symbolLayers: [
            {
              type: "object",
              resource: {
                primitive: "sphere"
              },
              material: { color: [255, 99, 71, 0.8] }
            }
          ]
        },
        visualVariables: [
          {
            type: "size",
            field: "mag",
            axis: "all",
            stops: [
              { value: 5.5, size: 70000, label: "5,5" },
              { value: 7, size: 250000, label: "7 et plus" }
            ]
          },
          {
            type: "color",
            field: "mag",
            stops: [
              { value: 5.5, color: [255, 99, 71, 0.8], label: "4 - 5,5" },
              { value: 7, color: [179, 0, 0, 0.9], label: "7 et plus" }
            ]
          }
        ]
      },
      popupTemplate: {
        title: "Info séisme",
        // contenu construit en JS : les libellés USGS sont en anglais et les dates en UTC
        content: function(feature) {
          const attr = feature.graphic.attributes;
          // type inconnu : on garde le libellé USGS brut plutôt que d'inventer une traduction
          const type = TYPES_EVENEMENT[attr.type] || "Un événement de type « " + attr.type + " »";
          return (
            echapper(type) +
            " de magnitude " +
            formatDecimal(attr.mag) +
            " s'est produit à " +
            echapper(attr.place) +
            " " +
            formatDate(attr.time) +
            ", à une profondeur de " +
            formatDecimal(attr.depth) +
            " km."
          );
        }
      }
    });
  }

  let earthquakeLayer = null;
  let earthquakeLayerView = null;
  let highlightHandler = null;
  let derniereInteraction = 0;
  // année réellement affichée à l'écran (pas celle qu'on est en train de tenter de charger)
  let anneeAffichee = null;

  // les horodatages USGS sont en UTC : on les formate en UTC pour ne pas décaler d'un jour
  function formatDateCourte(date) {
    return new Intl.DateTimeFormat("fr-FR", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC"
    }).format(new Date(date));
  }

  function formatDate(date) {
    const heure = new Intl.DateTimeFormat("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC"
    }).format(new Date(date));
    return `le ${formatDateCourte(date)} à ${heure} UTC`;
  }

  function formatNombre(valeur) {
    return new Intl.NumberFormat("fr-FR").format(valeur);
  }

  // magnitudes et profondeurs : virgule décimale française, une décimale au plus
  function formatDecimal(valeur) {
    const nombre = Number(valeur);
    if (isNaN(nombre)) {
      return String(valeur);
    }
    return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(nombre);
  }

  // le contenu de la popup est injecté en HTML : les libellés USGS sont neutralisés
  function echapper(texte) {
    return String(texte === null || texte === undefined ? "" : texte)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  /**
   * Remplit la phrase d'introduction de la légende à partir des données réellement
   * chargées (nombre d'événements et dernière date couverte), pour que le texte ne
   * puisse pas se désynchroniser du CSV affiché.
   */
  function majTexteDonnees(couche, annee) {
    return couche
      .queryFeatures({ where: "1=1", outFields: ["time"], returnGeometry: false })
      .then(function(result) {
        const features = result.features;
        let phrase =
          "En " +
          annee +
          ", " +
          formatNombre(features.length) +
          " séismes de magnitude supérieure ou égale à 4 ont été enregistrés dans le monde.";
        let derniereDate = null;
        features.forEach(function(feature) {
          const t = feature.attributes.time;
          if (t && (derniereDate === null || t > derniereDate)) {
            derniereDate = t;
          }
        });
        // année incomplète (dernier fichier annuel) : on le dit explicitement
        if (derniereDate !== null && derniereDate < Date.UTC(annee, 11, 15)) {
          phrase += " Les données de " + annee + " s'arrêtent au " + formatDateCourte(derniereDate) + ".";
        }
        legendIntro.textContent = phrase;
      })
      .catch(function(error) {
        legendIntro.textContent = "Séismes de magnitude supérieure ou égale à 4 enregistrés en " + annee + ".";
        console.error("Statistiques indisponibles :", error);
      });
  }

  /** Construit la liste horizontale des séismes de magnitude supérieure à 7. */
  function majListeSeismes(couche) {
    return couche
      .queryFeatures({
        where: "mag > 7"
      })
      .then(function(result) {
        // le CSV est trié du plus récent au plus ancien : on rétablit l'ordre chronologique
        const features = result.features.slice().sort(function(a, b) {
          return a.attributes.time - b.attributes.time;
        });
        listElement.innerHTML = "";
        if (!features.length) {
          listElement.textContent = "Aucun séisme de magnitude supérieure à 7 cette année-là.";
          return;
        }
        features.forEach(function(earthquake) {
          const attr = earthquake.attributes;
          const content = document.createElement("div");
          content.innerHTML = `
          <div>
            <h3 lang="en">${echapper(attr.place)}</h3>
            <span class="date-time"><i>${formatDate(attr.time)}</i></span>
            </br>
            Magnitude ${formatDecimal(attr.mag)} | Profondeur ${formatDecimal(attr.depth)} km
          </div>
        `;
          const goToButton = document.createElement("button");
          goToButton.innerText = "Zoomer sur le séisme";
          goToButton.addEventListener("click", function() {
            derniereInteraction = Date.now();
            view
              .goTo({ target: earthquake, zoom: 4 }, { speedFactor: 0.5 })
              .then(function() {
                derniereInteraction = Date.now();
              })
              .catch(function(error) {
                // une animation interrompue par l'utilisateur est normale ; le reste, non
                if (!error || error.name !== "view:goto-interrupted") {
                  console.warn("Déplacement vers le séisme interrompu :", error);
                }
              });
            if (earthquakeLayerView) {
              if (highlightHandler) {
                highlightHandler.remove();
              }
              highlightHandler = earthquakeLayerView.highlight(earthquake);
            }
          });
          content.appendChild(goToButton);
          listElement.appendChild(content);
        });
      })
      .catch(function(error) {
        listElement.textContent = "Liste des séismes majeurs indisponible.";
        console.error("Liste des séismes indisponible :", error);
      });
  }

  /** Charge le CSV d'une année et remplace la couche sismique affichée. */
  function chargerAnnee(annee) {
    afficherStatut("Chargement des séismes de " + annee + "…", false);
    // on bloque le sélecteur le temps du chargement : deux CSV en vol se marcheraient dessus
    yearSelect.disabled = true;
    // la popup ouverte décrit un séisme de l'année qu'on quitte : elle n'a plus de sens
    if (view.popup) {
      view.popup.close();
    }

    const ancienneCouche = earthquakeLayer;
    const ancienneVueCouche = earthquakeLayerView;
    const couche = creerCoucheSeismes(annee);
    earthquakeLayer = couche;
    earthquakeLayerView = null;
    if (highlightHandler) {
      highlightHandler.remove();
      highlightHandler = null;
    }

    return couche
      .load()
      .then(function() {
        map.add(couche);
        if (ancienneCouche) {
          map.remove(ancienneCouche);
        }
        view.whenLayerView(couche).then(function(lyrView) {
          if (earthquakeLayer === couche) {
            earthquakeLayerView = lyrView;
          }
        });
        // les titres ne sont écrits qu'une fois les données réellement chargées :
        // sinon un CSV en échec laisserait un titre qui ment sur ce qui est affiché
        anneeAffichee = annee;
        titleElement.textContent = "Les séismes majeurs en " + annee;
        document.title = "Séismes majeurs en " + annee;
        return Promise.all([majTexteDonnees(couche, annee), majListeSeismes(couche)]);
      })
      .then(function() {
        masquerStatut();
        majPadding();
        yearSelect.disabled = false;
      })
      .catch(function(error) {
        // l'année précédente reste affichée : on rebranche tout dessus, y compris
        // la vue de couche (sans elle le highlight blanc du zoom ne se déclenche plus)
        if (earthquakeLayer === couche) {
          earthquakeLayer = ancienneCouche;
          earthquakeLayerView = ancienneVueCouche;
        }
        // le sélecteur doit désigner l'année réellement à l'écran, pas celle qui a échoué
        if (anneeAffichee !== null) {
          yearSelect.value = String(anneeAffichee);
        }
        afficherStatut(
          "Données sismiques de " + annee + " indisponibles : " + (error.message || error.name || error),
          true
        );
        console.error("Chargement du CSV impossible :", error);
        yearSelect.disabled = false;
      });
  }

  // sélecteur d'année : un fichier CSV annuel par année dans ./data
  for (let annee = DERNIERE_ANNEE; annee >= PREMIERE_ANNEE; annee--) {
    const option = document.createElement("option");
    option.value = String(annee);
    option.textContent = String(annee);
    yearSelect.appendChild(option);
  }
  yearSelect.value = String(ANNEE_PAR_DEFAUT);
  yearSelect.addEventListener("change", function() {
    chargerAnnee(parseInt(yearSelect.value, 10));
  });

  // les fonds de carte échouent silencieusement sinon : on prévient à l'écran
  Promise.all([countryBorders.load(), plateTectonicBorders.load()]).catch(function(error) {
    afficherStatut("Fonds de carte indisponible (frontières et plaques tectoniques).", true);
    console.error("Fonds de carte indisponible :", error);
  });

  chargerAnnee(ANNEE_PAR_DEFAUT);

  const boutonExageration = document.getElementById("toggle-exaggeration");
  boutonExageration.addEventListener("click", function() {
    exaggerated = !exaggerated;
    if (earthquakeLayer) {
      earthquakeLayer.elevationInfo = exaggerated ? exaggeratedElevation : realElevation;
    }
    boutonExageration.innerText = exaggerated ? "Afficher la profondeur réelle" : "Exagérer la profondeur";
    boutonExageration.setAttribute("aria-pressed", String(exaggerated));
  });

  const mouvementReduit = window.matchMedia("(prefers-reduced-motion: reduce)");
  let rotationDemarree = false;

  function rotate() {
    // on respecte le réglage système « animations réduites »
    if (mouvementReduit.matches) {
      rotationDemarree = false;
      return;
    }
    // onglet masqué : inutile de brûler du GPU, on repasse voir dans 500 ms
    if (document.hidden) {
      setTimeout(rotate, 500);
      return;
    }
    const repos = !view.interacting && !view.animation && Date.now() - derniereInteraction > DELAI_REPRISE_ROTATION;
    if (repos) {
      const camera = view.camera.clone();
      camera.position.longitude -= 0.1;
      view.camera = camera;
    }
    requestAnimationFrame(rotate);
  }

  function demarrerRotation() {
    if (!rotationDemarree) {
      rotationDemarree = true;
      rotate();
    }
  }

  view.watch("interacting", function(interacting) {
    // la rotation reprend quelques secondes après la dernière manipulation
    derniereInteraction = Date.now();
    if (!interacting) {
      demarrerRotation();
    }
  });

  function surChangementMouvementReduit(mq) {
    if (!mq.matches) {
      demarrerRotation();
    }
  }
  // addListener est déprécié : on ne l'utilise qu'en repli pour les vieux navigateurs
  if (mouvementReduit.addEventListener) {
    mouvementReduit.addEventListener("change", surChangementMouvementReduit);
  } else if (mouvementReduit.addListener) {
    mouvementReduit.addListener(surChangementMouvementReduit);
  }

  view
    .when(function() {
      view.constraints.clipDistance.far = 40000000;
      majPadding();
      watchUtils.whenFalseOnce(view, "updating", function() {
        demarrerRotation();
      });
    })
    .catch(function(error) {
      // cas le plus fréquent : navigateur sans WebGL accéléré (le globe reste noir)
      const sansWebgl = /webgl/i.test(error.message || "");
      vue3dIndisponible = true;
      afficherStatut(
        sansWebgl
          ? "Affichage 3D indisponible : ce navigateur ne gère pas WebGL avec accélération matérielle."
          : "La vue 3D n'a pas pu être initialisée : " + (error.message || error.name || error),
        true
      );
      // limite de l'environnement et non défaut de l'application : on n'en fait pas une erreur
      if (sansWebgl) {
        console.warn("Vue 3D non initialisée (WebGL indisponible) :", error);
      } else {
        console.error("Vue 3D non initialisée :", error);
      }
    });

  // sur petit écran le panneau d'explication mange tout l'écran : il démarre replié
  let legendVisible = !PETIT_ECRAN;
  const legendController = document.getElementById("legend-control");
  const legendContainer = document.getElementById("legend");
  function majLegende() {
    legendContainer.style.display = legendVisible ? "block" : "none";
    legendController.innerHTML = legendVisible ? "Cacher l'explication" : "Afficher l'explication";
    legendController.setAttribute("aria-expanded", String(legendVisible));
    majPadding();
  }
  majLegende();
  legendController.addEventListener("click", function() {
    legendVisible = !legendVisible;
    majLegende();
  });
});
