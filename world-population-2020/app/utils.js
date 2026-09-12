define(["nouislider"], function(nouislider) {

  return {
    createSlider: function(min, max) {
      var populationSlider = document.getElementById("populationSlider");
      var minOutput = document.getElementById("sliderMin");
      var maxOutput = document.getElementById("sliderMax");

      nouislider.create(populationSlider, {
        start: [min, max],
        range: {
          'min': min,
          'max': max
        },
        connect: true,
        orientation: 'horizontal',
        // bornes affichées sous le curseur (les infobulles se chevauchaient sur mobile)
        tooltips: false,
        format: {
          to: function(value) {
            return Math.round(Math.exp(value)).toLocaleString("fr-FR") + " pers./cellule";
          },
          from: function (value) {
            return Number(value);
          }
        }
      });

      var slider = populationSlider.noUiSlider;
      var current = [min, max];

      slider.on('update', function (values, handle, unencoded) {
        current = unencoded.slice();
        minOutput.textContent = values[0];
        maxOutput.textContent = values[1];
      });

      // Navigation clavier (absente de noUiSlider 10.1) : flèches, Page, Début/Fin
      var step = (max - min) / 100;
      var deltas = {
        ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step,
        PageDown: -step * 10, PageUp: step * 10
      };
      // noms accessibles des poignées (absents de noUiSlider 10.1 : deux « curseurs » identiques)
      var labels = ["Population minimale par cellule", "Population maximale par cellule"];
      populationSlider.querySelectorAll(".noUi-handle").forEach(function (handle, index) {
        handle.setAttribute("aria-label", labels[index]);
        handle.addEventListener("keydown", function (event) {
          var target;
          if (deltas[event.key] !== undefined) {
            target = current[index] + deltas[event.key];
          } else if (event.key === "Home") {
            target = min;
          } else if (event.key === "End") {
            target = max;
          } else {
            return;
          }
          event.preventDefault();
          var values = [null, null];
          values[index] = Math.min(max, Math.max(min, target));
          slider.set(values);
        });
      });

      return slider;
    }
  }

})
