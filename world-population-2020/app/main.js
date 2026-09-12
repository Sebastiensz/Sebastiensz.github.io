require([
  "esri/layers/FeatureLayer",
  "esri/Map",
  "esri/views/SceneView",
  "esri/core/watchUtils",
  "utils",
  "esri/smartMapping/statistics/summaryStatistics"
], function (
  FeatureLayer,
  Map, SceneView,
  watchUtils,
  utils,
  summaryStatistics
) {

    const footer = document.querySelector("footer");
    const statusNode = document.getElementById("status");
    const cellCountNode = document.getElementById("cellCount");
    const sliderNode = document.getElementById("populationSlider");
    const sliderMinNode = document.getElementById("sliderMin");
    const sliderMaxNode = document.getElementById("sliderMax");
    const resetButton = document.getElementById("resetView");

    const VIEW_LABEL = "Globe 3D de la population mondiale en 2020";
    const EARTH_RADIUS = 6371000;
    // altitude de départ : cadrage d'origine du globe sur un écran de bureau
    const BASE_ALTITUDE = 23057115;
    // champ de vision par défaut d'une SceneView, exprimé sur la diagonale de la zone utile
    const FIELD_OF_VIEW = 55;
    // part du diamètre du globe tolérée hors de la bande visible (cadrage d'origine : ~15 %)
    const OVERFLOW_TOLERANCE = 1.15;

    let view = null;
    let homeCamera = null;
    let totalCells = null;
    let layoutTimer = null;
    // couches déjà signalées à l'utilisateur : une même panne remontait deux fois
    const reportedLayers = [];

    // message d'état affiché dans le pied de page (vide = masqué)
    function setStatus(message, isError) {
      statusNode.textContent = message || "";
      statusNode.hidden = !message;
      statusNode.classList.toggle("error", !!isError);
    }

    // erreur visible pour l'utilisateur ; le détail technique reste dans la console
    function showError(message, detail) {
      const previous = statusNode.classList.contains("error") ? statusNode.textContent + " " : "";
      setStatus(previous + message, true);
      console.error(message, detail !== undefined ? detail : "");
    }

    function errorText(err) {
      return (err && err.message) || String(err);
    }

    // sans données de population ou sans vue 3D, le curseur n'a plus rien à filtrer
    function disableFilter() {
      sliderNode.hidden = true;
      sliderMinNode.hidden = true;
      sliderMaxNode.hidden = true;
    }

    // renderer for the population layer
    const renderer = {
      type: "simple",
      symbol: {
        type: "point-3d",
        symbolLayers: [{
          type: "object",
          resource: {
            primitive: "cube"
          },
          material: {
            color: "#00E9FF"
          },
          anchor: "bottom",
          width: 60000,
          depth: 60000,
          height: 60000
        }]
      },
      // hauteur du cube proportionnelle au peuplement (paliers logarithmiques :
      // les cellules vont de 10 à 36 millions de personnes)
      visualVariables: [{
        type: "size",
        field: "population_count",
        axis: "height",
        stops: [
          { value: 10, size: 30000 },
          { value: 1000, size: 80000 },
          { value: 50000, size: 180000 },
          { value: 1000000, size: 350000 },
          { value: 10000000, size: 550000 }
        ]
      }]
    };

    const populationLayer = new FeatureLayer({
      url: "https://services2.arcgis.com/cFEFS0EWrhfDeVw9/arcgis/rest/services/World_population_count_2020/FeatureServer/0",
      title: "Population 2020",
      definitionExpression: "population_count > 10",
      outFields: ["population_count"],
      renderer: renderer,
      popupTemplate: {
        title: "Cellule de grille",
        content: "Environ {population_count} personnes sur une cellule d'environ 110 km de côté.",
        fieldInfos: [{
          fieldName: "population_count",
          format: {
            digitSeparator: true,
            places: 0
          }
        }]
      }
    })

    const graticule = new FeatureLayer({
      url: "https://services.arcgis.com/V6ZHFr6zdgNZuVG0/arcgis/rest/services/World_graticule_15deg/FeatureServer/0",
      title: "Graticule 15°",
      renderer: {
        type: "simple",
        symbol: {
          type: "line-3d",
          symbolLayers: [{
            type: "line",
            material: {
              color: "#00E9FF"
            }
          }]
        }
      },
      opacity: 0.3
    });

    const countryBoundaries = new FeatureLayer({
      url: "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/World_Countries_(Generalized)/FeatureServer/0",
      title: "Frontières",
      renderer: {
        type: "simple",
        symbol: {
          type: "polygon-3d",
          symbolLayers: [{
            type: "fill",  // autocasts as new FillSymbol3DLayer()
            material: { color: [255, 250, 239, 0] },
            outline: {
              color: "#00E9FF",
              size: 1
            },
          }]
        }
      }
    });

    // les frontières pèsent 1,9 Mo : elles sont ajoutées après le premier rendu (voir view.when)
    const map = new Map({
      layers: [graticule, populationLayer],
      ground: {
        surfaceColor: [5, 50, 56],
        opacity: 0.7
      }
    });

    // le pied de page recouvre le bas de la vue : le globe est recentré sur la zone visible
    // (jamais plus de la moitié de la hauteur, sinon il ne resterait plus rien à cadrer)
    function footerPadding() {
      const available = (view && view.height) || window.innerHeight;
      return Math.min(footer.offsetHeight, Math.round(available / 2));
    }

    // hauteur réellement disponible pour le globe une fois le pied de page déduit
    function usableHeight() {
      const available = (view && view.height) || window.innerHeight;
      return Math.max(1, available - footerPadding());
    }

    // Sur un écran bas (téléphone en paysage, fenêtre de bureau peu haute), le globe déborde
    // de la bande visible : on recule la caméra juste ce qu'il faut pour l'y ramener.
    // Le champ de vision porte sur la diagonale de la zone utile (mesuré sur la 4.19), d'où
    // le rayon apparent du globe en pixels : (diagonale / 2 / tan(fov / 2)) * tan(alpha),
    // avec sin(alpha) = rayon terrestre / (rayon terrestre + altitude).
    function fittedAltitude() {
      const width = (view && view.width) || window.innerWidth;
      const fov = (view && view.camera && view.camera.fov) || FIELD_OF_VIEW;
      const usable = usableHeight();
      const diagonal = Math.sqrt(width * width + usable * usable);
      const tangent = OVERFLOW_TOLERANCE * usable * Math.tan(fov * Math.PI / 360) / diagonal;
      const sine = tangent / Math.sqrt(1 + tangent * tangent);
      const altitude = EARTH_RADIUS / sine - EARTH_RADIUS;
      // en dessous de ce seuil le cadrage d'origine tient déjà : on n'y touche pas
      return altitude <= BASE_ALTITUDE * 1.05 ? BASE_ALTITUDE : Math.round(altitude);
    }

    // ombres et occlusion ambiante désactivées sur écran tactile (GPU mobile)
    const coarsePointer = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;

    // set the environment
    view = new SceneView({
      map: map,
      container: "viewDiv",
      camera: {
        position: {
          spatialReference: {
            latestWkid: 4326,
            wkid: 4326
          },
          x: -120.45651418690257,
          y: 20.813251923155075,
          z: fittedAltitude()
        },
        heading: 0,
        tilt: 0
      },
      padding: {
        bottom: footerPadding()
      },
      ui: {
        components: []
      },
      // popup ancré à la cellule : ancré en bas d'écran (comportement par défaut sur mobile),
      // il serait recouvert par le pied de page ; déplié d'emblée pour montrer la valeur
      popup: {
        dockEnabled: false,
        dockOptions: {
          breakpoint: false
        },
        collapseEnabled: false
      },
      environment: {
        background: {
          type: "color",
          color: [5, 50, 56]
        },
        atmosphereEnabled: false,
        starsEnabled: false,
        lighting: {
          directShadowsEnabled: !coarsePointer,
          date: "2018-07-15T21:47:59Z",
          cameraTrackingEnabled: true,
          ambientOcclusionEnabled: !coarsePointer
        }
      }
    });

    // recadrage automatique, uniquement tant que l'utilisateur est resté sur la vue d'ensemble
    function fitGlobe() {
      if (!view || !view.ready) {
        return;
      }
      const target = fittedAltitude();
      const current = view.camera.position.z;
      if (current < BASE_ALTITUDE * 0.9 || Math.abs(target - current) < BASE_ALTITUDE * 0.05) {
        return;
      }
      const camera = view.camera.clone();
      camera.position.z = target;
      view.goTo(camera, { animate: false }).catch(function () {
        // navigation interrompue par l'utilisateur : sans effet
      });
    }

    function updateLayout() {
      view.padding = { bottom: footerPadding() };
      clearTimeout(layoutTimer);
      layoutTimer = setTimeout(fitGlobe, 200);
    }
    // le pied de page peut changer de hauteur sans que la fenêtre bouge (retour à la ligne),
    // et la fenêtre peut changer de hauteur sans que le pied de page bouge : on écoute les deux
    if (window.ResizeObserver) {
      new ResizeObserver(updateLayout).observe(footer);
    }
    window.addEventListener("resize", updateLayout);

    resetButton.addEventListener("click", function () {
      if (!view || !view.ready || !homeCamera) {
        return;
      }
      const camera = homeCamera.clone();
      camera.position.z = fittedAltitude();
      view.goTo(camera).catch(function () {
        // navigation interrompue par l'utilisateur : sans effet
      });
    });

    setStatus("Chargement du globe…");
    view.when(function () {
      homeCamera = view.camera.clone();
      resetButton.hidden = false;
      // la surface 3D est focalisable au clavier (role="application") : elle a besoin d'un nom
      const surface = view.container && view.container.querySelector(".esri-view-surface");
      if (surface) {
        surface.setAttribute("aria-label", VIEW_LABEL);
      }
      fitGlobe();
      // masque le message de chargement une fois les couches chargées et rendues
      watchUtils.whenFalseOnce(view, "updating", function () {
        if (!statusNode.classList.contains("error")) {
          setStatus("");
        }
        // frontières ajoutées seulement maintenant : leur 1,9 Mo retardait le premier rendu
        map.add(countryBoundaries);
      });
    }).catch(function (err) {
      // pas de console.error ici : l'API a déjà émis son propre avertissement (WebGL absent, etc.)
      const detail = errorText(err);
      const webgl = /webgl/i.test(detail);
      setStatus(webgl
        ? "Impossible d'afficher le globe 3D : ce navigateur n'a pas d'accélération graphique WebGL."
        : "Impossible d'afficher le globe 3D : " + detail, true);
      // sans vue 3D le filtre n'est jamais branché : le curseur donnerait l'illusion d'agir
      disableFilter();
      resetButton.hidden = true;
    });

    view.on("layerview-create-error", function (event) {
      const title = event.layer && event.layer.title;
      if (reportedLayers.indexOf(title) !== -1) {
        return;
      }
      reportedLayers.push(title);
      showError("Couche « " + title + " » indisponible (service temporairement injoignable).", event.error);
    });

    // nombre de cellules encore visibles après filtrage : le total seul induisait en erreur
    function updateFilteredCount(where) {
      if (!totalCells) {
        return;
      }
      populationLayer.queryFeatureCount({ where: where })
        .then(function (count) {
          const total = totalCells.toLocaleString("fr-FR");
          cellCountNode.textContent = count
            ? " (" + total + " cellules, dont " + count.toLocaleString("fr-FR") + " dans la plage choisie)"
            : " (" + total + " cellules, aucune dans la plage choisie)";
        })
        .catch(function (err) {
          // le compteur reste sur sa dernière valeur : pas de message, le filtre lui a fonctionné
          console.error("Comptage des cellules filtrées impossible", err);
        });
    }

    summaryStatistics({
      layer: populationLayer,
      field: "population_count"
    })
      .catch((err) => {
        // seul l'échec du service de population passe ici : le curseur n'a plus de bornes
        // (message unique : layerview-create-error signale la même panne)
        if (reportedLayers.indexOf(populationLayer.title) === -1) {
          reportedLayers.push(populationLayer.title);
          showError("Service de population indisponible, le filtre est désactivé.", err);
        }
        disableFilter();
        return null;
      })
      .then((result) => {
        if (!result) {
          return;
        }
        if (result.count) {
          totalCells = result.count;
          cellCountNode.textContent = " (" + totalCells.toLocaleString("fr-FR") + " cellules)";
        }
        const slider = utils.createSlider(Math.log(result.min), Math.log(result.max));

        // le filtre est côté client : il n'existe que si la vue 3D a pu créer sa layer view
        view.whenLayerView(populationLayer).then(function (populationLayerView) {
          let timer = null;

          // filtre appliqué au relâchement de la poignée ('set'), pas à chaque pixel ('update')
          slider.on('set', function (values, handles, unencoded) {
            clearTimeout(timer);
            timer = setTimeout(function () {
              const min = Math.round(Math.exp(unencoded[0]));
              const max = Math.round(Math.exp(unencoded[1]));
              const where = `population_count >= ${min} AND population_count <= ${max}`;
              populationLayerView.filter = { where: where };
              updateFilteredCount(where);
            }, 150);
          });
        }, function () {
          // vue ou couche indisponible : l'erreur est déjà affichée par view.when() / layerview-create-error
        });
      })
      .catch((err) => {
        // couvre aussi les erreurs de construction du curseur, après le premier .catch
        showError("Initialisation du filtre impossible.", err);
        disableFilter();
      });

  });
